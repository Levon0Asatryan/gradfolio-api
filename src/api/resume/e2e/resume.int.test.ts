import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createProfile, createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { resumeRequestSchema } from '../dto/resume.dto.js';
import { ResumeService } from '../services/resume.service.js';

const db = testDatabase();
let app: NestExpressApplication;
let tenant: TestTenant;
beforeAll(async () => {
  tenant = await startTestTenant();
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'fatal',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      RATE_LIMIT_PDF: '2',
    }),
  );
});
afterAll(async () => {
  await app.close();
  await tenant.close();
});
beforeEach(async () => {
  await db.deleteFrom('users').execute();
});

describe('resume authorization and selection', () => {
  it('omits private fields and unselected sections; private own projects require explicit consent', async () => {
    const { user } = await createProfile(db, {
      auth0Id: 'auth0|resume',
      email: 'login-secret@example.com',
      phone: 'private-phone',
      name: 'Անի',
    });
    const publicProject = await createProject(db, user, { title: 'Public' });
    const privateProject = await createProject(db, user, { title: 'Private', isPublic: false });
    const draft = await createProject(db, user, { title: 'Draft', isDraft: true });
    const service = app.get(ResumeService);
    const data = await service.snapshot(
      user.id,
      resumeRequestSchema.parse({ sections: ['projects'] }),
    );
    expect(data.blocks[0]?.entries.map((e) => e.title)).toEqual(['Public']);
    expect(JSON.stringify(data)).not.toMatch(
      /login-secret|private-phone|TypeScript|National Polytechnic/,
    );
    await expect(
      service.snapshot(
        user.id,
        resumeRequestSchema.parse({
          sections: ['projects'],
          projectIds: [privateProject.project.id],
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    const selected = await service.snapshot(
      user.id,
      resumeRequestSchema.parse({
        sections: ['projects'],
        projectIds: [privateProject.project.id, draft.project.id],
        includePrivateProjects: true,
      }),
    );
    expect(selected.blocks[0]?.entries.map((e) => e.title).sort()).toEqual(['Draft', 'Private']);
    const other = await createUser(db);
    await request(app.getHttpServer())
      .post('/v1/me/resume')
      .set({ Authorization: `Bearer ${await tenant.sign({ sub: other.auth0Id })}` })
      .send({
        sections: ['projects'],
        projectIds: [publicProject.project.id],
        includePrivateProjects: true,
      })
      .expect(404);
    await expect(
      service.snapshot(
        other.id,
        resumeRequestSchema.parse({
          sections: ['projects'],
          projectIds: [publicProject.project.id],
          includePrivateProjects: true,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('permits accepted public team projects but refuses private team projects', async () => {
    const owner = await createUser(db);
    const member = await createUser(db);
    const { project } = await createProject(db, owner);
    await db
      .insertInto('projectTeamMembers')
      .values({
        id: crypto.randomUUID(),
        projectId: project.id,
        userId: member.id,
        name: member.name,
        status: 'accepted',
      })
      .execute();
    const input = resumeRequestSchema.parse({
      sections: ['projects'],
      projectIds: [project.id],
      includePrivateProjects: true,
    });
    expect(
      (await app.get(ResumeService).snapshot(member.id, input)).blocks[0]?.entries,
    ).toHaveLength(1);
    await db
      .updateTable('projects')
      .set({ isPublic: false })
      .where('id', '=', project.id)
      .execute();
    await expect(app.get(ResumeService).snapshot(member.id, input)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('authenticates downloads, returns binary with no-store, and enforces its own budget', async () => {
    const http = request(app.getHttpServer());
    await http.post('/v1/me/resume').send({ sections: [] }).expect(401);
    await createUser(db, { auth0Id: 'auth0|resume-http' });
    const auth = { Authorization: `Bearer ${await tenant.sign({ sub: 'auth0|resume-http' })}` };
    const response = await http
      .post('/v1/me/resume')
      .set(auth)
      .send({ sections: [], language: 'am' })
      .expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['cache-control']).toBe('private, no-store');
    const bytes = response.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    await http
      .post('/v1/me/resume')
      .set(auth)
      .send({ sections: ['phone'] })
      .expect(400);
    await http.post('/v1/me/resume').set(auth).send({ sections: [] }).expect(429);
  });
});
