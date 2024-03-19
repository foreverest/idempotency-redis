import { RedisClientType } from 'redis';

// Type definition for possible cached result states.
export type CachedResult =
  | {
      type: 'error'; // Represents an error state with a corresponding serialized error object.
      error: string;
    }
  | {
      type: 'value'; // Represents a successful state with a corresponding serialized value.
      value: string;
    };

// Custom error class for handling Redis cache-related errors.
export class RedisCacheError extends Error {
  /**
   * Constructs an instance of RedisCacheError.
   * @param message The error message.
   * @param key The cache key associated with the error.
   * @param cause (Optional) The underlying error or reason for this error, if any.
   */
  constructor(
    message: string,
    public readonly key: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RedisCacheError';
  }
}

// Class representing a wrapper around Redis operations for caching.
export class RedisCache {
  /**
   * Constructs an instance of RedisCache.
   * @param redis A RedisClientType instance for Redis operations.
   */
  constructor(private readonly redis: RedisClientType) {}

  /**
   * Retrieves a cached result by key.
   * @param key The cache key to retrieve the value for.
   * @returns A promise that resolves to a CachedResult or null if the key is not found.
   */
  async get(key: string): Promise<CachedResult | null> {
    try {
      const { type, error, value } = await this.redis.hGetAll(key);
      if (!type) {
        // If there's no type, the key doesn't exist in cache.
        return null;
      }
      return type === 'error'
        ? {
            type: 'error',
            error,
          }
        : {
            type: 'value',
            value,
          };
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
      await this.redis.hSet(key, value);
    } catch (error) {
      throw new RedisCacheError('Failed to set cached result', key, error);
    }
  }
}
