import { describe, expect, it } from 'vitest';
import { SingleFlightCache } from './single-flight-cache.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlightCache', () => {
  it('shares one load between concurrent callers, then serves from memory until the ttl', async () => {
    let now = 1000;
    let loads = 0;
    const gate = deferred<string>();
    const cache = new SingleFlightCache(
      60_000,
      () => {
        loads++;
        return gate.promise;
      },
      () => now,
    );
    const calls = [cache.get(), cache.get(), cache.get()];
    expect(loads).toBe(1); // the barrier: all three are waiting on the one load
    gate.resolve('v1');
    expect(await Promise.all(calls)).toEqual(['v1', 'v1', 'v1']);

    now += 59_999;
    expect(await cache.get()).toBe('v1');
    expect(loads).toBe(1);
    now += 1;
    await cache.get();
    expect(loads).toBe(2);
  });

  it('does not cache a failure, and fails every waiter of that load', async () => {
    let loads = 0;
    const first = deferred<string>();
    const cache = new SingleFlightCache(60_000, () => {
      loads++;
      return loads === 1 ? first.promise : Promise.resolve('ok');
    });
    const a = cache.get();
    const b = cache.get();
    first.reject(new Error('down'));
    await expect(a).rejects.toThrow('down');
    await expect(b).rejects.toThrow('down');
    expect(await cache.get()).toBe('ok');
    expect(loads).toBe(2);
  });

  it('with a ttl of 0 loads on every call that is not concurrent', async () => {
    let loads = 0;
    const cache = new SingleFlightCache(0, () => Promise.resolve(++loads));
    expect(await cache.get()).toBe(1);
    expect(await cache.get()).toBe(2);
  });
});
