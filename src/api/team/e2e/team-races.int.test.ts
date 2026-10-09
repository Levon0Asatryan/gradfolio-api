import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection, type Connection } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { captureLogs } from '../../../testing/app.js';
import { waitForLockWaiters } from '../../../testing/barrier.js';
import { testDatabaseUrl } from '../../../testing/database.js';
import { createProject } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import {
  addMember,
  countNotifications,
  db,
  membersOf,
  membershipOf,
  notificationsOf,
  person,
  startTeamApp,
} from '../../../testing/team.js';

/**
 * Races, forced with a barrier and never a sleep: a second connection holds a
 * lock, the competing requests are started, the test waits until MySQL shows
 * them blocked behind it (performance_schema.data_lock_waits), then releases
 * the lock. Exactly one of the competitors wins, and what is stored agrees
 * with what each was told (docs/m5-plan.md §4.3).
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
const holders: Connection[] = [];

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  await db.deleteFrom('users').execute();
});
afterEach(async () => {
  for (const c of holders.splice(0)) await c.end().catch(() => undefined);
  logs.clear();
  await app?.close();
  app = undefined;
});

async function holder() {
  const conn = await createConnection({ uri: testDatabaseUrl() });
  holders.push(conn);
  await conn.query('BEGIN');
  return conn;
}

async function setup() {
  const started = await startTeamApp(tenant, logs, { LOG_LEVEL: 'fatal' });
  app = started.app;
  const owner = await person(tenant, 'owner');
  const invitee = await person(tenant, 'invitee');
  const { project } = await createProject(db, owner.user, { title: 'Gradfolio', isPublic: false });
  return { http: started.http, owner, invitee, project };
}

const statusOf = (p: PromiseLike<{ status: number }>) => Promise.resolve(p).then((r) => r.status);

describe('double invite', () => {
  it('one invitation wins, the other is ALREADY_MEMBER: one row, one notification', async () => {
    const { http, owner, invitee, project } = await setup();
    const lock = await holder();
    await lock.query('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);
    const send = () =>
      statusOf(
        http
          .post(`/v1/projects/${project.id}/team`)
          .set(owner.auth)
          .send({ userId: invitee.user.id }),
      );
    const both = [send(), send()];
    await waitForLockWaiters(2);
    await lock.query('COMMIT');

    expect((await Promise.all(both)).toSorted()).toEqual([201, 409]);
    expect(await membersOf(project.id)).toHaveLength(1);
    expect(await notificationsOf(invitee.user.id)).toHaveLength(1);
  });
});

describe('double accept', () => {
  it('one accept wins, the other is INVITE_NOT_PENDING: the owner is told once', async () => {
    const { http, owner, invitee, project } = await setup();
    await addMember(project.id, invitee.user.id, 'pending');
    const lock = await holder();
    await lock.query(
      'SELECT id FROM project_team_members WHERE project_id = ? AND user_id = ? FOR UPDATE',
      [project.id, invitee.user.id],
    );
    const accept = () =>
      statusOf(http.post(`/v1/projects/${project.id}/team/me/accept`).set(invitee.auth));
    const both = [accept(), accept()];
    await waitForLockWaiters(2);
    await lock.query('COMMIT');

    expect((await Promise.all(both)).toSorted()).toEqual([200, 409]);
    expect(await membershipOf(project.id, invitee.user.id)).toMatchObject({ status: 'accepted' });
    expect(await notificationsOf(owner.user.id)).toHaveLength(1);
  });

  it('accept against reject: one answer stands, the owner hears one thing', async () => {
    const { http, owner, invitee, project } = await setup();
    await addMember(project.id, invitee.user.id, 'pending');
    const lock = await holder();
    await lock.query(
      'SELECT id FROM project_team_members WHERE project_id = ? AND user_id = ? FOR UPDATE',
      [project.id, invitee.user.id],
    );
    const answers = [
      statusOf(http.post(`/v1/projects/${project.id}/team/me/accept`).set(invitee.auth)),
      statusOf(http.post(`/v1/projects/${project.id}/team/me/reject`).set(invitee.auth)),
    ];
    await waitForLockWaiters(2);
    await lock.query('COMMIT');

    expect((await Promise.all(answers)).toSorted()).toEqual([200, 409]);
    const stored = await membershipOf(project.id, invitee.user.id);
    const told = await notificationsOf(owner.user.id);
    expect(told).toHaveLength(1);
    expect(told[0]!.type).toBe(stored!.status === 'accepted' ? 'team_accepted' : 'team_rejected');
  });
});

describe('accept against remove', () => {
  it('remove first: the accept is 404 and the owner is told nothing', async () => {
    const { http, owner, invitee, project } = await setup();
    await addMember(project.id, invitee.user.id, 'pending');
    const memberId = (await membershipOf(project.id, invitee.user.id))!.id;
    const lock = await holder();
    await lock.query('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);

    const remove = statusOf(
      http.delete(`/v1/projects/${project.id}/team/${memberId}`).set(owner.auth),
    );
    await waitForLockWaiters(1);
    const accept = statusOf(
      http.post(`/v1/projects/${project.id}/team/me/accept`).set(invitee.auth),
    );
    await waitForLockWaiters(2);
    await lock.query('COMMIT');

    expect([await remove, await accept]).toEqual([204, 404]);
    expect(await membersOf(project.id)).toEqual([]);
    expect(await countNotifications()).toBe(0);
  });

  it('accept first: it commits with its notification, then the removal takes the row', async () => {
    const { http, owner, invitee, project } = await setup();
    await addMember(project.id, invitee.user.id, 'pending');
    const memberId = (await membershipOf(project.id, invitee.user.id))!.id;
    const lock = await holder();
    await lock.query('SELECT id FROM project_team_members WHERE id = ? FOR UPDATE', [memberId]);

    const accept = statusOf(
      http.post(`/v1/projects/${project.id}/team/me/accept`).set(invitee.auth),
    );
    await waitForLockWaiters(1);
    const remove = statusOf(
      http.delete(`/v1/projects/${project.id}/team/${memberId}`).set(owner.auth),
    );
    await waitForLockWaiters(2);
    await lock.query('COMMIT');

    expect([await accept, await remove]).toEqual([200, 204]);
    expect(await membersOf(project.id)).toEqual([]);
    expect((await notificationsOf(owner.user.id)).map((n) => n.type)).toEqual(['team_accepted']);
  });
});

describe('invite against the invitee deleting their account', () => {
  it('is a 404 with nothing written, not a foreign-key error', async () => {
    const { http, owner, invitee, project } = await setup();
    const lock = await holder();
    await lock.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [invitee.user.id]);
    const invite = statusOf(
      http
        .post(`/v1/projects/${project.id}/team`)
        .set(owner.auth)
        .send({ userId: invitee.user.id }),
    );
    await waitForLockWaiters(1);
    await lock.query('DELETE FROM users WHERE id = ?', [invitee.user.id]);
    await lock.query('COMMIT');

    expect(await invite).toBe(404);
    expect(await membersOf(project.id)).toEqual([]);
    expect(await countNotifications()).toBe(0);
  });
});

describe('invite against the owner deleting the project', () => {
  it('is a 404 and leaves no orphan membership or notification', async () => {
    const { http, owner, invitee, project } = await setup();
    const lock = await holder();
    await lock.query('SELECT id FROM projects WHERE id = ? FOR UPDATE', [project.id]);
    const invite = statusOf(
      http
        .post(`/v1/projects/${project.id}/team`)
        .set(owner.auth)
        .send({ userId: invitee.user.id }),
    );
    await waitForLockWaiters(1);
    await lock.query('DELETE FROM projects WHERE id = ?', [project.id]);
    await lock.query('COMMIT');

    expect(await invite).toBe(404);
    expect(await countNotifications()).toBe(0);
    expect(await membersOf(project.id)).toEqual([]);
    expect(newId()).toBeTruthy();
  });
});
