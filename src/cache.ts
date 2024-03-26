import Client from 'ioredis';
import { RedisCacheError } from './cache.errors';

// Type definition for possible cached result states.
export type CachedResult =
  | {
      type: 'error'; // Represents an error state with a corresponding serialized error object.
      error: string;
    }
  | {
      type: 'value'; // Represents a successful state with a corresponding serialized value.
      value?: string;
    };

// Class representing a wrapper around Redis operations for caching.
export class RedisCache {
  /**
   * Constructs an instance of RedisCache.
   * @param redis A RedisClientType instance for Redis operations.
   */
  constructor(private readonly redis: Client) {}

  /**
   * Retrieves a cached result by key.
   * @param key The cache key to retrieve the value for.
   * @returns A promise that resolves to a CachedResult or null if the key is not found.
   */
  async get(key: string): Promise<CachedResult | null> {
    try {
      const { type, error, value } = await this.redis.hgetall(key);
      if (!type) {
        // If there's no type, the key doesn't exist in cache.
        return null;
      }
      if (type === 'error') {
        return {
          type: 'error',
          error,
        };
      }

      return value ? { type: 'value', value } : { type: 'value' };
    } catch (error) {
      throw new RedisCacheError('Failed to get cached result', key, error);
    }
  }

  /**
   * Sets a value in the cache.
   * @param key The cache key to set the value for.
   * @param value The CachedResult to store.
   * @returns A promise that resolves when the operation is complete.
   */
  async set(key: string, value: CachedResult): Promise<void> {
    try {
      await this.redis.hset(key, value);
    } catch (error) {
      throw new RedisCacheError('Failed to set cached result', key, error);
    }
  }
}
