import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureLogs } from '../../../testing/app.js';
import { adminDatabaseUrl, testDatabaseUrl } from '../../../testing/database.js';
import { createProject } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import {
  addMember,
  countNotifications,
  db,
  membersOf,
  person,
  startTeamApp,
} from '../../../testing/team.js';

/**
 * A team change and its notification are one transaction (docs/m5-plan.md §5,
 * §9): a failure on either side leaves neither. Both directions, for every
 * write that notifies, plus once with a real MySQL error from a trigger.
 *
 * The notification writer is wrapped, not replaced: `before` throws instead of
 * writing (the change has been made, the notification has not), `after` writes
 * and then throws (both have been made). Either way the response is 500 and
 * the database must look untouched.
 */

const control = vi.hoisted((): { mode: 'pass' | 'before' | 'after' } => ({ mode: 'pass' }));

vi.mock('../../notifications/repositories/notification-write.repository.js', async (original) => {
  const real =
    await original<
      typeof import('../../notifications/repositories/notification-write.repository.js')
    >();
  return {
    ...real,
    insertTeamNotification: async (...args: Parameters<typeof real.insertTeamNotification>) => {
      if (control.mode === 'before') throw new Error('forced failure before the notification');
      await real.insertTeamNotification(...args);
      if (control.mode === 'after') throw new Error('forced failure after the notification');
    },
  };
});

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();

beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  control.mode = 'pass';
  await db.deleteFrom('users').execute();
});
afterEach(async () => {
  control.mode = 'pass';
  logs.clear();
  await app?.close();
  app = undefined;
});

async function setup() {
  const started = await startTeamApp(tenant, logs, { LOG_LEVEL: 'fatal' });
  app = started.app;
  const owner = await person(tenant, 'owner');
  const invitee = await person(tenant, 'invitee');
  const { project } = await createProject(db, owner.user, { title: 'Gradfolio' });
  return { http: started.http, owner, invitee, project };
}

const state = async (projectId: string) => ({
  members: await membersOf(projectId),
  notifications: await countNotifications(),
});

describe.each(['before', 'after'] as const)('a failure %s the notification is written', (mode) => {
  it('invite: no membership and no notification', async () => {
    const { http, owner, invitee, project } = await setup();
    control.mode = mode;
    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id })
      .expect(500);
    expect(await state(project.id)).toEqual({ members: [], notifications: 0 });
  });

  it('re-invite: the row stays rejected, no notification', async () => {
    const { http, owner, invitee, project } = await setup();
    await addMember(project.id, invitee.user.id, 'rejected');
    const before = await state(project.id);
    control.mode = mode;
    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id, role: 'Dev' })
      .expect(500);
    expect(await state(project.id)).toEqual(before);
    expect(before.members[0]).toMatchObject({ status: 'rejected' });
  });

  it.each(['accept', 'reject'] as const)(
    '%s: the invitation stays pending, the owner is not told',
    async (action) => {
      const { http, invitee, project } = await setup();
      await addMember(project.id, invitee.user.id, 'pending');
      const before = await state(project.id);
      control.mode = mode;
      await http.post(`/v1/projects/${project.id}/team/me/${action}`).set(invitee.auth).expect(500);
      expect(await state(project.id)).toEqual(before);
      expect(before.members[0]).toMatchObject({ status: 'pending' });
    },
  );

  it('leave: the member is still on the team, the owner is not told', async () => {
    const { http, invitee, project } = await setup();
    await addMember(project.id, invitee.user.id, 'accepted');
    const before = await state(project.id);
    control.mode = mode;
    await http.delete(`/v1/projects/${project.id}/team/me`).set(invitee.auth).expect(500);
    expect(await state(project.id)).toEqual(before);
  });
});

describe('the writes that notify do notify when nothing fails (the proofs above would pass on a no-op)', () => {
  it('invite, accept and leave each leave exactly one notification', async () => {
    const { http, owner, invitee, project } = await setup();
    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id })
      .expect(201);
    expect(await countNotifications()).toBe(1);
    await http.post(`/v1/projects/${project.id}/team/me/accept`).set(invitee.auth).expect(200);
    expect(await countNotifications()).toBe(2);
    await http.delete(`/v1/projects/${project.id}/team/me`).set(invitee.auth).expect(204);
    expect(await countNotifications()).toBe(3);
  });
});

describe('a real MySQL error while writing the notification', () => {
  it('rolls the membership back (a trigger refuses the insert)', async () => {
    const { http, owner, invitee, project } = await setup();
    const dbName = new URL(testDatabaseUrl()).pathname.slice(1);
    const admin = await createConnection({ uri: adminDatabaseUrl(), database: dbName });
    try {
      await admin.query('DROP TRIGGER IF EXISTS m5_refuse_notifications');
      await admin.query(
        "CREATE TRIGGER m5_refuse_notifications BEFORE INSERT ON notifications FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'refused'",
      );
      await http
        .post(`/v1/projects/${project.id}/team`)
        .set(owner.auth)
        .send({ userId: invitee.user.id })
        .expect(500);
      expect(await state(project.id)).toEqual({ members: [], notifications: 0 });
    } finally {
      await admin.query('DROP TRIGGER IF EXISTS m5_refuse_notifications');
      await admin.end();
    }
    // and with the trigger gone the same call works
    await http
      .post(`/v1/projects/${project.id}/team`)
      .set(owner.auth)
      .send({ userId: invitee.user.id })
      .expect(201);
  });
});
