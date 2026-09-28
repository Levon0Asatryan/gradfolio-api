import type { IncomingMessage } from 'node:http';
import { stdSerializers } from 'pino-http';

/**
 * Drops the query string from every logged request, keeping the path.
 *
 * pino-http's default serializer logs the whole `url`, querystring included,
 * plus a separate `query` object with the same data. Neither is a field a
 * redaction path can match, so a search term or an OAuth callback's `code`
 * would otherwise reach every request log line.
 */
export function requestSerializer(req: IncomingMessage): Record<string, unknown> {
  const serialized = stdSerializers.req(req) as unknown as Record<string, unknown>;
  const { query: _query, ...rest } = serialized;
  const url = typeof rest.url === 'string' ? requestUrlPath(rest.url) : rest.url;
  return { ...rest, url };
}

/** The same treatment for callers that only have the raw URL string. */
export function requestUrlPath(url: string): string {
  return url.split('?')[0] ?? url;
}
