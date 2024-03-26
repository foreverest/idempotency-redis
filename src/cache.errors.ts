/**
 * Represents an error that occurred while interacting with the cache.
 */
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
