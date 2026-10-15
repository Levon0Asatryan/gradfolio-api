import { inspect } from 'node:util';

const REDACTED = '[redacted]';

/**
 * A credential held in memory (a GitHub token, a Management API token). The
 * value is reachable only through `reveal()`: `JSON.stringify`, a template
 * string and `util.inspect` (what a logger or a stray `console.log` uses) all
 * print `[redacted]`, so logging the object by mistake writes nothing usable
 * (docs/m7-plan.md §2.2).
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The credential itself: only for the header of the request that needs it. */
  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
