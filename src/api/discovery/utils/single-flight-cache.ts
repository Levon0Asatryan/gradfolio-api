/**
 * One value, served from memory for `ttlMs`, loaded by one caller at a time
 * (docs/m6-plan.md §3.4). Concurrent misses share the single load; a load that
 * fails is not cached and is thrown to every waiter, so the next request tries
 * again. `ttlMs` of 0 caches nothing (each call loads, concurrent ones share).
 *
 * The clock is a parameter so a test can hold time still without sleeping.
 */
export class SingleFlightCache<T> {
  private value: { at: number; data: T } | undefined;
  private loading: Promise<T> | undefined;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<T> {
    const hit = this.value;
    if (hit !== undefined && this.now() - hit.at < this.ttlMs) return Promise.resolve(hit.data);
    this.loading ??= this.load()
      .then((data) => {
        this.value = { at: this.now(), data };
        return data;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
}
