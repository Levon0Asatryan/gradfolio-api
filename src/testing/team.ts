import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { newId } from '../core/db/ids.js';
import { buildApp, captureLogs } from './app.js';
import { testConfig, testDatabase } from './database.js';
import { createUser } from './factories.js';
import type { TestTenant } from './jwks.js';

/** Shared setup for the team integration tests (M5): an app, people with tokens, and row readers. */

export const db = testDatabase();

export interface Person {
  user: Awaited<ReturnType<typeof createUser>>;
  auth: { Authorization: string };
}

export async function startTeamApp(
  tenant: TestTenant,
  logs: ReturnType<typeof captureLogs>,
  env: NodeJS.ProcessEnv = {},
): Promise<{ app: NestExpressApplication; http: ReturnType<typeof request> }> {
  const app = await buildApp(
    testConfig({
      LOG_LEVEL: 'warn',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      ...env,
    }),
    undefined,
    { logs },
  );
  return { app, http: request(app.getHttpServer()) };
}

export async function person(
  tenant: TestTenant,
  label: string,
  over: Parameters<typeof createUser>[1] = {},
): Promise<Person> {
  const sub = `auth0|${label}-${newId()}`;
  const user = await createUser(db, { auth0Id: sub, name: label, ...over });
  return { user, auth: { Authorization: `Bearer ${await tenant.sign({ sub })}` } };
}

export const membershipOf = (projectId: string, userId: string) =>
  db
    .selectFrom('projectTeamMembers')
    .select(['id', 'status', 'role', 'name', 'createdAt'])
    .where('projectId', '=', projectId)
    .where('userId', '=', userId)
    .executeTakeFirst();

export const membersOf = (projectId: string) =>
  db
    .selectFrom('projectTeamMembers')
    .select(['id', 'userId', 'status', 'name'])
    .where('projectId', '=', projectId)
    .execute();

export const notificationsOf = (userId: string) =>
  db
    .selectFrom('notifications')
    .select(['id', 'type', 'params', 'referenceId', 'link', 'isRead'])
    .where('userId', '=', userId)
    .orderBy('createdAt')
    .execute();

export const countNotifications = async () =>
  Number(
    (
      await db
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );

export const addMember = (
  projectId: string,
  userId: string | null,
  status: 'pending' | 'accepted' | 'rejected',
  name = 'm',
) =>
  db
    .insertInto('projectTeamMembers')
    .values({ id: newId(), projectId, userId, name, status })
    .execute();
