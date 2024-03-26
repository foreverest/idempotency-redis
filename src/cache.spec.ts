import { CachedResult, RedisCache } from './cache';
import Client from 'ioredis-mock';
import { RedisCacheError } from './cache.errors';

describe('RedisCache', () => {
  let redisClient = new Client();
  let cache: RedisCache;

  beforeEach(async () => {
    redisClient = new Client();
    await redisClient.flushall();
    cache = new RedisCache(redisClient);
  });

  afterEach(async () => {
    await redisClient.quit();
  });

  describe('get method', () => {
    it('returns correct CachedResult when key exists with type "value"', async () => {
      const mockKey = 'testKey';
      const mockValue = 'some value';
      redisClient.hset(mockKey, 'type', 'value', 'value', mockValue);

      const result = await cache.get(mockKey);

      expect(result).toEqual({ type: 'value', value: mockValue });
    });

    it('returns correct CachedResult when value is undefined', async () => {
      const mockKey = 'testKey';
      redisClient.hset(mockKey, 'type', 'value');

      const result = await cache.get(mockKey);

      expect(result).toEqual({ type: 'value' });
    });

    it('returns correct CachedResult when key exists with type "error"', async () => {
      const mockKey = 'testKey';
      const mockError = 'some error';
      redisClient.hset(mockKey, 'type', 'error', 'error', mockError);

      const result = await cache.get(mockKey);

      expect(result).toEqual({ type: 'error', error: mockError });
    });

    it('returns null if the key does not exist', async () => {
      const mockKey = 'testKey';

      const result = await cache.get(mockKey);

      expect(result).toBeNull();
    });

    it('throws RedisCacheError when Redis operation fails', async () => {
      const mockKey = 'testKey';
      const mockError = new Error('Redis error');
      redisClient.hgetall = jest.fn().mockRejectedValue(mockError);

      await expect(cache.get(mockKey)).rejects.toThrow(
        new RedisCacheError('Failed to get cached result', mockKey, mockError),
      );
    });
  });

  describe('set method', () => {
    it('successfully sets a value', async () => {
      const mockKey = 'testKey';
      const mockValue: CachedResult = { type: 'value', value: 'some value' };

      await expect(cache.set(mockKey, mockValue)).resolves.toBeUndefined();
      expect(await redisClient.hgetall(mockKey)).toEqual(mockValue);
    });

    it('successfully sets undefined value', async () => {
      const mockKey = 'testKey';
      const mockValue: CachedResult = { type: 'value' };

      await expect(cache.set(mockKey, mockValue)).resolves.toBeUndefined();
      expect(await redisClient.hgetall(mockKey)).toEqual(mockValue);
    });

    it('throws RedisCacheError when Redis operation fails', async () => {
      const mockKey = 'testKey';
      const mockValue: CachedResult = { type: 'error', error: 'some error' };
      const mockError = new Error('Redis error');
      redisClient.hset = jest.fn().mockRejectedValue(mockError);

      await expect(cache.set(mockKey, mockValue)).rejects.toThrow(
        new RedisCacheError('Failed to set cached result', mockKey, mockError),
      );
    });
  });
});
