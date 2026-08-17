# CLAUDE.md

Guidance for Claude Code (or any future session) working in this repository.

## Project Summary

Real-Time Collaborative Document Editor — a browser-based document editor where multiple users
edit the same document simultaneously, see each other's live cursors/selections, and never lose a
keystroke to a conflicting edit. Conflict resolution is handled client-side via a CRDT (Yjs),
synchronized through a Node.js WebSocket server, with PostgreSQL persistence (snapshots + an
append-only operation log), JWT auth, and per-document owner/editor/viewer permissions.

Full requirements: [PRD.md](PRD.md). Full architecture/schema/API/protocol design:
[TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md). Full 18-phase build plan: [ROADMAP.md](ROADMAP.md).

## Tech Stack

- **Frontend**: React (Vite), Yjs (CRDT client), rich-text editing surface (ProseMirker/Yjs
  binding, added in later phases)
- **Backend**: Node.js, Express, `ws` for the WebSocket gateway
- **Database**: PostgreSQL (`pg`, parameterized SQL, no ORM)
- **Auth**: JWT access + refresh tokens, per-document ACLs
- **Logging**: pino (structured JSON logging — no raw `console.log` past Phase 2)
- **DevOps**: Docker Compose (local dev), GitHub Actions (lint/test/build)
- **Deployment target**: Render or Fly.io (WebSocket-compatible), managed Postgres

## Repository Structure

```
server/
  migrations/
    001_init.sql    — full schema (users, documents, document_permissions,
                       document_snapshots, operation_log, refresh_tokens)
  src/
    routes/       — Express route handlers (thin, delegate to services) [empty, Phase 4+]
    services/      — business logic [empty, Phase 6+]
    db/            — query functions (parameterized SQL via pg)
      pool.js              — shared pg.Pool
      applyMigrations.js   — shared migration-runner logic
      migrate.js           — dev migration runner (npm run migrate)
      resetTestDb.js       — destructive test-DB reset (npm run test:reset-db)
      *.repo.js            — one per table/domain: users, documents, permissions,
                              snapshots, operationLog
    middleware/     — JWT verification, error handling [empty, Phase 3+]
    websocket/      — connection handling, room management, broadcast logic [empty, Phase 7+]
    app.js          — Express app construction (no listener — testable)
    index.js        — entrypoint, starts the HTTP listener
  tests/
    env.setup.js    — preloaded via `node --import`; points DATABASE_URL at server/.env.test
    db/             — repo-layer tests, one file per repo module, run against a real
                      disposable Postgres database (server/tests/db/helpers.js has the
                      shared TRUNCATE/fixture helpers)
  .env              — host-side env (gitignored; DATABASE_URL uses `localhost`, not `postgres`)
  .env.test         — test-DB env (gitignored; see .env.test.example)
client/
  src/
    App.jsx, main.jsx, etc.
PRD.md
TECHNICAL_DESIGN.md   — partially populated (Section 4 "Backend Module Design" only so far)
ROADMAP.md
docker-compose.yml
.env.example
```

## Naming & File Conventions

- Backend modules: `camelCase.js`
- React components: `PascalCase.jsx`
- Data access modules: `*.repo.js`
- Business logic modules: `*.service.js`
- Tests: `*.test.js` / `*.spec.js`
- One branch per phase: `phase-N-short-description`

## Global Engineering Standards (apply to every phase)

- Every write path — REST and WebSocket — verifies authentication **and** authorization
  server-side. Never trust what the client claims or what the UI hides.
- All SQL parameterized, never string-concatenated.
- No secret, password hash, or token ever hardcoded, committed, or logged.
- ESLint + Prettier clean on every commit; no phase introduces a lint failure.
- Structured logging via pino only — no raw `console.log` left in committed code past Phase 2.
- Tests are written in the same phase as the code they cover, not deferred to a later phase.
- Claude does not perform any git operations (init/add/commit/push/branch/merge) — the user
  handles all of git themselves. Claude confirms the current branch before editing files each
  phase.

## Current Status

**Phase 0 — Repository, Environment & Tooling Foundation: ✅ Done (merged to main)**

- Monorepo scaffolded: `server/` (Express, health check at `GET /healthz`) and `client/`
  (Vite + React, placeholder page).
- `docker-compose.yml` wired for postgres + server + client; `.env.example` and `.gitignore` in
  place.
- ESLint + Prettier configured and passing in both `server/` and `client/`.
- GitHub Actions CI (`.github/workflows/ci.yml`) runs lint for both packages on every push/PR.

**Phase 1 — Database Schema, Migrations & Data Access Layer: ✅ Done**

- `server/migrations/001_init.sql` — full schema exactly matching PRD.md Section 10.4 (6 tables,
  the `document_permissions.role` CHECK constraint, both indexes). Verified against a live
  Postgres via `\dt` / `\d`.
- Migration runner (`npm run migrate`) and a separate, safety-guarded test-DB reset script
  (`npm run test:reset-db` — refuses to run against any database whose name doesn't contain
  `test`), sharing one `applyMigrations()` implementation.
- Repo layer: `documents.repo.js`, `permissions.repo.js`, `snapshots.repo.js`,
  `operationLog.repo.js` implemented to the exact signatures from TECHNICAL_DESIGN.md Section 4;
  `users.repo.js` added by judgment call (create/findByEmail/findById — password hashing is left
  to a later auth-service phase, this layer just stores/retrieves whatever hash it's given).
  Every query is parameterized.
- 25 passing tests in `server/tests/db/`, run against a real disposable Postgres database (not
  mocked), including a test that confirms the `role` CHECK constraint rejects an invalid value.
  Test files must run serially (`--test-concurrency=1`) — Node's test runner spawns one process
  per file by default, and since all files share one test database, parallel files were
  truncating each other's fixtures mid-test; forcing serial execution fixed it.
- Discovered and resolved a local environment issue (not project-specific): a native Windows
  PostgreSQL 17 service was also bound to port 5432, colliding with Docker's Postgres container.
  Resolved by stopping/disabling the native service — this project only ever uses the Docker
  Postgres container.
- `applyMigrations()` tracks applied filenames in a `schema_migrations` table so `npm run migrate`
  is safe to re-run (skips already-applied files instead of erroring on "relation already
  exists") — found this gap when re-running the migrate command a second time against the dev DB.
- `TECHNICAL_DESIGN.md` still only has Section 4 pasted in — the rest (Sections 1–3, 5–10) will
  be added as later phases need them.

**Next: Phase 2 — Backend Application Skeleton**

Branch in progress: `phase-1-db-schema` (not yet merged — pending user verification and commit).
