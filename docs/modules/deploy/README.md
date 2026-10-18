# Deploy: API on Google Cloud

**Status:** done (2026-10-05). The API runs on Cloud Run, the database on Cloud SQL
(MySQL 8.4, us-east1), migrations run as a Cloud Run job, and GitHub Actions deploys
`main` through Workload Identity Federation.

| Document          | Where                                                      |
| ----------------- | ---------------------------------------------------------- |
| Runbook           | [../../ops/deploy.md](../../ops/deploy.md)                 |
| Plan              | [plan.md](plan.md)                                         |
| Verification      | [verification.md](verification.md)                         |
| Prompt and report | [process/handoffs/deploy/](../../process/handoffs/deploy/) |
