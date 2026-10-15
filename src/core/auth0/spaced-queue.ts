/**
 * Runs calls one at a time, each starting at least `spacingMs` after the one
 * before it started, and none before a pause set by a rate-limit answer ends.
 * The Free tenant's Management API allows 2 requests per second with a burst
 * of 2 (docs/m7-plan.md §1.3), so every call to it goes through one queue.
 *
 * A caller's signal bounds its whole wait: an aborted caller leaves the queue
 * without running, and the queue keeps its order for everyone behind it.
 */
export class SpacedQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;
  private pausedUntil = 0;

  constructor(
    private readonly spacingMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** No call starts before `epochMs` (a 429's reset time). Never shortens a pause. */
  pauseUntil(epochMs: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, epochMs);
  }

  async run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    try {
      await abortable(previous, signal);
      for (;;) {
        const wait = Math.max(this.lastStart + this.spacingMs, this.pausedUntil) - this.now();
        if (wait <= 0) break;
        await abortable(delay(wait), signal);
      }
      this.lastStart = this.now();
      return await work();
    } finally {
      // The next caller waits for the one before this one too: an aborted
      // waiter must not let two calls run at once.
      void previous.then(release);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/** `promise`, or a rejection with the signal's reason as soon as it aborts. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
