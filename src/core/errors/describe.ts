/**
 * Renders any thrown value as a single log-safe line.
 *
 * **This function must never throw.** It is called from error paths only,
 * where a second exception would replace the first or escape as an uncaught
 * exception. Every branch is defensive, and the whole body is wrapped.
 */
export function describeError(err: unknown): string {
  try {
    return describe(err);
  } catch {
    return safeTypeOf(err);
  }
}

function describe(err: unknown): string {
  if (err instanceof AggregateError) {
    // Node reports a failed connection to a host with several addresses this
    // way, and an AggregateError carries no message of its own.
    return describeAggregate(err);
  }

  if (err instanceof Error) {
    const base = describeOne(err);
    // The ES2022 `cause` chain, one level only: a circular chain must not
    // recurse forever inside a function whose contract is "never throws".
    const cause: unknown = err.cause;
    if (cause === undefined) return base;
    const causeText =
      cause instanceof AggregateError
        ? describeAggregate(cause)
        : cause instanceof Error
          ? describeOne(cause)
          : typeof cause === 'string'
            ? cause
            : safeTypeOf(cause);
    return `${base} (cause: ${causeText})`;
  }

  if (typeof err === 'string') return err;
  if (err === null) return 'null';
  if (err === undefined) return 'undefined';
  if (typeof err === 'bigint') return `${err.toString()}n`;
  if (typeof err === 'number' || typeof err === 'boolean') return String(err);
  // String(symbol) is safe; a template literal on one would throw.
  if (typeof err === 'symbol') return err.toString();
  if (typeof err === 'function') return `[function ${err.name || 'anonymous'}]`;

  return safeStringify(err);
}

/** `code: message`, falling back to whichever of the two exists. */
function describeOne(err: Error): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (err.message) return code && code !== err.message ? `${code}: ${err.message}` : err.message;
  return code ?? err.name;
}

/** The constituents' own messages, one level deep, deduplicated. */
function describeAggregate(agg: AggregateError): string {
  const errors: unknown[] = Array.isArray(agg.errors) ? agg.errors : [];
  const parts = errors
    .map((e) => (e instanceof Error ? describeOne(e) : typeof e === 'string' ? e : safeTypeOf(e)))
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique.join('; ') : agg.message || 'AggregateError';
}

/** JSON.stringify throws on cycles, BigInt and a throwing toJSON; none may escape. */
function safeStringify(value: object): string {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (_key, val: unknown) => {
    if (typeof val === 'bigint') return `${val.toString()}n`;
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[circular]';
      seen.add(val);
    }
    return val;
  }) as string | undefined;
  return json ?? safeTypeOf(value);
}

function safeTypeOf(value: unknown): string {
  try {
    return Object.prototype.toString.call(value);
  } catch {
    return '[unrepresentable]';
  }
}
