# HTTP request collection

Every endpoint the API serves, as runnable requests. One file per module, named
after the module it exercises.

| File                         | Module        | Covers                                      |
| ---------------------------- | ------------- | ------------------------------------------- |
| [health.http](health.http)   | `api/health`  | liveness, readiness                         |
| [common.http](common.http)   | `api/common`  | not-found fallback, error shape, body limit |
| [openapi.http](openapi.http) | `api/openapi` | Swagger UI and the document it renders      |

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
