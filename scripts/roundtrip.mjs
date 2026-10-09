// A real round trip against a running API with a real access token, cleaning up after itself.
//
//   API_URL=https://… TOKEN=<access token> node scripts/roundtrip.mjs            (rows only)
//   API_URL=https://… TOKEN=<access token> FILES=1 node scripts/roundtrip.mjs    (+ uploads, signed reads)
//   … PAUSE=1 node scripts/roundtrip.mjs   (stop before the delete so the stored rows can be read)
//
// Creates one project (title "m4-roundtrip-<time>"), exercises every field and attachment type,
// edits, reorders, then deletes it; with FILES=1 it uploads a hero image and a PDF through the
// signed-upload flow, reads them back through the signed read URLs, and checks the objects are
// gone after the project is. With PAUSE=1 it prints the project id to stderr and waits for Enter
// on stdin before the delete, so the rows can be compared with what was sent. Each upload is
// registered (hero set, attachment added) before the next fallible step, so a failure leaves
// nothing the project delete does not remove. The token is read from the environment and never printed.
// Exits 1 on the first failed check, after trying to delete what it created.
const API = (process.env.API_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.TOKEN ?? '';
const FILES = process.env.FILES === '1';
const PAUSE = process.env.PAUSE === '1';
if (!API || !TOKEN) {
  console.error('set API_URL and TOKEN');
  process.exit(2);
}
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let projectId;
let failed = 0;
const check = (cond, message) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${message}`);
  if (!cond) {
    failed++;
    throw new Error(`check failed: ${message}`);
  }
};
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const anonymous = (path) =>
  fetch(API + path).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));

async function upload(purpose, bytes, contentType) {
  const ticket = await call('POST', '/v1/me/uploads', {
    purpose,
    contentType,
    size: bytes.length,
    projectId,
  });
  check(ticket.status === 201, `upload ticket for ${purpose} ${contentType}: ${ticket.status}`);
  const t = ticket.body;
  check(
    'x-goog-if-generation-match' in t.headers && 'x-goog-content-length-range' in t.headers,
    'the ticket signs the size range and the create-only precondition',
  );
  const put = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: bytes });
  check(put.status === 200, `browser-style PUT to the signed URL: ${put.status}`);
  return { fileUrl: t.fileUrl, replay: () => replayRefused(t, bytes) };
}
// Run only after the file is registered: a failing check here must not orphan the object.
async function replayRefused(t, bytes) {
  const replay = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: bytes });
  check(replay.status === 412, `replaying the same signed URL is refused: ${replay.status}`);
}

try {
  const ready = await fetch(`${API}/readyz`);
  check(ready.status === 200, `GET /readyz: ${ready.status}`);

  const title = `m4-roundtrip-${new Date().toISOString()}`;
  const created = await call('POST', '/v1/projects', {
    title,
    summary: 'Round trip.',
    descriptionHtml:
      '<h2>Hi</h2><p>ok <a href="https://example.com">link</a></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    category: 'research',
    status: 'ongoing',
    isPublic: true,
    liveDemoUrl: 'https://example.com/demo',
    repoUrl: 'https://github.com/example/example',
    heroImageUrl: 'https://img.example/h.png',
    metadata: {
      startDate: '2025-01-15',
      endDate: '2025-06-01',
      course: 'Course',
      professor: 'Prof',
    },
    technologies: ['Go', 'go', 'Python'],
    tags: ['m4', 'roundtrip'],
    links: [{ label: 'Docs', url: 'https://docs.example/' }],
    files: [{ label: 'Report', url: 'https://files.example/r.pdf' }],
  });
  check(created.status === 201, `POST /v1/projects: ${created.status}`);
  projectId = created.body.id;
  check(
    !/<script|javascript:/i.test(created.body.descriptionHtml) &&
      created.body.technologies.length === 2,
    'description sanitized on write; technologies de-duplicated case-insensitively',
  );

  const att = async (type, url, title) => {
    const r = await call('POST', `/v1/projects/${projectId}/attachments`, { type, url, title });
    check(r.status === 201, `attachment ${type}: ${r.status}`);
    return r.body;
  };
  const image = await att('image', 'https://img.example/a.png', 'Image');
  const video = await att('video', 'https://youtu.be/dQw4w9WgXcQ', 'Video');
  const pdf = await att('pdf', 'https://files.example/a.pdf', 'PDF');
  const link = await att('link', 'https://example.com/a', 'Link');
  check(
    video.embedUrl?.startsWith('https://www.youtube-nocookie.com/embed/'),
    'video has an embed URL',
  );

  const edit = await call('PATCH', `/v1/projects/${projectId}`, {
    status: 'completed',
    tags: ['m4'],
    metadata: { professor: null },
  });
  const sent = created.body;
  const keptMeta = (m) =>
    m.startDate === '2025-01-15' &&
    m.endDate === '2025-06-01' &&
    m.course === 'Course' &&
    m.professor === null;
  check(edit.status === 200, `PATCH: ${edit.status}`);
  check(edit.body.status === 'completed', 'PATCH changed the status');
  check(
    keptMeta(edit.body.metadata),
    'PATCH merged metadata per key: professor cleared, the other three keys kept',
  );
  check(
    JSON.stringify(edit.body.tags) === JSON.stringify(['m4']),
    `PATCH replaced the tags with exactly ["m4"]: ${JSON.stringify(edit.body.tags)}`,
  );
  check(
    edit.body.title === title &&
      edit.body.category === 'research' &&
      edit.body.technologies.length === 2 &&
      edit.body.links.length === sent.links.length &&
      edit.body.files.length === sent.files.length,
    'PATCH left the fields it did not name alone',
  );
  const order = [link.id, pdf.id, video.id, image.id];
  const reordered = await call('PUT', `/v1/projects/${projectId}/attachments/order`, {
    ids: order,
  });
  check(
    reordered.status === 200 && reordered.body.map((a) => a.id).join() === order.join(),
    'attachments reordered exactly as asked',
  );
  const stale = await call('PUT', `/v1/projects/${projectId}/attachments/order`, {
    ids: order.slice(1),
  });
  check(stale.status === 409, `an incomplete order list is refused: ${stale.status}`);

  let heroKeyUrl;
  if (FILES) {
    const hero = await upload('hero', PNG, 'image/png');
    heroKeyUrl = hero.fileUrl;
    const set = await call('PATCH', `/v1/projects/${projectId}`, { heroImageUrl: hero.fileUrl });
    check(set.status === 200, `PATCH heroImageUrl with the uploaded file: ${set.status}`);
    await hero.replay();
    const pdfUp = await upload('attachment', PDF, 'application/pdf');
    const doc = pdfUp.fileUrl;
    const file = await call('POST', `/v1/projects/${projectId}/attachments`, {
      type: 'pdf',
      url: doc,
      title: 'Uploaded PDF',
    });
    check(file.status === 201, `attachment from the uploaded PDF: ${file.status}`);
    await pdfUp.replay();
    const reuse = await call('POST', `/v1/projects/${projectId}/attachments`, {
      type: 'pdf',
      url: doc,
    });
    check(
      reuse.status === 400 && reuse.body.code === 'FILE_IN_USE',
      'the same uploaded file cannot be used twice',
    );
  }

  const detail = await call('GET', `/v1/projects/${projectId}`);
  check(detail.status === 200 && detail.body.isOwner === true, 'GET as the owner');
  check(detail.body.attachments.length === (FILES ? 5 : 4), 'all attachments present');
  check(
    detail.body.status === 'completed' &&
      keptMeta(detail.body.metadata) &&
      JSON.stringify(detail.body.tags) === '["m4"]',
    'the edit persisted: a fresh read shows the status, the merged metadata and the replaced tags',
  );
  const signedUrls = [];
  if (FILES) {
    const hero = detail.body.heroImageUrl;
    check(
      hero !== heroKeyUrl && /x-goog-signature=/i.test(hero),
      'hero comes back as a signed read URL',
    );
    const heroRes = await fetch(hero);
    check(
      heroRes.status === 200 && heroRes.headers.get('content-type') === 'image/png',
      'signed hero reads: 200 image/png',
    );
    const unsigned = await fetch(heroKeyUrl);
    check(
      unsigned.status === 403,
      `the stored URL without a signature is refused: ${unsigned.status}`,
    );
    const pdfAtt = detail.body.attachments.find((a) => a.title === 'Uploaded PDF');
    const pdfRes = await fetch(pdfAtt.url);
    check(
      pdfRes.status === 200 && pdfRes.headers.get('content-type') === 'application/pdf',
      'signed PDF reads: 200 application/pdf',
    );
    signedUrls.push(hero, pdfAtt.url);
  }

  if (PAUSE) {
    console.error(`PAUSED: project ${projectId} exists; read its rows, then press Enter to delete`);
    await new Promise((resolve) => process.stdin.once('data', resolve).once('end', resolve));
  }
  const del = await call('DELETE', `/v1/projects/${projectId}`);
  check(del.status === 204, `DELETE /v1/projects/:id: ${del.status}`);
  const id = projectId;
  projectId = undefined;
  check(
    (await call('GET', `/v1/projects/${id}`)).status === 404,
    'the project is gone (404 even for its owner)',
  );
  check((await anonymous(`/v1/projects/${id}`)).status === 404, 'and for anonymous');
  for (const url of signedUrls) {
    const gone = await fetch(url);
    check(
      gone.status === 404,
      `its object is gone from storage (an old signed URL now 404s): ${gone.status}`,
    );
  }
  console.log('\nround trip complete; nothing left behind');
} catch (err) {
  console.error(String(err.message ?? err));
  failed++;
} finally {
  if (projectId !== undefined) {
    const r = await call('DELETE', `/v1/projects/${projectId}`).catch(() => ({ status: 'error' }));
    console.error(`cleanup: DELETE ${projectId} -> ${r.status}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
