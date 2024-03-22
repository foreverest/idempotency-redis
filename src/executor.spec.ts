import Client from 'ioredis-mock';

import {
  IdempotentExecutor,
  IdempotentExecutorCriticalError,
  IdempotentExecutorError,
} from './executor';
import { DefaultErrorSerializer, JSONSerializer } from './serialization';

describe('IdempotentExecutor', () => {
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

  it('should throw IdempotentExecutorError if getting cached result fails', async () => {
    const action = jest.fn().mockResolvedValue('action result');
    jest
      .spyOn(redisClient, 'hgetall')
      .mockImplementation(() => Promise.reject(new Error('Redis error')));

    await expect(executor.run('key', action)).rejects.toThrow(
      IdempotentExecutorError,
    );
  });

  it('should throw IdempotentExecutorError if deserializing cached result fails', async () => {
    const action = jest.fn().mockResolvedValue('action result');
    jest
      .spyOn(redisClient, 'hgetall')
      .mockImplementation(() => Promise.resolve({ type: 'value', value: '.' })); // Invalid JSON.

    await expect(executor.run('key', action)).rejects.toThrow(
      IdempotentExecutorError,
    );
  });

  it('should throw IdempotentExecutorError if deserializing cached error fails', async () => {
    const action = jest.fn().mockResolvedValue('action result');
    jest
      .spyOn(redisClient, 'hgetall')
      .mockImplementation(() => Promise.resolve({ type: 'error', error: '.' })); // Invalid JSON.

    await expect(executor.run('key', action)).rejects.toThrow(
      IdempotentExecutorError,
    );
  });

  it('should throw IdempotentExecutorCriticalError if setting cached result fails', async () => {
    const action = jest.fn().mockResolvedValue('action result');
    jest
      .spyOn(redisClient, 'hset')
      .mockImplementation(() => Promise.reject(new Error('Redis error')));

    await expect(executor.run('key1', action)).rejects.toThrow(
      IdempotentExecutorCriticalError,
    );
  });

  it('should handle action execution failure by caching and replaying the error', async () => {
    const error = new Error('action failed');
    const action = jest.fn().mockRejectedValue(error);

    await expect(executor.run('key1', action)).rejects.toThrow(error);
    await expect(executor.run('key1', action)).rejects.toThrow(error);

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should throw an "unknown error" if the action threw a non-Error object', async () => {
    const error = 'action failed';
    const action = jest.fn().mockRejectedValue(error);

    await expect(executor.run('key1', action)).rejects.toThrow(
      new Error('Unknown error: action failed'),
    );
    await expect(executor.run('key1', action)).rejects.toThrow(
      new Error('Unknown error: action failed'),
    );

    expect(action).toHaveBeenCalledTimes(1);
  });

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
      new IdempotentExecutorError(
        'Failed to execute action idempotently',
        'key1',
      ),
    );
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
    ).rejects.toThrow('Action Failed');
    // The second call reveals how the error is actually stored in cache.
    await expect(executor.run('key1', action)).rejects.toThrow('ACTION FAILED');

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
    await expect(executor.run('key1', action)).rejects.toThrow('Action Failed');
    // The second call reveals the result of deserialization.
    await expect(
      executor.run('key1', action, {
        errorSerializer: new CustomErrorSerializer(),
      }),
    ).rejects.toThrow('action failed');

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should demo more real-world example of replaying custom errors', async () => {
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
    ).rejects.toThrow(CustomError);
    await expect(
      executor.run('key1', action, { errorSerializer }),
    ).rejects.toThrow(CustomError);

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
