/**
 * The extension headers a signed upload carries besides Content-Type. They are
 * part of the signature, so the browser must send them, so the bucket's CORS
 * `responseHeader` list must name every one (and Content-Type): the preflight
 * for a header that is not listed is refused. docker/gcs-cors.json is that
 * list; cors-config.test.ts fails when the two drift.
 */
export function uploadHeaders(size: number): Record<string, string> {
  return {
    'x-goog-content-length-range': `${size},${size}`,
    // create-only: the URL writes its key once; a replay is a 412
    'x-goog-if-generation-match': '0',
  };
}
