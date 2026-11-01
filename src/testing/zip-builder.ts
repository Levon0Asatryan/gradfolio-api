import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP writer for tests, with control a real writer withholds: the declared sizes
 * can lie, a name can be anything, the encrypted bit can be set. Only what the importer's
 * guards look at is modelled (stored or deflated entries, no ZIP64, no data descriptors).
 */
export interface ZipEntrySpec {
  name: string;
  data?: Buffer | string;
  method?: 'store' | 'deflate';
  /** Declared uncompressed size in the central directory and local header (default: true size). */
  declaredSize?: number;
  /** Declared compressed size (default: true size). */
  declaredCompressed?: number;
  encrypted?: boolean;
  /** Skip the data: for an entry that only has to be declared (a directory, a lie about size). */
  noData?: boolean;
}

export function buildZip(entries: ZipEntrySpec[], comment = ''): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const raw = Buffer.from(e.data ?? '');
    const stored = e.method !== 'deflate';
    const body = e.noData ? Buffer.alloc(0) : stored ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, 'utf8');
    const flags = (e.encrypted ? 1 : 0) | 0x0800;
    const size = e.declaredSize ?? raw.length;
    const csize = e.declaredCompressed ?? body.length;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(csize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(stored ? 0 : 8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(csize, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);

    offset += local.length + name.length + body.length;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  const commentBytes = Buffer.from(comment);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...parts, dir, end, commentBytes]);
}
