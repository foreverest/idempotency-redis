import { RedisClientType } from 'redis';
import redisLock, { DoneFn, LockFn } from 'redis-lock';

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
    super(message, idempotencyKey, cause);
    this.name = 'IdempotentExecutorCriticalError';
  }
}

/**
 * Defines the options for running an asynchronous action.
 */
interface RunOptions<T> {
  timeout: number;
  valueSerializer: Serializer<T>;
  errorSerializer: Serializer<Error>;
}

/**
 * Manages idempotency in asynchronous operations by leveraging Redis for storage and distributed locks.
 */
export class IdempotentExecutor {
  private lock: LockFn;
  private cache: RedisCache;

  /**
   * Initializes a new instance of the IdempotentExecutor class.
   *
   * Note: The Redis client must be connected using `await redis.connect()` before calling `run()`.
   *
   * @param {RedisClientType} redis - The Redis client to be used for managing state and locks.
   */
  constructor(redis: RedisClientType) {
    this.lock = redisLock(redis);
    this.cache = new RedisCache(redis);
  }

  /**
   * Executes the provided action with idempotency, ensuring that it runs exactly once for a given idempotency key.
   *
   * @param {string} idempotencyKey - A unique key identifying the operation to ensure idempotency.
   * @param {() => Promise<T>} action - An asynchronous function representing the operation to execute idempotently.
   * @param {Partial<RunOptions<T>>} options - Optional. Configuration options for the execution.
   *    @property {number} options.timeout - Optional. The maximum duration, in milliseconds, allowed for the operation to complete. If the operation does not finish within this timeframe, control is transferred to the next execution in the queue. Make sure the timeout is sufficiently long to accommodate the expected completion time of your operation. Defaults to 60 seconds.
   *    @property {Serializer<T>} options.valueSerializer - Optional. Responsible for serializing the successful result of the action. Defaults to JSON serialization.
   *    @property {Serializer<Error>} options.errorSerializer - Optional. Used for serializing errors that may occur during the action's execution. Defaults to a error serializer that uses serialize-error-cjs.
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
    const cacheKey = `result:${idempotencyKey}`;

    let done: DoneFn;
    try {
      // Attempt to acquire a lock using the idempotency key and specified timeout.
      done = await this.lock(`lock:${idempotencyKey}`, timeout);
    } catch (error) {
      throw new IdempotentExecutorError(
        'Failed to acquire lock',
        idempotencyKey,
        error,
      );
    }

    let cachedResult: CachedResult | null;
    try {
      // Attempt to retrieve a cached result for the idempotency key.
      cachedResult = await this.cache.get(cacheKey);
    } catch (error) {
      await done();
      throw new IdempotentExecutorError(
        'Failed to get cached result',
        idempotencyKey,
        error,
      );
    }

    if (cachedResult) {
      if (cachedResult.type === 'error') {
        let cachedError: unknown;
        try {
          cachedError = errorSerializer.deserialize(cachedResult.error);
        } catch (error) {
          throw new IdempotentExecutorError(
            'Failed to parse cached error',
            idempotencyKey,
            error,
          );
        } finally {
          await done();
        }
        // Replay the cached error.
        throw cachedError;
      } else {
        try {
          // Parse and replay the cached result.
          return valueSerializer.deserialize(cachedResult.value);
        } catch (error) {
          throw new IdempotentExecutorError(
            'Failed to parse cached value',
            idempotencyKey,
            error,
          );
        } finally {
          await done();
        }
      }
    }

    // Execute the action.
    let actionResult: T | Error;
    try {
      actionResult = await action();
    } catch (error) {
      actionResult =
        error instanceof Error ? error : new Error(`Unknown error: ${error}`);
    }

    // Cache the result of the action and return/throw it.
    try {
      if (actionResult instanceof Error) {
        await this.cache.set(cacheKey, {
          type: 'error',
          error: errorSerializer.serialize(actionResult),
        });
      } else {
        await this.cache.set(cacheKey, {
          type: 'value',
          value: valueSerializer.serialize(actionResult),
        });

        // Return the action result.
        return actionResult;
      }
    } catch (error) {
      // If caching the result fails, throw a critical error as it might lead to non-idempotent executions.
      throw new IdempotentExecutorCriticalError(
        'Failed to set cached result',
        idempotencyKey,
        error,
      );
    } finally {
      await done();
    }

    // Throw the action error.
    throw actionResult;
  }
}
