import { describe, expect, it } from 'vitest';
import { abortable, SpacedQueue } from './spaced-queue.js';

/** The Management API queue: one at a time, spaced, paused by a 429, abortable while waiting. */
describe('SpacedQueue', () => {
  const never = new AbortController().signal;

  it('runs one call at a time, each start at least the spacing after the previous start', async () => {
    const queue = new SpacedQueue(40);
    const starts: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const work = async () => {
      starts.push(performance.now());
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    };
    await Promise.all([1, 2, 3, 4].map(() => queue.run(work, never)));
    expect(maxRunning).toBe(1);
    for (let i = 1; i < starts.length; i++) {
      // Timer granularity: a little under the spacing is still the spacing.
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(38);
    }
  });

  it('keeps the order and passes results and failures through', async () => {
    const queue = new SpacedQueue(0);
    const order: number[] = [];
    const results = await Promise.allSettled([
      queue.run(() => Promise.resolve((order.push(1), 'a')), never),
      queue.run(() => Promise.reject(new Error('second fails')), never),
      queue.run(() => Promise.resolve((order.push(3), 'c')), never),
    ]);
    expect(order).toEqual([1, 3]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('starts nothing before a pause ends, and never shortens one', async () => {
    let now = 1_000;
    const queue = new SpacedQueue(0, () => now);
    queue.pauseUntil(1_050);
    queue.pauseUntil(1_010);
    let ran = false;
    const pending = queue.run(() => {
      ran = true;
      return Promise.resolve();
    }, never);
    await new Promise((r) => setTimeout(r, 20));
    expect(ran).toBe(false);
    now = 1_050;
    await pending;
    expect(ran).toBe(true);
  });

  it('an aborted waiter leaves without running, and the one after it still waits its turn', async () => {
    const queue = new SpacedQueue(0);
    let releaseFirst!: () => void;
    const events: string[] = [];
    const first = queue.run(
      () =>
        new Promise<void>((r) => {
          events.push('first start');
          releaseFirst = () => {
            events.push('first end');
            r();
          };
        }),
      never,
    );
    const ctl = new AbortController();
    const second = queue.run(() => {
      events.push('second ran');
      return Promise.resolve();
    }, ctl.signal);
    const third = queue.run(() => {
      events.push('third start');
      return Promise.resolve();
    }, never);
    ctl.abort(new Error('caller gave up'));
    await expect(second).rejects.toThrow('caller gave up');
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(['first start']);
    releaseFirst();
    await Promise.all([first, third]);
    expect(events).toEqual(['first start', 'first end', 'third start']);
  });

  it('abortable rejects at once for a signal already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort(new Error('already'));
    await expect(abortable(Promise.resolve(1), ctl.signal)).rejects.toThrow('already');
    await expect(abortable(Promise.reject(new Error('inner')), never)).rejects.toThrow('inner');
  });
});
