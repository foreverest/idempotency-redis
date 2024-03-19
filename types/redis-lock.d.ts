declare module 'redis-lock' {
  import { RedisClientType } from 'redis';
  export type DoneFn = () => Promise<void>;
  export type LockFn = (lockName: string, timeout?: number) => Promise<DoneFn>;
  export default function redisLock(
    client: RedisClientType,
    retryDelay?: number,
  ): LockFn;
}
