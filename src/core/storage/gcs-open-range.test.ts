import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Storage } from '@google-cloud/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GcsFileStorage } from './gcs-file-storage.js';

/**
 * `openRange` takes an exclusive end and Google's `end` is inclusive. Run against the real
 * client talking to a local HTTP server: the Range header it puts on the wire is what the
 * bucket receives, so an off-by-one here would corrupt every ZIP read.
 */
const OBJECT = Buffer.from('0123456789abcdefghij');
const seen: string[] = [];
let server: Server;
let storage: GcsFileStorage;

beforeAll(async () => {
  server = createServer((req, res) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range));
    seen.push(String(req.headers.range));
    if (range === null) {
      res.writeHead(200).end(OBJECT);
      return;
    }
    const body = OBJECT.subarray(Number(range[1]), Number(range[2]) + 1);
    res
      .writeHead(206, { 'content-range': `bytes ${range[1]}-${range[2]}/${OBJECT.length}` })
      .end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  storage = new GcsFileStorage(
    'test-bucket',
    new Storage({
      apiEndpoint: `http://127.0.0.1:${port}`,
      projectId: 'test',
      useAuthWithCustomEndpoint: false,
    }),
  );
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function read(start: number, end: number): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of storage.openRange('imports/u/x.zip', start, end)) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

describe('GcsFileStorage.openRange', () => {
  it('reads bytes start (inclusive) to end (exclusive)', async () => {
    seen.length = 0;
    expect(await read(2, 6)).toBe('2345');
    expect(seen).toEqual(['bytes=2-5']);
  });

  it('reads one byte, and up to the last byte', async () => {
    expect(await read(0, 1)).toBe('0');
    expect(await read(18, 20)).toBe('ij');
  });
});
