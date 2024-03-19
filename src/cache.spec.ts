import { CachedResult, RedisCache, RedisCacheError } from './cache';
import { RedisClientType } from 'redis';

describe('RedisCache', () => {
  let redisMock: Partial<RedisClientType>;
  let cache: RedisCache;

  beforeEach(() => {
    redisMock = {
      hGetAll: jest.fn(),
      hSet: jest.fn(),
    };
    cache = new RedisCache(redisMock as RedisClientType);
  });

  describe('get method', () => {
    it('returns correct CachedResult when key exists with type "value"', async () => {
      const mockKey = 'testKey';
      const mockValue = 'some value';
      (redisMock.hGetAll as jest.Mock).mockResolvedValue({
        type: 'value',
        value: mockValue,
      });

      const result = await cache.get(mockKey);

      expect(result).toEqual({ type: 'value', value: mockValue });
    });

    it('returns correct CachedResult when key exists with type "error"', async () => {
      const mockKey = 'testKey';
      const mockError = 'some error';
      (redisMock.hGetAll as jest.Mock).mockResolvedValue({
        type: 'error',
        error: mockError,
      });

      const result = await cache.get(mockKey);

      expect(result).toEqual({ type: 'error', error: mockError });
    });

    it('returns null if the key does not exist', async () => {
      const mockKey = 'testKey';
      (redisMock.hGetAll as jest.Mock).mockResolvedValue({});

      const result = await cache.get(mockKey);

      expect(result).toBeNull();
    });

    it('throws RedisCacheError when Redis operation fails', async () => {
      const mockKey = 'testKey';
      const mockError = new Error('Redis error');
      (redisMock.hGetAll as jest.Mock).mockRejectedValue(mockError);

      await expect(cache.get(mockKey)).rejects.toThrow(RedisCacheError);
    });
  });

  describe('set method', () => {
    it('successfully sets a value', async () => {
      const mockKey = 'testKey';
      const mockValue: CachedResult = { type: 'value', value: 'some value' };
      (redisMock.hSet as jest.Mock).mockResolvedValue(1);

      await expect(cache.set(mockKey, mockValue)).resolves.toBeUndefined();
      expect(redisMock.hSet).toHaveBeenCalledWith(mockKey, mockValue);
    });

    it('throws RedisCacheError when Redis operation fails', async () => {
      const mockKey = 'testKey';
      const mockValue: CachedResult = { type: 'error', error: 'some error' };
      const mockError = new Error('Redis error');
      (redisMock.hSet as jest.Mock).mockRejectedValue(mockError);

      await expect(cache.set(mockKey, mockValue)).rejects.toThrow(
        RedisCacheError,
      );
    });
  });
});
