import Client from 'ioredis-mock';

import { IdempotentExecutor } from './executor';
import { DefaultErrorSerializer, JSONSerializer } from './serialization';
import {
  IdempotentExecutorCacheError,
  IdempotentExecutorCallbackError,
  IdempotentExecutorCriticalError,
  IdempotentExecutorNonErrorWrapperError,
  IdempotentExecutorSerializationError,
  IdempotentExecutorUnknownError,
} from './executor.errors';
import { RedisCacheError } from './cache.errors';
import { SerializerError } from './serialization.errors';

describe('IdempotentExecutor.run method', () => {
  let redisClient = new Client();
  let executor: IdempotentExecutor;

  beforeEach(async () => {
    redisClient = new Client();
    await redisClient.flushall();
    executor = new IdempotentExecutor(redisClient);
  });

  afterEach(async () => {
    await redisClient.quit();
  });

  describe('core', () => {
    it('should run action successfully', async () => {
      const action = jest.fn().mockResolvedValue('action result');

      const result = await executor.run('key1', action);

      expect(result).toBe('action result');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should run action once for same key', async () => {
      const action = jest.fn().mockResolvedValue('action result');

      const result1 = await executor.run('key1', action);
      const result2 = await executor.run('key1', action);

      expect(result1).toBe('action result');
      expect(result2).toBe('action result');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should run action twice for two keys', async () => {
      const action = jest.fn().mockResolvedValue('action result');

      const result1 = await executor.run('key1', action);
      const result2 = await executor.run('key2', action);

      expect(result1).toBe('action result');
      expect(result2).toBe('action result');
      expect(action).toHaveBeenCalledTimes(2);
    });

    it('should handle action execution failure by caching and replaying the error', async () => {
      const error = new Error('action failed');
      const action = jest.fn().mockRejectedValue(error);

      await expect(executor.run('key1', action)).rejects.toThrow(error);
      await expect(executor.run('key1', action)).rejects.toThrow(error);

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should handle action execution failure by caching but not replaying the error if ignoreError is true', async () => {
      const error = new Error('action failed');
      const action = jest.fn().mockRejectedValue(error);

      await expect(
        executor.run('key1', action, { shouldIgnoreError: () => true }),
      ).rejects.toThrow(error);
      await expect(
        executor.run('key1', action, { shouldIgnoreError: () => true }),
      ).rejects.toThrow(error);

      expect(action).toHaveBeenCalledTimes(2);
    });

    it('should replay undefined value', async () => {
      const action = jest.fn().mockResolvedValue(undefined);

      const result1 = await executor.run('key1', action);
      const result2 = await executor.run('key1', action);

      expect(result1).toBe(undefined);
      expect(result2).toBe(undefined);
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent action runs with successful result', async () => {
      const action = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve('action result'), 1000),
            ),
        );

      // Run 10 actions with the same key concurrently.
      const promises = Array.from({ length: 10 }, () =>
        executor.run('key1', action),
      );
      const results = await Promise.all(promises);

      results.forEach((result) => expect(result).toBe('action result'));
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent action runs with failed result', async () => {
      const error = new Error('action failed');
      const action = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve, reject) =>
              setTimeout(() => reject(error), 1000),
            ),
        );

      // Run 10 actions with the same key concurrently.
      const promises = Array.from({ length: 10 }, () =>
        executor.run('key1', action),
      );

      const results = await Promise.allSettled(promises);

      results.forEach((result) => {
        expect(result.status).toBe('rejected');
        expect((result as PromiseRejectedResult).reason).toEqual(error);
      });

      expect(action).toHaveBeenCalledTimes(1);
    });

    it.each([0, -1, Number.NaN])(
      'should reject invalid timeout values (%s)',
      async (timeout) => {
        const action = jest.fn().mockResolvedValue('action result');

        await expect(
          executor.run(`invalid-timeout-${String(timeout)}`, action, {
            timeout,
          }),
        ).rejects.toThrow(
          new RangeError(
            'Timeout must be a positive finite number in milliseconds',
          ),
        );
        expect(action).toHaveBeenCalledTimes(0);
      },
    );

    it.each([0, -1, Number.NaN])(
      'should reject invalid executor ttl values (%s)',
      (ttlMs) => {
        expect(() => new IdempotentExecutor(redisClient, { ttlMs })).toThrow(
          new RangeError(
            'ttlMs must be a positive finite number in milliseconds',
          ),
        );
      },
    );

    it('should normalize and apply executor-level ttl to cached value', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      const ttlMs = 399.1;
      const pexpireSpy = jest.spyOn(redisClient, 'pexpire');
      const executorWithTtl = new IdempotentExecutor(redisClient, { ttlMs });

      await executorWithTtl.run('ttl-key-value', action);

      expect(pexpireSpy).toHaveBeenCalledTimes(1);
      expect(pexpireSpy).toHaveBeenCalledWith(
        'idempotent-executor-result:ttl-key-value',
        400,
      );
    });

    it('should apply ttl to cached errors', async () => {
      const error = new Error('action failed');
      const action = jest.fn().mockRejectedValue(error);
      const ttlMs = 5000;
      const pexpireSpy = jest.spyOn(redisClient, 'pexpire');
      const executorWithTtl = new IdempotentExecutor(redisClient, { ttlMs });

      await expect(
        executorWithTtl.run('ttl-key-error', action),
      ).rejects.toThrow(error);

      expect(pexpireSpy).toHaveBeenCalledTimes(1);
      expect(pexpireSpy).toHaveBeenCalledWith(
        'idempotent-executor-result:ttl-key-error',
        ttlMs,
      );
    });

    it('should not apply ttl when ttl is not configured', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      const pexpireSpy = jest.spyOn(redisClient, 'pexpire');

      await executor.run('ttl-key-none', action);

      expect(pexpireSpy).not.toHaveBeenCalled();
    });

    it('should normalize timeout and compute integer lock retry settings', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      const usingSpy = jest.spyOn(
        (
          executor as unknown as {
            redlock: {
              using: (...args: unknown[]) => Promise<unknown>;
            };
          }
        ).redlock,
        'using',
      );

      await executor.run('normalized-timeout-key', action, { timeout: 399.1 });

      expect(usingSpy).toHaveBeenCalledTimes(1);
      const usingArgs = usingSpy.mock.calls[0] as [
        string[],
        number,
        {
          retryCount: number;
          retryDelay: number;
          automaticExtensionThreshold: number;
        },
      ];

      expect(usingArgs[1]).toBe(400);
      expect(Number.isInteger(usingArgs[2].retryCount)).toBe(true);
      expect(usingArgs[2].retryCount).toBe(2);
      expect(usingArgs[2].retryDelay).toBe(200);
      expect(Number.isInteger(usingArgs[2].automaticExtensionThreshold)).toBe(
        true,
      );
    });

    it('should timeout lock if action takes too long', async () => {
      const action = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve('action result'), 500),
            ),
        );

      const promises = [
        executor.run('key1', action, { timeout: 200 }),
        executor.run('key1', action, { timeout: 200 }),
      ];
      const results = await Promise.allSettled(promises);

      expect(results[0].status).toBe('fulfilled');
      expect((results[0] as PromiseFulfilledResult<string>).value).toEqual(
        'action result',
      );

      expect(results[1].status).toBe('rejected');
      expect((results[1] as PromiseRejectedResult).reason).toEqual(
        new IdempotentExecutorUnknownError(
          'Failed to execute action idempotently',
          'key1',
        ),
      );
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should throw IdempotentExecutorCacheError if getting cached result fails', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      jest
        .spyOn(redisClient, 'hgetall')
        .mockImplementation(() => Promise.reject(new Error('Redis error')));

      await expect(executor.run('key', action)).rejects.toThrow(
        new IdempotentExecutorCacheError(
          'Failed to get cached result',
          'key',
          new RedisCacheError(
            'Failed to get cached result',
            'key',
            new Error('Redis error'),
          ),
        ),
      );
    });

    it('should throw a "Non-error thrown" if the action threw a non-Error object', async () => {
      const error = 42;
      const action = jest.fn().mockRejectedValue(error);

      await expect(executor.run('key1', action)).rejects.toThrow(
        new IdempotentExecutorNonErrorWrapperError(
          'Non-error thrown',
          'key1',
          error,
        ),
      );
      await expect(executor.run('key1', action)).rejects.toThrow(
        new IdempotentExecutorNonErrorWrapperError(
          'Non-error thrown',
          'key1',
          error,
        ),
      );

      expect(action).toHaveBeenCalledTimes(1);
    });
  });

  describe('serialization', () => {
    it('should throw custom errors as plain Error instances', async () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('action failed');
      const action = jest.fn().mockRejectedValue(error);

      await expect(executor.run('key1', action)).rejects.toThrow(Error);
      await expect(executor.run('key1', action)).rejects.toThrow(Error);

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should serialize value with custom serializer', async () => {
      class CustomSerializer extends JSONSerializer<string> {
        serialize(value: string): string {
          return JSON.stringify(value.toUpperCase());
        }
      }

      const action = jest.fn().mockResolvedValue('Action Result');

      const result1 = await executor.run('key1', action, {
        valueSerializer: new CustomSerializer(),
      });
      const result2 = await executor.run('key1', action);

      // The first call doesn't go through serialization.
      expect(result1).toBe('Action Result');
      // The second call reveals how the value is stored in cache.
      expect(result2).toBe('ACTION RESULT');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should deserialize value with custom serializer', async () => {
      class CustomSerializer extends JSONSerializer<string> {
        deserialize(value: string): string {
          return JSON.parse(value.toLowerCase());
        }
      }

      const action = jest.fn().mockResolvedValue('Action Result');

      const result1 = await executor.run('key1', action);
      const result2 = await executor.run('key1', action, {
        valueSerializer: new CustomSerializer(),
      });

      // The first call doesn't go through serialization.
      expect(result1).toBe('Action Result');
      // The second call reveals the result of deserialization.
      expect(result2).toBe('action result');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should serialize error with custom serializer', async () => {
      class CustomErrorSerializer extends DefaultErrorSerializer {
        serialize(value: Error): string {
          const uppercasedError = new Error(value.message.toUpperCase());
          return super.serialize(uppercasedError);
        }
      }

      const error = new Error('Action Failed');
      const action = jest.fn().mockRejectedValue(error);

      // The first call doesn't go through serialization.
      await expect(
        executor.run('key1', action, {
          errorSerializer: new CustomErrorSerializer(),
        }),
      ).rejects.toThrow(error);
      // The second call reveals how the error is actually stored in cache.
      await expect(executor.run('key1', action)).rejects.toThrow(
        new Error('ACTION FAILED'),
      );

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should deserialize error with custom serializer', async () => {
      class CustomErrorSerializer extends DefaultErrorSerializer {
        deserialize(value: string): Error {
          const error = super.deserialize(value);
          return new Error(error.message.toLowerCase());
        }
      }

      const error = new Error('Action Failed');
      const action = jest.fn().mockRejectedValue(error);

      // The first call doesn't go through serialization.
      await expect(executor.run('key1', action)).rejects.toThrow(error);
      // The second call reveals the result of deserialization.
      await expect(
        executor.run('key1', action, {
          errorSerializer: new CustomErrorSerializer(),
        }),
      ).rejects.toThrow(new Error('action failed'));

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should throw IdempotentExecutorSerializationError if deserializing cached value fails', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      jest
        .spyOn(redisClient, 'hgetall')
        .mockImplementation(() =>
          Promise.resolve({ type: 'value', value: '.' }),
        ); // Invalid JSON.

      try {
        await executor.run('key', action);
        fail('executor.run did not throw');
      } catch (error) {
        if (error instanceof IdempotentExecutorSerializationError) {
          expect(error.message).toBe('Failed to parse cached value');
          expect(error.idempotencyKey).toBe('key');
          if (error.cause instanceof SerializerError) {
            expect(error.cause.message).toBe('Invalid JSON');
            expect(error.cause.cause).toBeInstanceOf(SyntaxError);
          } else {
            fail('cause is not an instance of SerializerError');
          }
        } else {
          fail(
            'Thrown error is not an instance of IdempotentExecutorSerializationError',
          );
        }
      }
    });

    it('should throw IdempotentExecutorSerializationError if deserializing cached error fails', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      jest
        .spyOn(redisClient, 'hgetall')
        .mockImplementation(() =>
          Promise.resolve({ type: 'error', error: '.' }),
        ); // Invalid JSON.

      try {
        await executor.run('key', action);
        fail('executor.run did not throw');
      } catch (error) {
        if (error instanceof IdempotentExecutorSerializationError) {
          expect(error.message).toBe('Failed to parse cached error');
          expect(error.idempotencyKey).toBe('key');
          if (error.cause instanceof SerializerError) {
            expect(error.cause.message).toBe('Invalid JSON');
            expect(error.cause.cause).toBeInstanceOf(SyntaxError);
          } else {
            fail('cause is not an instance of SerializerError');
          }
        } else {
          fail(
            'Thrown error is not an instance of IdempotentExecutorSerializationError',
          );
        }
      }
    });
  });

  describe('callbacks', () => {
    it('should return whatever onActionSuccess returns', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      const onActionSuccess = jest
        .fn()
        .mockImplementation(() => 'onActionSuccess result');

      const result = await executor.run('key', action, { onActionSuccess });

      expect(result).toBe('onActionSuccess result');
      expect(action).toHaveBeenCalledTimes(1);
      expect(onActionSuccess).toHaveBeenCalledWith('key', 'action result');
    });

    it('should return whatever onSuccessReplay returns', async () => {
      const action = jest.fn();
      const onSuccessReplay = jest
        .fn()
        .mockImplementation(() => 'onSuccessReplay result');
      jest
        .spyOn(redisClient, 'hgetall')
        .mockResolvedValue({ type: 'value', value: '"action result"' });

      const result = await executor.run('key', action, { onSuccessReplay });

      expect(result).toBe('onSuccessReplay result');
      expect(action).toHaveBeenCalledTimes(0);
      expect(onSuccessReplay).toHaveBeenCalledWith('key', 'action result');
    });

    it('should throw whatever onActionError returns', async () => {
      const action = jest.fn().mockRejectedValue(new Error('action error'));
      const onActionError = jest
        .fn()
        .mockImplementation(() => new Error('onActionError error'));

      await expect(
        executor.run('key', action, { onActionError }),
      ).rejects.toThrow(new Error('onActionError error'));

      expect(action).toHaveBeenCalledTimes(1);
      expect(onActionError).toHaveBeenCalledWith(
        'key',
        new Error('action error'),
      );
    });

    it('should throw whatever onErrorReplay returns', async () => {
      const action = jest.fn();
      const onErrorReplay = jest
        .fn()
        .mockImplementation(() => new Error('onErrorReplay error'));
      jest.spyOn(redisClient, 'hgetall').mockResolvedValue({
        type: 'error',
        error: JSON.stringify({
          name: 'Error',
          message: 'action error',
          stack: 'stack',
        }),
      });

      await expect(
        executor.run('key', action, { onErrorReplay }),
      ).rejects.toThrow(new Error('onErrorReplay error'));

      expect(action).toHaveBeenCalledTimes(0);
      expect(onErrorReplay).toHaveBeenCalledWith(
        'key',
        new Error('action error'),
      );
    });

    it('should throw IdempotentExecutorCallbackError if onActionSuccess fails', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      const onActionSuccess = jest.fn().mockImplementation(() => {
        throw new Error('onActionSuccess error');
      });

      await expect(
        executor.run('key', action, { onActionSuccess }),
      ).rejects.toThrow(
        new IdempotentExecutorCallbackError(
          'Failed to execute onActionSuccess callback',
          'key',
          'onActionSuccess',
          new Error('onActionSuccess error'),
        ),
      );

      expect(action).toHaveBeenCalledTimes(1);
      expect(onActionSuccess).toHaveBeenCalledWith('key', 'action result');
    });

    it('should throw IdempotentExecutorCallbackError if onSuccessReplay fails', async () => {
      const action = jest.fn();
      const onSuccessReplay = jest.fn().mockImplementation(() => {
        throw new Error('onSuccessReplay error');
      });
      jest
        .spyOn(redisClient, 'hgetall')
        .mockResolvedValue({ type: 'value', value: '"action result"' });

      await expect(
        executor.run('key', action, { onSuccessReplay }),
      ).rejects.toThrow(
        new IdempotentExecutorCallbackError(
          'Failed to execute onSuccessReplay callback',
          'key',
          'onSuccessReplay',
          new Error('onSuccessReplay error'),
        ),
      );

      expect(action).toHaveBeenCalledTimes(0);
      expect(onSuccessReplay).toHaveBeenCalledWith('key', 'action result');
    });

    it('should throw IdempotentExecutorCallbackError if onActionError fails', async () => {
      const action = jest.fn().mockRejectedValue(new Error('action error'));
      const onActionError = jest.fn().mockImplementation(() => {
        throw new Error('onActionError error');
      });

      await expect(
        executor.run('key', action, { onActionError }),
      ).rejects.toThrow(
        new IdempotentExecutorCallbackError(
          'Failed to execute onActionError callback',
          'key',
          'onActionError',
          new Error('onActionError error'),
        ),
      );

      expect(action).toHaveBeenCalledTimes(1);
      expect(onActionError).toHaveBeenCalledWith(
        'key',
        new Error('action error'),
      );
    });

    it('should throw IdempotentExecutorCallbackError if onErrorReplay fails', async () => {
      const action = jest.fn();
      const onErrorReplay = jest.fn().mockImplementation(() => {
        throw new Error('onErrorReplay error');
      });
      jest.spyOn(redisClient, 'hgetall').mockResolvedValue({
        type: 'error',
        error: JSON.stringify({
          name: 'Error',
          message: 'action error',
          stack: 'stack',
        }),
      });

      await expect(
        executor.run('key', action, { onErrorReplay }),
      ).rejects.toThrow(
        new IdempotentExecutorCallbackError(
          'Failed to execute onErrorReplay callback',
          'key',
          'onErrorReplay',
          new Error('onErrorReplay error'),
        ),
      );

      expect(action).toHaveBeenCalledTimes(0);
      expect(onErrorReplay).toHaveBeenCalledWith(
        'key',
        new Error('action error'),
      );
    });

    it('should throw IdempotentExecutorCallbackError if shouldIgnoreError fails', async () => {
      const action = jest.fn().mockRejectedValue(new Error('action error'));
      const shouldIgnoreError = jest.fn().mockImplementation(() => {
        throw new Error('shouldIgnoreError error');
      });

      await expect(
        executor.run('key', action, { shouldIgnoreError }),
      ).rejects.toThrow(
        new IdempotentExecutorCallbackError(
          'Failed to execute shouldIgnoreError callback',
          'key',
          'shouldIgnoreError',
          new Error('shouldIgnoreError error'),
        ),
      );

      expect(action).toHaveBeenCalledTimes(1);
      expect(shouldIgnoreError).toHaveBeenCalledWith(new Error('action error'));
    });

    it('should throw IdempotentExecutorCriticalError if setting cached result fails', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      jest
        .spyOn(redisClient, 'hset')
        .mockImplementation(() => Promise.reject(new Error('Redis error')));

      await expect(executor.run('key1', action)).rejects.toThrow(
        new IdempotentExecutorCriticalError(
          'Failed to set cached result',
          'key1',
          new RedisCacheError(
            'Failed to set cached result',
            'key1',
            new Error('Redis error'),
          ),
        ),
      );
    });
  });

  describe('examples', () => {
    it('should demo real-world example of replaying custom errors', async () => {
      class CustomError extends Error {
        constructor(
          message: string,
          public readonly customProperty: string,
        ) {
          super(message);
          this.name = 'CustomError';
        }
      }

      class CustomErrorSerializer extends DefaultErrorSerializer {
        serialize(value: Error): string {
          if (value instanceof CustomError) {
            return JSON.stringify({
              name: value.name,
              message: value.message,
              customProperty: value.customProperty,
            });
          }
          return super.serialize(value);
        }

        deserialize(value: string): Error {
          const error = JSON.parse(value);
          if (
            typeof error === 'object' &&
            'name' in error &&
            error.name === 'CustomError' &&
            'message' in error &&
            typeof error.message === 'string' &&
            'customProperty' in error &&
            typeof error.customProperty === 'string'
          ) {
            // Replay CustomError.
            return new CustomError(error.message, error.customProperty);
          }
          // Fallback to the default deserialization to replay other errors.
          return super.deserialize(value);
        }
      }

      const error = new CustomError('action failed', 'custom property');
      const errorSerializer = new CustomErrorSerializer();
      const action = jest.fn().mockRejectedValue(error);

      await expect(
        executor.run('key1', action, { errorSerializer }),
      ).rejects.toThrow(error);
      await expect(
        executor.run('key1', action, { errorSerializer }),
      ).rejects.toThrow(error);

      expect(action).toHaveBeenCalledTimes(1);
    });

    it('should demo more real-world example of replaying custom objects', async () => {
      class CustomClass {}

      class CustomValueSerializer extends JSONSerializer<CustomClass | number> {
        serialize(value: CustomClass | number): string {
          if (value instanceof CustomClass) {
            return 'format:custom-class';
          }
          return super.serialize(value);
        }

        deserialize(value: string): CustomClass | number {
          if (value === 'format:custom-class') {
            // Replay CustomClass.
            return new CustomClass();
          }
          // Fallback to the default deserialization to replay numbers.
          return super.deserialize(value);
        }
      }

      const custom = new CustomClass();
      const number = 42;
      const valueSerializer = new CustomValueSerializer();
      const customAction = jest.fn().mockResolvedValue(custom);
      const numberAction = jest.fn().mockResolvedValue(number);

      const customResult1 = await executor.run('custom', customAction, {
        valueSerializer,
      });
      const customResult2 = await executor.run('custom', customAction, {
        valueSerializer,
      });
      const numberResult1 = await executor.run('number', numberAction, {
        valueSerializer,
      });
      const numberResult2 = await executor.run('number', numberAction, {
        valueSerializer,
      });

      expect(customResult1).toBe(custom);
      expect(customResult2).toStrictEqual(custom);
      expect(numberResult1).toBe(number);
      expect(numberResult2).toBe(number);

      expect(customAction).toHaveBeenCalledTimes(1);
      expect(numberAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('namespace', () => {
    it('should use namespace in cache key when provided', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      const executorWithNamespace = new IdempotentExecutor(redisClient, {
        namespace: 'test-namespace',
      });

      const result1 = await executorWithNamespace.run('key1', action);
      const result2 = await executorWithNamespace.run('key1', action);

      expect(result1).toBe('action result');
      expect(result2).toBe('action result');
      expect(action).toHaveBeenCalledTimes(1);

      // Verify the cache key includes the namespace.
      const cacheKey = await redisClient.hgetall(
        'idempotent-executor-result:test-namespace:key1',
      );
      expect(cacheKey.type).toBe('value');
      expect(cacheKey.value).toBe('"action result"');
    });

    it('should create separate cache entries for different namespaces', async () => {
      const action1 = jest.fn().mockResolvedValue('result1');
      const action2 = jest.fn().mockResolvedValue('result2');
      const executor1 = new IdempotentExecutor(redisClient, {
        namespace: 'namespace1',
      });
      const executor2 = new IdempotentExecutor(redisClient, {
        namespace: 'namespace2',
      });

      const result1a = await executor1.run('same-key', action1);
      const result2a = await executor2.run('same-key', action2);

      expect(result1a).toBe('result1');
      expect(result2a).toBe('result2');
      expect(action1).toHaveBeenCalledTimes(1);
      expect(action2).toHaveBeenCalledTimes(1);

      // Verify both cache entries exist.
      const cacheKey1 = await redisClient.hgetall(
        'idempotent-executor-result:namespace1:same-key',
      );
      const cacheKey2 = await redisClient.hgetall(
        'idempotent-executor-result:namespace2:same-key',
      );
      expect(cacheKey1.type).toBe('value');
      expect(cacheKey1.value).toBe('"result1"');
      expect(cacheKey2.type).toBe('value');
      expect(cacheKey2.value).toBe('"result2"');
    });

    it('should not use namespace in cache key when not provided', async () => {
      const action = jest.fn().mockResolvedValue('action result');
      const executorWithoutNamespace = new IdempotentExecutor(redisClient);

      const result1 = await executorWithoutNamespace.run('key1', action);
      const result2 = await executorWithoutNamespace.run('key1', action);

      expect(result1).toBe('action result');
      expect(result2).toBe('action result');
      expect(action).toHaveBeenCalledTimes(1);

      // Verify the cache key does not include a namespace.
      const cacheKey = await redisClient.hgetall(
        'idempotent-executor-result:key1',
      );
      expect(cacheKey.type).toBe('value');
      expect(cacheKey.value).toBe('"action result"');
    });

    it('should isolate cache entries between namespaced and non-namespaced executors', async () => {
      const action1 = jest.fn().mockResolvedValue('result1');
      const action2 = jest.fn().mockResolvedValue('result2');
      const executorWithoutNamespace = new IdempotentExecutor(redisClient);
      const executorWithNamespace = new IdempotentExecutor(redisClient, {
        namespace: 'test-namespace',
      });

      const result1 = await executorWithoutNamespace.run('same-key', action1);
      const result2 = await executorWithNamespace.run('same-key', action2);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(action1).toHaveBeenCalledTimes(1);
      expect(action2).toHaveBeenCalledTimes(1);

      // Verify both cache entries exist separately.
      const cacheKeyWithoutNamespace = await redisClient.hgetall(
        'idempotent-executor-result:same-key',
      );
      const cacheKeyWithNamespace = await redisClient.hgetall(
        'idempotent-executor-result:test-namespace:same-key',
      );
      expect(cacheKeyWithoutNamespace.type).toBe('value');
      expect(cacheKeyWithoutNamespace.value).toBe('"result1"');
      expect(cacheKeyWithNamespace.type).toBe('value');
      expect(cacheKeyWithNamespace.value).toBe('"result2"');
    });

    it('should use namespace for error caching', async () => {
      const error = new Error('action failed');
      const action = jest.fn().mockRejectedValue(error);
      const executorWithNamespace = new IdempotentExecutor(redisClient, {
        namespace: 'error-namespace',
      });

      await expect(executorWithNamespace.run('key1', action)).rejects.toThrow(
        error,
      );
      await expect(executorWithNamespace.run('key1', action)).rejects.toThrow(
        error,
      );

      expect(action).toHaveBeenCalledTimes(1);

      // Verify the error cache key includes the namespace.
      const cacheKey = await redisClient.hgetall(
        'idempotent-executor-result:error-namespace:key1',
      );
      expect(cacheKey.type).toBe('error');
      expect(cacheKey.error).toBeDefined();
    });

    it('should isolate error cache entries between different namespaces', async () => {
      const error1 = new Error('error1');
      const error2 = new Error('error2');
      const action1 = jest.fn().mockRejectedValue(error1);
      const action2 = jest.fn().mockRejectedValue(error2);
      const executor1 = new IdempotentExecutor(redisClient, {
        namespace: 'namespace1',
      });
      const executor2 = new IdempotentExecutor(redisClient, {
        namespace: 'namespace2',
      });

      await expect(executor1.run('same-key', action1)).rejects.toThrow(error1);
      await expect(executor2.run('same-key', action2)).rejects.toThrow(error2);

      expect(action1).toHaveBeenCalledTimes(1);
      expect(action2).toHaveBeenCalledTimes(1);

      // Verify both error cache entries exist separately.
      const cacheKey1 = await redisClient.hgetall(
        'idempotent-executor-result:namespace1:same-key',
      );
      const cacheKey2 = await redisClient.hgetall(
        'idempotent-executor-result:namespace2:same-key',
      );
      expect(cacheKey1.type).toBe('error');
      expect(cacheKey2.type).toBe('error');
    });

    it('should run same idempotency key concurrently across different namespaces', async () => {
      const action1 = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve('namespace1'), 500),
            ),
        );
      const action2 = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve('namespace2'), 500),
            ),
        );
      const executor1 = new IdempotentExecutor(redisClient, {
        namespace: 'namespace1',
      });
      const executor2 = new IdempotentExecutor(redisClient, {
        namespace: 'namespace2',
      });

      const [result1, result2] = await Promise.all([
        executor1.run('shared-key', action1, { timeout: 200 }),
        executor2.run('shared-key', action2, { timeout: 200 }),
      ]);

      expect(result1).toBe('namespace1');
      expect(result2).toBe('namespace2');
      expect(action1).toHaveBeenCalledTimes(1);
      expect(action2).toHaveBeenCalledTimes(1);
    });
  });
});
