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
    config.js       — the ONLY module that reads process.env directly; fails fast at import
                      time if a required var is missing
    routes/
      auth.routes.js         — POST /api/auth/{register,login,refresh}, mounted at /api/auth
      documents.routes.js    — full documents REST API, mounted at /api/documents; every
                                route runs authenticate, writes also run requireRole(...)
      permissions.routes.js  — mounted at /api/documents/:id/permissions (mergeParams);
                                owner-only; blocks granting 'owner' or revoking the owner
    services/
      authService.js       — bcrypt hashing (cost 12), access+refresh token issuance,
                              refresh-token rotation
      permissionService.js — satisfiesRole(actual, required); owner > editor > viewer
      documentService.js   — ensureUserCanAccess(); createNewDocument() (atomic doc +
                              owner-grant via withTransaction); loadDocumentState() (returns
                              latest snapshot only for now — full Yjs hydration is Phase 7)
    db/            — query functions (parameterized SQL via pg)
      pool.js              — shared pg.Pool, built from config.databaseUrl
      withTransaction.js   — runs a callback inside BEGIN/COMMIT/ROLLBACK on one checked-out
                              client; documents.repo.createDocument and
                              permissions.repo.grantPermission accept an optional trailing
                              `client` param (default: pool) so they can share one transaction
      applyMigrations.js   — shared migration-runner logic
      migrate.js           — dev migration runner (npm run migrate)
      resetTestDb.js       — destructive test-DB reset (npm run test:reset-db)
      *.repo.js            — one per table/domain: users, documents, permissions,
                              snapshots, operationLog, refreshTokens
    middleware/
      errorHandler.js — centralized Express error handler (mounted last); logs full error
                        server-side, returns only { error: { code, message } } to the client
      authenticate.js — verifies Authorization: Bearer <token>, sets req.user, 401 on
                        anything missing/malformed/expired/tampered; mounted on every
                        documents/permissions route since Phase 4
      requireRole.js  — factory: requireRole('editor') etc.; calls documentService's
                        ensureUserCanAccess against req.params.id, 403 via errorHandler on
                        denial
    utils/
      logger.js       — pino structured logger (no console.log anywhere in the codebase)
      jwt.js          — sign(payload)/verify(token) helpers, access-token secret by default
      errors.js        — AppError + typed subclasses (ValidationError, AuthError,
                        PermissionError, NotFoundError, ConflictError) carrying
                        statusCode/code for errorHandler
    app.js          — Express app construction (no listener — testable); CORS locked to
                      config.corsOrigin, auth + documents routes mounted, errorHandler
                      mounted last, GET /healthz checks the DB
    index.js        — entrypoint; starts the HTTP listener, has process-level
                      unhandledRejection/uncaughtException logging
  tests/
    env.setup.js    — preloaded via `node --import`; points DATABASE_URL (and now
                      CORS_ORIGIN/JWT secrets, since config.js requires them) at server/.env.test
    config.test.js, jwt.test.js, errorHandler.test.js — unit/integration tests for the skeleton
    middleware/authenticate.test.js
    services/authService.test.js, permissionService.test.js, documentService.test.js
    routes/auth.routes.test.js — full register/login/refresh integration tests against a
                                  real ephemeral server + test DB
    integration/documentsApi.test.js — full documents+permissions API lifecycle against a
                                        real ephemeral server + test DB (create/list/rename/
                                        delete, cascade, grant/revoke, every 403 negative case)
    db/             — repo-layer tests, one file per repo module, run against a real
                      disposable Postgres database (server/tests/db/helpers.js has the
                      shared TRUNCATE/fixture helpers)
  .env              — host-side env (gitignored; DATABASE_URL uses `localhost`, not `postgres`)
  .env.test         — test-DB env (gitignored; see .env.test.example)
  .dockerignore     — excludes node_modules from the build context (missing since Phase 0;
                      fixed in Phase 3 — was silently overwriting the image's Linux-built
                      native modules with the host's, breaking bcrypt in Docker)
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

**Phase 1 — Database Schema, Migrations & Data Access Layer: ✅ Done (merged to main)**

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

**Phase 2 — Backend Application Skeleton: ✅ Done (merged to main)**

- `config.js` — single source of truth for env vars; fails fast at import time if
  `DATABASE_URL`, `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, or `JWT_REFRESH_SECRET` is missing.
  `PORT`, `NODE_ENV`, `LOG_LEVEL`, and JWT expiry vars have sensible defaults.
- Moved `logger.js` from `server/src/logger.js` (Phase 0) into `server/src/utils/logger.js` to
  match this phase's conventions — updated every file that imported the old path
  (`app.js`, `index.js`, `applyMigrations.js`, `migrate.js`, `resetTestDb.js`).
- Retrofitted `pool.js`, `migrate.js`, and `resetTestDb.js` to read `config.databaseUrl` instead
  of `process.env.DATABASE_URL` directly, so `config.js` really is the only file reading
  `process.env` — this also meant expanding `.env.test`/`.env.test.example` to include
  `CORS_ORIGIN` and both JWT secrets (previously just `DATABASE_URL`), since anything importing
  a repo module now transitively imports `config.js`.
- `utils/jwt.js` — `sign(payload, opts?)` / `verify(token, opts?)`, defaulting to the access-token
  secret/expiry. Refresh tokens per PRD 10.6 are opaque, hashed, DB-stored tokens, not JWTs, so
  this pair is deliberately generic rather than access/refresh-specific — flagged for
  reconsideration if Phase 3 needs something different.
- `middleware/errorHandler.js` — mounted last in `app.js`; logs full errors server-side via pino,
  returns only `{ error: { code, message } }` to the client. Verified via an integration test
  using a throwaway Express app (not a permanent debug route) that the response never leaks
  internal error text.
- `GET /healthz` now runs `SELECT 1` against the DB pool and reports `db: 'ok'|'error'` without
  ever crashing the process — verified live by stopping/restarting the Postgres container against
  the running Docker server and confirming `503`/`200` transitions correctly.
- 32 passing tests total (7 new: `config.test.js`, `jwt.test.js`, `errorHandler.test.js`).

**Phase 3 — Authentication & Authorization System: ✅ Done (merged to main)**

- `authService.js` — bcrypt password hashing (cost factor 12, documented reasoning in comments);
  `issueTokenPair()` issues a signed access token (via Phase 2's `jwt.js`) plus an opaque
  64-byte random refresh token, stored in `refresh_tokens` hashed with SHA-256 (not bcrypt —
  refresh tokens are already high-entropy, so a fast deterministic hash is correct here and
  enables direct lookup by value; bcrypt is for low-entropy user-chosen secrets like passwords).
  `rotateRefreshToken()` deletes the presented token immediately (single-use) before issuing a
  new pair, so a stolen/reused old refresh token is always rejected.
- Added `db/refreshTokens.repo.js` — wasn't built in Phase 1 even though the table existed;
  needed now, follows the same repo conventions.
- `auth.routes.js` — `POST /api/auth/{register,login,refresh}`, mounted at `/api/auth` in
  `app.js`. Register validates email format + min 8-char password, returns 409 on duplicate
  email (with a defense-in-depth catch on the DB unique-constraint race). Login returns the
  *identical* generic 401 for a wrong password and a nonexistent email — verified both by test
  and live curl — and `verifyPassword` always runs a real bcrypt comparison (against a fixed
  dummy hash when no user was found) so response timing doesn't leak account existence either.
- `authenticate.js` — Bearer-token middleware, not wired into any route yet (nothing to protect
  until Phase 4+ adds document routes).
- `permissionService.js` (`satisfiesRole`) and the first slice of `documentService.js`
  (`ensureUserCanAccess`) — the rest of `documentService.js` is Phase 4.
- `utils/errors.js` — added (not explicitly listed in the phase scope, but needed for
  `errorHandler.js`'s statusCode/code convention to actually be used consistently across auth
  routes/services): `AppError` + `ValidationError`/`AuthError`/`PermissionError`/`NotFoundError`/
  `ConflictError`.
- 27 new tests (59 total): unit tests for `authService`/`authenticate`/`permissionService`/
  `documentService`, plus a full integration suite for the three routes against a real ephemeral
  server + test database (register/login/refresh happy paths, weak password, duplicate email,
  wrong-password-vs-unknown-email parity, rotation + reuse rejection).
- **Found and fixed a real Docker bug**: `server/.dockerignore` never existed (since Phase 0).
  `COPY . .` in `server/Dockerfile` was copying the host's own `node_modules` (Windows-native
  binaries) into the image on top of the Linux-built ones from `npm install`, silently working
  for pure-JS deps but corrupting `bcrypt`'s native binary (`invalid ELF header`) once this phase
  introduced it. Added `.dockerignore` to both `server/` and `client/` (client had the same
  latent bug, just never surfaced since it has no native deps).
**Phase 4 — Document & Permissions REST API: ✅ Done**

- `documentService.createNewDocument()` — creates the document row and grants the creator
  'owner' permission in a single atomic DB transaction (new `db/withTransaction.js` helper;
  `documents.repo.createDocument` and `permissions.repo.grantPermission` gained an optional
  trailing `client` param, backward-compatible with every existing call site, so they can
  share one transaction). A document can never exist without an owner.
- `documentService.loadDocumentState()` — Phase 4 slice only: returns the latest snapshot row
  as-is. Full Yjs hydration + operation-log replay is Phase 7.
- `requireRole.js` — middleware factory wrapping `ensureUserCanAccess`; 403 on denial.
- `documents.routes.js` — full REST table from PRD.md 10.5 (list, create, get, patch, delete,
  `GET /:id/versions`), every route behind `authenticate`, writes also behind the correct
  `requireRole`.
- `permissions.routes.js` (mounted at `/api/documents/:id/permissions`, owner-only) — list,
  grant, revoke. Two deliberate constraints beyond the literal endpoint table, to protect PRD
  10.7's "exactly one owner per document" invariant: **granting `role: 'owner'` is rejected**
  (only `editor`/`viewer` are grantable — ownership transfer isn't in scope), and **revoking the
  owner's own permission is rejected** (would orphan the document; deleting it is the only way
  to remove an owner grant).
- Requesting a document you have no permission on (or that doesn't exist) returns **403, not
  404** — `ensureUserCanAccess` can't distinguish "no such document" from "no such permission
  row," and deliberately doesn't leak which one it is, consistent with Phase 3's login-endpoint
  stance on not revealing information to unauthorized requests.
- 10 new tests (69 total): full lifecycle, atomic owner-grant, cascade-on-delete, editor can
  write after grant, viewer 403 on every write, non-owner 403 on all permission management,
  revoke-then-access-denied, both new constraints (owner-grant rejection, self-revoke
  rejection), and an auth-required sweep.
- Verified live against Docker end-to-end (curl walkthrough matching every test scenario,
  including checking `document_permissions` row counts in psql before/after delete to confirm
  the cascade).

**Next: Phase 5 — Frontend Foundation**

Branch in progress: `phase-4-documents-api` (not yet merged — pending user verification and
commit).
