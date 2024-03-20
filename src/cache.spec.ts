import { CachedResult, RedisCache, RedisCacheError } from './cache';
import Client from 'ioredis';

describe('RedisCache', () => {
  let redisMock: Partial<Client>;
  let cache: RedisCache;

  beforeEach(() => {
    redisMock = {
      hgetall: jest.fn(),
      hset: jest.fn(),
    };
    cache = new RedisCache(redisMock as Client);
  });

  describe('get method', () => {
    it('returns correct CachedResult when key exists with type "value"', async () => {
      const mockKey = 'testKey';
      const mockValue = 'some value';
      (redisMock.hgetall as jest.Mock).mockResolvedValue({
        type: 'value',
        value: mockValue,
      });

      const result = await cache.get(mockKey);

      expect(result).toEqual({ type: 'value', value: mockValue });
    });

    it('returns correct CachedResult when key exists with type "error"', async () => {
      const mockKey = 'testKey';
      const mockError = 'some error';
      (redisMock.hgetall as jest.Mock).mockResolvedValue({
        type: 'error',
        error: mockError,
      });

      const result = await cache.get(mockKey);

      expect(result).toEqual({ type: 'error', error: mockError });
    });

    it('returns null if the key does not exist', async () => {
      const mockKey = 'testKey';
      (redisMock.hgetall as jest.Mock).mockResolvedValue({});

      const result = await cache.get(mockKey);

      expect(result).toBeNull();
    });

    it('throws RedisCacheError when Redis operation fails', async () => {
      const mockKey = 'testKey';
      const mockError = new Error('Redis error');
      (redisMock.hgetall as jest.Mock).mockRejectedValue(mockError);

      await expect(cache.get(mockKey)).rejects.toThrow(RedisCacheError);
    });
  });

  describe('set method', () => {
    it('successfully sets a value', async () => {
      const mockKey = 'testKey';
      const mockValue: CachedResult = { type: 'value', value: 'some value' };
      (redisMock.hset as jest.Mock).mockResolvedValue(1);

      await expect(cache.set(mockKey, mockValue)).resolves.toBeUndefined();
      expect(redisMock.hset).toHaveBeenCalledWith(mockKey, mockValue);
    });

    it('throws RedisCacheError when Redis operation fails', async () => {
      const mockKey = 'testKey';
      const mockValue: CachedResult = { type: 'error', error: 'some error' };
      const mockError = new Error('Redis error');
      (redisMock.hset as jest.Mock).mockRejectedValue(mockError);

      await expect(cache.set(mockKey, mockValue)).rejects.toThrow(
        RedisCacheError,
      );
    });
  });
});
