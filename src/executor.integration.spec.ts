import Redis from 'ioredis';

import { IdempotentExecutor } from './executor';
import { IdempotentExecutorUnknownError } from './executor.errors';

const redisUrl = process.env.REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describeWithRedis('IdempotentExecutor integration (real Redis)', () => {
  let redisClientOne: Redis;
  let redisClientTwo: Redis;
  let executorOne: IdempotentExecutor;
  let executorTwo: IdempotentExecutor;
  const keyPrefix = `executor-integration:${Date.now()}:${Math.random()
    .toString(16)
    .slice(2)}`;

  const key = (suffix: string): string => `${keyPrefix}:${suffix}`;

  beforeAll(() => {
    redisClientOne = new Redis(redisUrl as string);
    redisClientTwo = new Redis(redisUrl as string);
    executorOne = new IdempotentExecutor(redisClientOne);
    executorTwo = new IdempotentExecutor(redisClientTwo);
  });

  afterAll(async () => {
    await Promise.all([redisClientOne.quit(), redisClientTwo.quit()]);
  });

  it('replays a single successful execution across independent executors', async () => {
    let invocation = 0;
    const action = jest.fn(async () => {
      invocation += 1;
      await sleep(300);
      return `value-${invocation}`;
    });

    const [resultOne, resultTwo] = await Promise.all([
      executorOne.run(key('success-replay'), action, { timeout: 2000 }),
      executorTwo.run(key('success-replay'), action, { timeout: 2000 }),
    ]);

    expect(resultOne).toBe('value-1');
    expect(resultTwo).toBe('value-1');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('times out lock contenders and replays after the winner finishes', async () => {
    const action = jest.fn(async () => {
      await sleep(900);
      return 'slow-action-result';
    });
    const idempotencyKey = key('lock-timeout');

    const winner = executorOne.run(idempotencyKey, action, { timeout: 400 });
    await sleep(50);

    await expect(
      executorTwo.run(idempotencyKey, action, { timeout: 400 }),
    ).rejects.toBeInstanceOf(IdempotentExecutorUnknownError);
    await expect(winner).resolves.toBe('slow-action-result');

    const replayAction = jest.fn(async () => 'should-not-run');
    await expect(
      executorTwo.run(idempotencyKey, replayAction, { timeout: 400 }),
    ).resolves.toBe('slow-action-result');

    expect(action).toHaveBeenCalledTimes(1);
    expect(replayAction).toHaveBeenCalledTimes(0);
  });
});
