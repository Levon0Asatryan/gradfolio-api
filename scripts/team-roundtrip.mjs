// A real two-account round trip of M5 (teams and notifications) against a running API, with
// two real access tokens, cleaning up after itself.
//
//   API_URL=https://… TOKEN_A=<owner's access token> TOKEN_B=<second account's> \
//     node scripts/team-roundtrip.mjs
//
// A (the owner) creates two projects, one public and one private, and invites B; B sees the
// notification, accepts, and the public project is on both profiles; B rejects an invitation
// to the private one, A invites B again, B accepts, A removes B. Along the way B is refused
// (404) on A's team and notifications, and A on B's. Tokens come from the environment and are
// never printed. Both accounts must have a public profile. Exits 1 on the first failed check,
// after trying to delete what it created.
//
// After every team change it also reads GET /v1/me/teams for both accounts and compares the
// project's state on each side with the stored rows (the owner's own team list). Needs an API with
// that route (M5 5.8).
//
// Left behind, because the API has no way to delete a notification: a few read notifications
// on both accounts (about projects that no longer exist; they render from their saved names).
const API = (process.env.API_URL ?? '').replace(/\/$/, '');
const TOKENS = { A: process.env.TOKEN_A ?? '', B: process.env.TOKEN_B ?? '' };
if (!API || !TOKENS.A || !TOKENS.B) {
  console.error('set API_URL, TOKEN_A and TOKEN_B');
  process.exit(2);
}
const created = [];
const check = (cond, message) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${message}`);
  if (!cond) throw new Error(`check failed: ${message}`);
};
const call = async (who, method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${TOKENS[who]}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const tag = `m5-roundtrip-${Date.now()}`;

try {
  const ready = await fetch(`${API}/readyz`);
  check(ready.status === 200, `GET /readyz: ${ready.status}`);

  const a = (await call('A', 'GET', '/v1/me')).body;
  const b = (await call('B', 'GET', '/v1/me')).body;
  check(a?.id && b?.id && a.id !== b.id, 'two different accounts');
  const mk = async (suffix, isPublic) => {
    const r = await call('A', 'POST', '/v1/projects', { title: `${tag}-${suffix}`, isPublic });
    check(r.status === 201, `A creates the ${suffix} project: ${r.status}`);
    created.push(r.body.id);
    return r.body.id;
  };
  const pub = await mk('public', true);
  const priv = await mk('private', false);
  const unreadB = async () =>
    (await call('B', 'GET', '/v1/me/notifications/unread-count')).body.count;
  const inviteOf = async (who, projectId) =>
    (await call(who, 'GET', '/v1/me/notifications?limit=50')).body.items.find(
      (n) => n.params?.projectId === projectId && n.type === 'team_invite',
    );

  // GET /v1/me/teams, read for both accounts and reduced to what one project looks like
  // from each side, then compared with what the step must have stored.
  const teamsOf = async (who) => (await call(who, 'GET', '/v1/me/teams?limit=50')).body;
  const teamState = async (projectId) => {
    const [ta, tb] = [await teamsOf('A'), await teamsOf('B')];
    const owned = ta.owned.items.find((p) => p.id === projectId);
    const stored = (await call('A', 'GET', `/v1/projects/${projectId}/team`)).body.items;
    // The owner's view must be exactly the stored rows (ids and statuses); an empty team is not listed.
    const same =
      JSON.stringify((owned?.members ?? []).map((m) => [m.id, m.status]).sort()) ===
      JSON.stringify(stored.map((m) => [m.id, m.status]).sort());
    const incoming = tb.incoming.items.find((i) => i.project.id === projectId);
    const member = tb.member.items.find((p) => p.id === projectId);
    return {
      ownedStatus: owned?.members.find((m) => m.userId === b.id)?.status ?? null,
      ownedMatchesStored: same,
      outgoing: ta.outgoing.items.some((o) => o.project.id === projectId && o.invitee.id === b.id),
      incoming: incoming ? { title: incoming.project.title, by: incoming.invitedBy.name } : null,
      member: member
        ? { owner: member.owner.id, onTeam: member.team.some((m) => m.userId === b.id) }
        : null,
      // B never owns or sends anything on A's project, and A is never a member of it
      crossed:
        tb.owned.items.some((p) => p.id === projectId) ||
        tb.outgoing.items.some((o) => o.project.id === projectId) ||
        ta.member.items.some((p) => p.id === projectId) ||
        ta.incoming.items.some((i) => i.project.id === projectId),
    };
  };
  const expectTeams = async (label, projectId, titleSuffix, want) => {
    const got = await teamState(projectId);
    const full = {
      ownedStatus: null,
      outgoing: false,
      incoming: null,
      member: null,
      crossed: false,
      ownedMatchesStored: true,
      ...want,
    };
    if (full.incoming) full.incoming = { title: `${tag}-${titleSuffix}`, by: a.name };
    if (full.member) full.member = { owner: a.id, onTeam: true };
    const canon = (o) =>
      JSON.stringify(o, (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)))
          : v,
      );
    if (canon(got) !== canon(full)) {
      console.error(`expected ${canon(full)}\n     got ${canon(got)}`);
    }
    check(canon(got) === canon(full), `/me/teams ${label}`);
  };

  // --- the lookup, the invitation, the notification
  const found = await call(
    'A',
    'GET',
    `/v1/users/lookup?q=${encodeURIComponent(b.name.slice(0, 3))}`,
  );
  check(
    found.status === 200 && found.body.items.some((u) => u.id === b.id),
    'A finds B in the lookup',
  );
  check(!found.body.items.some((u) => u.id === a.id), 'the lookup never returns the caller');
  check(
    (await call('A', 'POST', `/v1/projects/${pub}/team`, { userId: a.id })).status === 400,
    'A cannot invite A',
  );
  const before = await unreadB();
  const inv = await call('A', 'POST', `/v1/projects/${pub}/team`, {
    userId: b.id,
    role: 'Teammate',
  });
  check(inv.status === 201 && inv.body.status === 'pending', 'A invites B: pending');
  await expectTeams('after the invitation', pub, 'public', {
    ownedStatus: 'pending',
    outgoing: true,
    incoming: true,
  });
  check(
    (await call('A', 'POST', `/v1/projects/${pub}/team`, { userId: b.id })).body?.code ===
      'ALREADY_MEMBER',
    'a second invitation: ALREADY_MEMBER',
  );
  check((await unreadB()) === before + 1, 'B has one more unread notification');
  const note = await inviteOf('B', pub);
  check(
    note && note.invite.status === 'pending' && note.read === false,
    'B sees the invitation, pending',
  );
  check(
    note.params.actorName === a.name && note.params.projectTitle === `${tag}-public`,
    'it renders from saved names',
  );

  // --- the second user cannot touch the other's team or notifications
  check(
    (await call('B', 'GET', `/v1/projects/${pub}/team`)).status === 404,
    'B cannot list A’s team (404)',
  );
  check(
    (await call('B', 'POST', `/v1/projects/${pub}/team`, { userId: a.id })).status === 404,
    'B cannot invite on A’s project (404)',
  );
  check(
    (await call('B', 'DELETE', `/v1/projects/${pub}/team/${inv.body.id}`)).status === 404,
    'B cannot remove (404)',
  );
  check(
    (await call('A', 'POST', `/v1/projects/${pub}/team/me/accept`)).status === 404,
    'A cannot accept B’s invitation (404)',
  );
  check(
    (await call('A', 'POST', `/v1/me/notifications/${note.id}/read`)).status === 404,
    'A cannot mark B’s notification (404)',
  );
  check((await inviteOf('B', pub)).read === false, 'and it is still unread');

  // --- accept: both profiles, the owner is told
  const acc = await call('B', 'POST', `/v1/projects/${pub}/team/me/accept`);
  check(acc.status === 200 && acc.body.status === 'accepted', 'B accepts');
  await expectTeams('after the accept', pub, 'public', { ownedStatus: 'accepted', member: true });
  check(
    (await call('B', 'POST', `/v1/projects/${pub}/team/me/accept`)).body?.code ===
      'INVITE_NOT_PENDING',
    'a second accept: INVITE_NOT_PENDING',
  );
  check(
    (await inviteOf('B', pub)).invite.status === 'accepted',
    'B’s notification now reads accepted',
  );
  check(
    (await call('B', 'POST', `/v1/me/notifications/${note.id}/read`)).status === 204,
    'B marks it read',
  );
  const told = (await call('A', 'GET', '/v1/me/notifications?limit=50')).body.items.find(
    (n) => n.type === 'team_accepted' && n.params.projectId === pub,
  );
  check(
    told && told.link === `/projects/${pub}`,
    'A is told, with a link computed from the project',
  );
  const onProfile = async (who, userId) =>
    (await call(who, 'GET', `/v1/users/${userId}`)).body.projects.find((p) => p.id === pub);
  check((await onProfile('A', a.id))?.role === 'owner', 'the project is on A’s profile as owner');
  check((await onProfile('A', b.id))?.role === 'member', 'and on B’s profile as member');
  // Only this round trip's rows count: an account may already have older activities.
  const feedKeys = async (who) =>
    (await call(who, 'GET', '/v1/me/activities?limit=50')).body.items
      .filter((i) => i.translationParams?.projectId === pub)
      .map((i) => i.translationKey);
  const feedA = await feedKeys('A');
  const feedB = await feedKeys('B');
  check(
    feedA.includes('teamInvited') && feedA.includes('teamMemberJoined'),
    'A’s feed has the invitation and the join for this project',
  );
  check(feedB.includes('teamJoined'), 'B’s feed has the join for this project');

  // --- the private project: reject, invite again, accept, remove
  check(
    (await call('A', 'POST', `/v1/projects/${priv}/team`, { userId: b.id })).status === 201,
    'A invites B to the private project',
  );
  await expectTeams('private, invited', priv, 'private', {
    ownedStatus: 'pending',
    outgoing: true,
    incoming: true,
  });
  check(
    (await call('B', 'GET', `/v1/projects/${priv}`)).status === 404,
    'a pending invitee cannot read it (404)',
  );
  check(
    (await call('B', 'POST', `/v1/projects/${priv}/team/me/reject`)).body?.status === 'rejected',
    'B rejects',
  );
  await expectTeams('private, rejected', priv, 'private', { ownedStatus: 'rejected' });
  check(
    (await call('B', 'GET', `/v1/projects/${priv}`)).status === 404,
    'a rejected invitee cannot read it (404)',
  );
  const again = await call('A', 'POST', `/v1/projects/${priv}/team`, { userId: b.id });
  check(
    again.status === 201 && again.body.status === 'pending',
    'A invites B again: back to pending',
  );
  const rows = (await call('A', 'GET', `/v1/projects/${priv}/team`)).body.items;
  check(rows.length === 1, 'still one membership row (updated, not inserted)');
  await expectTeams('private, invited again', priv, 'private', {
    ownedStatus: 'pending',
    outgoing: true,
    incoming: true,
  });
  check(
    (await call('B', 'POST', `/v1/projects/${priv}/team/me/accept`)).status === 200,
    'B accepts',
  );
  await expectTeams('private, accepted', priv, 'private', {
    ownedStatus: 'accepted',
    member: true,
  });
  check(
    (await call('B', 'GET', `/v1/projects/${priv}`)).status === 200,
    'an accepted teammate reads the private project',
  );
  check(
    (await call('A', 'DELETE', `/v1/projects/${priv}/team/${rows[0].id}`)).status === 204,
    'A removes B',
  );
  await expectTeams('private, removed (no team left, so not listed)', priv, 'private', {});
  check(
    (await call('B', 'GET', `/v1/projects/${priv}`)).status === 404,
    'B can no longer read it (404)',
  );

  // --- B leaves the public project; the owner is told
  check(
    (await call('B', 'DELETE', `/v1/projects/${pub}/team/me`)).status === 204,
    'B leaves the public project',
  );
  check((await onProfile('A', b.id)) === undefined, 'it is off B’s profile');
  await expectTeams('after B left (no team left, so not listed)', pub, 'public', {});
  const leftNote = (await call('A', 'GET', '/v1/me/notifications?limit=50')).body.items.find(
    (n) => n.type === 'team_left' && n.params.projectId === pub,
  );
  check(leftNote && leftNote.params.actorName === b.name, 'A is told that B left');
  console.log('PASS  round trip complete');
} catch (err) {
  console.error(String(err.message));
  process.exitCode = 1;
} finally {
  for (const id of created) {
    const r = await call('A', 'DELETE', `/v1/projects/${id}`).catch(() => ({ status: 0 }));
    console.log(
      `${r.status === 204 ? 'PASS' : 'FAIL'}  cleanup: delete project ${id}: ${r.status}`,
    );
    if (r.status !== 204) process.exitCode = 1;
  }
  for (const who of ['A', 'B']) {
    const r = await call(who, 'POST', '/v1/me/notifications/read-all').catch(() => ({ status: 0 }));
    console.log(
      `${r.status === 200 ? 'PASS' : 'FAIL'}  cleanup: ${who} marks notifications read: ${r.status}`,
    );
    if (r.status !== 200) process.exitCode = 1;
  }
}
