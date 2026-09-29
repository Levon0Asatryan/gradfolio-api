# Contributing to gradfolio-api

Gradfolio is a student portfolio platform built as NPUA university coursework. This
repository is its backend API. Issues and pull requests are welcome, with one
expectation up front: a change is judged on correctness and on the evidence behind
it, not on its size.

This file is the short version. The conventions themselves live in files that are
kept up to date with the code, so they are not repeated here:

| File                               | What it holds                                                |
| ---------------------------------- | ------------------------------------------------------------ |
| [README.md](README.md)             | Running it locally, configuration, the repository layout     |
| [CLAUDE.md](CLAUDE.md)             | How work is done, file and folder structure, naming, commits |
| [AGENTS.md](AGENTS.md)             | What a review checks for. Read it before opening a PR.       |
| [docs/tracker.md](docs/tracker.md) | What is in progress and what is next                         |
| [openapi.yaml](openapi.yaml)       | The HTTP API, generated from the request schemas             |

## Reporting a bug or asking for a feature

Open an issue from one of the templates. For a bug, the most useful thing you can
give is a request that reproduces it. The files in [`http/`](http/) are runnable and
a good starting point.

**Security issues are not reported in public.** See [SECURITY.md](SECURITY.md).

## Setting up

You need Node 24 (see `.nvmrc`) and Docker. Then:

```sh
npm ci
cp .env.example .env
docker compose up -d mysql
npm run dev
```

[README.md](README.md) covers configuration and the full container stack.

## Making a change

1. Branch from the latest `main`, then run `npm ci` again, because dependencies
   differ between branches.
2. Keep each pull request to one coherent step, and split its commits by logical
   change.
   - Tests go in the same commit as the code they test.
   - Each commit must pass the pre-commit hook on its own.
3. **A guard, check or filter ships with a test that fails without it.**
   - Remove the guard, watch the test fail, then put it back. A test that has never
     been seen failing is not evidence.
   - For authorization, the test is a second user getting `404`.
   - Force races with an explicit barrier, not by hoping `Promise.all` interleaves.
4. A new or changed endpoint updates `openapi.yaml` (`npm run openapi`) and its
   request in `http/<module>.http`, in the same change.
5. Before opening the PR, run:

   ```sh
   npm run verify          # format, lint, types, unit tests, openapi check
   npm run test:coverage   # must stay at or above the threshold
   npm run test:int        # needs: docker compose up -d mysql
   ```

   The pre-push hook also runs `/gradfolio-review` (Claude Code) through
   `scripts/require-review.sh`. See `CLAUDE.md`.

CI runs every job on every push, and all of them must pass. Two automated reviewers,
GitHub Copilot and Codex, review each push. Request both with
`sh scripts/request-review.sh`. Every thread gets a reply, whether that is a fix or a reasoned
disagreement.

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).
