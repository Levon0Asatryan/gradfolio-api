/**
 * One outbound HTTP request to a fixed upstream (Auth0, GitHub), with the
 * guards every such call needs: no redirects followed, a deadline, and a cap on
 * the response body. The URL is always built by the caller from configuration
 * and values it validated; nothing a user typed is fetched (SSRF, AGENTS.md).
 */

export interface UpstreamRequest {
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
  /** Aborts the request (and the wait for its body). */
  signal: AbortSignal;
  /** The most response body bytes read; beyond it the call fails. */
  maxBytes: number;
  /** Return the body as text (never JSON-parsed): for an HTML answer. */
  asText?: boolean;
}

export interface UpstreamResponse {
  status: number;
  headers: Headers;
  /** The parsed JSON body, or undefined when the body was empty or not JSON. */
  body: unknown;
  /** The body as UTF-8 text, only when the request asked for `asText`. */
  text?: string;
}

/** Why a request produced no response the caller can judge. */
export type UpstreamFailureKind = 'timeout' | 'aborted' | 'network' | 'too_large' | 'bad_body';

/**
 * The request failed before a judgeable response arrived. `source` names the
 * failure class and code for the log; never a URL, a header or a message, any
 * of which can carry a credential.
 */
export class UpstreamFailure extends Error {
  constructor(
    readonly kind: UpstreamFailureKind,
    readonly source: string,
    /** The response headers, when a response had arrived (a body over the cap). */
    readonly headers?: Headers,
  ) {
    super(`upstream request failed: ${kind}`);
    this.name = 'UpstreamFailure';
  }
}

function sourceOf(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const cause = (err as { cause?: unknown }).cause;
  const code =
    cause instanceof Error ? ((cause as { code?: unknown }).code ?? cause.name) : undefined;
  return typeof code === 'string' ? `${err.name} ${code}` : err.name;
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new UpstreamFailure('too_large', `content-length ${declared}`, res.headers);
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UpstreamFailure('too_large', `over ${maxBytes} bytes`, res.headers);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Performs the request; throws UpstreamFailure, never a raw fetch error. */
export async function upstreamRequest(url: URL, req: UpstreamRequest): Promise<UpstreamResponse> {
  const headers: Record<string, string> = { ...req.headers };
  if (req.json !== undefined) headers['content-type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      ...(req.json === undefined ? {} : { body: JSON.stringify(req.json) }),
      // A redirect from an API we call is never expected; following one would
      // send the credential to wherever it points.
      redirect: 'error',
      signal: req.signal,
    });
    const bytes = await readCapped(res, req.maxBytes);
    if (req.asText === true) {
      return {
        status: res.status,
        headers: res.headers,
        body: undefined,
        text: Buffer.from(bytes).toString('utf8'),
      };
    }
    let body: unknown;
    if (bytes.byteLength > 0 && /\bjson\b/i.test(res.headers.get('content-type') ?? '')) {
      try {
        body = JSON.parse(Buffer.from(bytes).toString('utf8'));
      } catch {
        throw new UpstreamFailure('bad_body', 'invalid JSON');
      }
    }
    return { status: res.status, headers: res.headers, body };
  } catch (err) {
    if (err instanceof UpstreamFailure) throw err;
    if (req.signal.aborted) {
      const reason: unknown = req.signal.reason;
      const timedOut = reason instanceof Error && reason.name === 'TimeoutError';
      throw new UpstreamFailure(timedOut ? 'timeout' : 'aborted', sourceOf(reason));
    }
    throw new UpstreamFailure('network', sourceOf(err));
  }
}

/**
 * Seconds to wait before retrying, from `Retry-After` (seconds) or a reset
 * time in epoch seconds (`x-ratelimit-reset`), at least 1. Undefined when
 * neither header is usable.
 */
export function retryAfterSeconds(
  headers: Headers,
  resetHeader: string,
  nowMs: number = Date.now(),
): number | undefined {
  const retryAfter = Number(headers.get('retry-after'));
  if (headers.has('retry-after') && Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.max(1, Math.ceil(retryAfter));
  }
  const reset = Number(headers.get(resetHeader));
  if (headers.has(resetHeader) && Number.isFinite(reset) && reset > 0) {
    return Math.max(1, Math.ceil(reset - nowMs / 1000));
  }
  return undefined;
}
