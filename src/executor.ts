import Client from 'ioredis';
import Redlock from 'redlock';

import {
  Serializer,
  JSONSerializer,
  DefaultErrorSerializer,
} from './serialization';
import { CachedResult, RedisCache } from './cache';

/**
 * Represents a generic error related to idempotent operations.
 */
export class IdempotentExecutorError extends Error {
  /**
   * Constructs an instance of IdempotentExecutorError.
   * @param message The error message describing what went wrong.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this error, if any.
   */
  constructor(
    message: string,
    public readonly idempotencyKey: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IdempotentExecutorError';
  }
}

/**
 * Represents a critical error related to idempotent operations, potentially leading to non-idempotent executions.
 */
export class IdempotentExecutorCriticalError extends IdempotentExecutorError {
  /**
   * Constructs an instance of IdempotentExecutorCriticalError.
   * This error class should be used for critical issues that might lead to non-idempotent executions.
   * @param message The error message describing the critical issue.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this critical error, if any.
   */
  constructor(message: string, idempotencyKey: string, cause?: unknown) {
    super(
      `Possibly non-idempotent execution: ${message}`,
      idempotencyKey,
      cause,
    );
    this.name = 'IdempotentExecutorCriticalError';
  }
}

/**
 * Wraps an error that is being replayed.
 */
class ReplayedErrorWrapper extends Error {
  constructor(public readonly origin: unknown) {
    super('Replayed error');
    this.name = 'ReplayedErrorWrapper';
  }
}

/**
 * Defines the options for running an asynchronous action.
 */
interface RunOptions<T> {
  timeout: number;
  valueSerializer: Serializer<T>;
  errorSerializer: Serializer<Error>;
  onActionSuccess: (idempotencyKey: string, value: T) => T;
  onActionError: (idempotencyKey: string, error: Error) => Error;
  onSuccessReplay: (idempotencyKey: string, value: T) => T;
  onErrorReplay: (idempotencyKey: string, error: Error) => Error;
}

/**
 * Manages idempotency in asynchronous operations by leveraging Redis for storage and distributed locks.
 */
export class IdempotentExecutor {
  private redlock: Redlock;
  private cache: RedisCache;

  /**
   * Initializes a new instance of the IdempotentExecutor class.
   *
   * @param {Client} redis - The Redis client to be used for managing state and locks.
   */
  constructor(redis: Client) {
    this.redlock = new Redlock([redis]);
    this.cache = new RedisCache(redis);
  }

  /**
   * Executes the provided action with idempotency, ensuring that it runs exactly once for a given idempotency key.
   *
   * @param {string} idempotencyKey - A unique key identifying the operation to ensure idempotency.
   * @param {() => Promise<T>} action - An asynchronous function representing the operation to execute idempotently.
   * @param {Partial<RunOptions<T>>} options - Optional. Configuration options for the execution.
   *    @property {number} options.timeout - Optional. The maximum duration, in milliseconds, that the concurrent operations will wait for the in-progress one to complete after which they will be terminated. Defaults to 60 seconds.
   *    @property {Serializer<T>} options.valueSerializer - Optional. Responsible for serializing the successful result of the action. Defaults to JSON serialization.
   *    @property {Serializer<Error>} options.errorSerializer - Optional. Used for serializing errors that may occur during the action's execution. Defaults to a error serializer that uses serialize-error-cjs.
   *    @property {(idempotencyKey: string, value: T) => T} options.onActionSuccess - Optional. A callback that is invoked when the action is executed successfully. It receives the idempotency key and the result of the action, and should return the result to be returned by the executor.
   *    @property {(idempotencyKey: string, error: Error) => Error} options.onActionError - Optional. A callback that is invoked when the action fails during execution. It receives the idempotency key and the error that occurred, and should return the error to be thrown by the executor.
   *    @property {(idempotencyKey: string, value: T) => T} options.onSuccessReplay - Optional. A callback that is invoked when a successful action is replayed. It receives the idempotency key and the result of the action, and should return the result to be returned by the executor.
   *    @property {(idempotencyKey: string, error: Error) => Error} options.onErrorReplay - Optional. A callback that is invoked when a failed action is replayed. It receives the idempotency key and the error that occurred, and should return the error to be thrown by the executor.
   * @returns {Promise<T>} The result of the executed action.
   * @throws {IdempotentExecutorError} If acquiring the lock or retrieving the cached result fails.
   * @throws {IdempotentExecutorCriticalError} If saving the result to cache fails, potentially leading to non-idempotent executions.
   */
  async run<T>(
    idempotencyKey: string,
    action: () => Promise<T>,
    options?: Partial<RunOptions<T>>,
  ): Promise<T> {
    const timeout = options?.timeout ?? 60000;
    const valueSerializer = options?.valueSerializer ?? new JSONSerializer<T>();
    const errorSerializer =
      options?.errorSerializer ?? new DefaultErrorSerializer();
    const cacheKey = `idempotent-executor-result:${idempotencyKey}`;

    try {
      return await this.redlock.using<T>(
        [idempotencyKey],
        timeout,
        {
          retryCount: timeout / 200,
          retryDelay: 200,
          automaticExtensionThreshold: timeout / 2,
        },
        async () => {
          // Retrieve the cached result of the action.
          const cachedResult = await this.getCachedResult(
            idempotencyKey,
            cacheKey,
          );

          // If the action has already been executed, replay the result.
          if (cachedResult) {
            if (cachedResult.type === 'error') {
              this.replayCachedError(
                idempotencyKey,
                errorSerializer,
                cachedResult.error,
                options?.onErrorReplay,
              );
            }

            if (cachedResult.value === undefined) {
              // If `undefined` does not satisfy the type T,
              // this means the action also broke the type contract.
              // So, we're simply replaying this here too.
              return undefined as T;
            }

            return this.replayCachedValue(
              idempotencyKey,
              valueSerializer,
              cachedResult.value,
              options?.onSuccessReplay,
            );
          }

          // Execute the action.
          let actionResult: T | Error;
          try {
            actionResult = await action();
          } catch (error) {
            actionResult =
              error instanceof Error
                ? error
                : new Error(`Non-error thrown: ${error}`);
          }

          // Cache the result of the action.
          await this.cacheResult(
            idempotencyKey,
            cacheKey,
            actionResult,
            valueSerializer,
            errorSerializer,
          );

          // If the action resulted in an error, throw it.
          if (actionResult instanceof Error) {
            this.throwError(
              idempotencyKey,
              actionResult,
              options?.onActionError,
            );
          }

          // Return the result of the action.
          return this.returnResult(
            idempotencyKey,
            actionResult,
            options?.onActionSuccess,
          );
        },
      );
    } catch (error) {
      if (error instanceof ReplayedErrorWrapper) {
        throw error.origin;
      }
      if (
        error instanceof IdempotentExecutorError ||
        error instanceof IdempotentExecutorCriticalError
      ) {
        throw error;
      }
      throw new IdempotentExecutorError(
        'Failed to execute action idempotently',
        idempotencyKey,
        error,
      );
    }
  }

  /**
   * Retrieves the cached result of an idempotent operation.
   */
  private async getCachedResult(
    idempotencyKey: string,
    cacheKey: string,
  ): Promise<CachedResult | null> {
    try {
      return await this.cache.get(cacheKey);
    } catch (error) {
      throw new IdempotentExecutorError(
        'Failed to get cached result',
        idempotencyKey,
        error,
      );
    }
  }

  /**
   * Replays a cached error, potentially transforming it using a callback.
   */
  private replayCachedError(
    idempotencyKey: string,
    errorSerializer: Serializer<Error>,
    serializedError: string,
    onErrorReplay?: (idempotencyKey: string, error: Error) => Error,
  ): never {
    let error: Error;
    try {
      error = errorSerializer.deserialize(serializedError);
    } catch (error) {
      throw new IdempotentExecutorError(
        'Failed to parse cached error',
        idempotencyKey,
        error,
      );
    }

    if (onErrorReplay) {
      try {
        error = onErrorReplay(idempotencyKey, error);
      } catch (error) {
        throw new IdempotentExecutorError(
          'Failed to execute onErrorReplay callback',
          idempotencyKey,
          error,
        );
      }
    }

    throw new ReplayedErrorWrapper(error);
  }

  /**
   * Replays a cached value, potentially transforming it using a callback.
   */
  private replayCachedValue<T>(
    idempotencyKey: string,
    valueSerializer: Serializer<T>,
    serializedValue: string,
    onSuccessReplay?: (idempotencyKey: string, value: T) => T,
  ): T {
    let value: T;
    try {
      value = valueSerializer.deserialize(serializedValue);
    } catch (error) {
      throw new IdempotentExecutorError(
        'Failed to parse cached value',
        idempotencyKey,
        error,
      );
    }

    if (onSuccessReplay) {
      try {
        value = onSuccessReplay(idempotencyKey, value);
      } catch (error) {
        throw new IdempotentExecutorError(
          'Failed to execute onSuccessReplay callback',
          idempotencyKey,
          error,
        );
      }
    }

    return value;
  }

  /**
   * Caches the result of an idempotent operation.
   */
  private async cacheResult<T>(
    idempotencyKey: string,
    cacheKey: string,
    value: T | Error,
    valueSerializer: Serializer<T>,
    errorSerializer: Serializer<Error>,
  ): Promise<void> {
    try {
      if (value instanceof Error) {
        await this.cache.set(cacheKey, {
          type: 'error',
          error: errorSerializer.serialize(value),
        });
      } else {
        await this.cache.set(cacheKey, {
          type: 'value',
          value: valueSerializer.serialize(value),
        });
      }
    } catch (error) {
      // If caching the result fails, throw a critical error as it might lead to non-idempotent executions.
      throw new IdempotentExecutorCriticalError(
        'Failed to set cached result',
        idempotencyKey,
        error,
      );
    }
  }

  /**
   * Throws an error that occurred during the execution of an idempotent operation,
   * potentially transforming it using a callback.
   */
  private throwError(
    idempotencyKey: string,
    error: Error,
    onActionError?: (idempotencyKey: string, error: Error) => Error,
  ): never {
    if (onActionError) {
      try {
        error = onActionError(idempotencyKey, error);
      } catch (error) {
        throw new IdempotentExecutorError(
          'Failed to execute onActionError callback',
          idempotencyKey,
          error,
        );
      }
    }

    throw new ReplayedErrorWrapper(error);
  }

  /**
   * Returns the result of an idempotent operation,
   * potentially transforming it using a callback.
   */
  private returnResult<T>(
    idempotencyKey: string,
    value: T,
    onActionSuccess?: (idempotencyKey: string, value: T) => T,
  ): T {
    if (onActionSuccess) {
      try {
        value = onActionSuccess(idempotencyKey, value);
      } catch (error) {
        throw new IdempotentExecutorError(
          'Failed to execute onActionSuccess callback',
          idempotencyKey,
          error,
        );
      }
    }

    return value;
  }
}
