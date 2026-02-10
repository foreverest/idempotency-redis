import Redis from 'ioredis';

import { RedisCache } from './cache';

const redisUrl = process.env.REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis('RedisCache integration (real Redis)', () => {
  let redisClient: Redis;
  let cache: RedisCache;
  const keyPrefix = `cache-integration:${Date.now()}:${Math.random()
    .toString(16)
    .slice(2)}`;

  const key = (suffix: string): string => `${keyPrefix}:${suffix}`;

  beforeAll(() => {
    redisClient = new Redis(redisUrl as string);
    cache = new RedisCache(redisClient);
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  it('stores and returns values using real Redis hashes', async () => {
    const cacheKey = key('value');

    await cache.set(cacheKey, {
      type: 'value',
      value: '"serialized-value"',
    });

    expect(await redisClient.hgetall(cacheKey)).toEqual({
      type: 'value',
      value: '"serialized-value"',
    });
    await expect(cache.get(cacheKey)).resolves.toEqual({
      type: 'value',
      value: '"serialized-value"',
    });
  });

  it('stores undefined values without writing an empty field', async () => {
    const cacheKey = key('undefined-value');

    await cache.set(cacheKey, { type: 'value' });

    expect(await redisClient.hgetall(cacheKey)).toEqual({ type: 'value' });
    await expect(cache.get(cacheKey)).resolves.toEqual({ type: 'value' });
  });

  it('stores and returns serialized error payloads', async () => {
    const cacheKey = key('error');

    await cache.set(cacheKey, {
      type: 'error',
      error: '{"name":"Error","message":"boom"}',
    });

    await expect(cache.get(cacheKey)).resolves.toEqual({
      type: 'error',
      error: '{"name":"Error","message":"boom"}',
    });
  });

  it('returns null when key does not exist', async () => {
    await expect(cache.get(key('missing'))).resolves.toBeNull();
  });
});
