# HTTP request collection

Every endpoint the API serves, as runnable requests. One file per module, named
after the module it exercises.

| File                                     | Module              | Covers                                                                            |
| ---------------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| [health.http](health.http)               | `api/health`        | liveness, readiness                                                               |
| [common.http](common.http)               | `api/common`        | not-found fallback, error shape, body limit                                       |
| [openapi.http](openapi.http)             | `api/openapi`       | Swagger UI and the document it renders                                            |
| [me.http](me.http)                       | `api/me`            | the caller's account; 401 without a token                                         |
| [sections.http](sections.http)           | `api/profiles`      | education, experience, certifications and skills: create, change, delete, reorder |
| [profiles.http](profiles.http)           | `api/profiles`      | profiles by id (anonymous and signed in), the caller's header                     |
| [projects.http](projects.http)           | `api/projects`      | read a project, the caller's list, a user's list; create, change, delete          |
| [team.http](team.http)                   | `api/team`          | the owner's view of a project's memberships                                       |
| [notifications.http](notifications.http) | `api/notifications` | the caller's notifications: list, unread count, mark one or all read              |
| [activities.http](activities.http)       | `api/activities`    | the caller's activity feed                                                        |
| [discovery.http](discovery.http)         | `api/discovery`     | public search, tag pages and cloud, project gallery, people directory             |
| [dashboard.http](dashboard.http)         | `api/dashboard`     | the caller's dashboard: counts, recent projects, activity feed                    |

**A module added later gets a file here in the same pull request.** A file that
does not list every route its module serves is worse than none: the gap reads as
"this endpoint does not exist".

## Running them

Install [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)
(VS Code offers it from `.vscode/extensions.json`), start the stack, then click
**Send Request** above any request:

```sh
docker compose up -d --build
```

## What is not here

Assertions. These are for looking at responses while developing; the behaviour
they show is covered by the test suites, which is what CI runs.
