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

- **Frontend**: React (Vite), react-router-dom, Yjs (CRDT client, later phases), rich-text
  editing surface (ProseMirror/Yjs binding, added in later phases)
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
                              owner-grant via withTransaction); loadDocumentState() — as of
                              Phase 7, fully implemented: returns a hydrated Y.Doc (snapshot
                              + operation-log replay), used by roomManager.getOrCreateRoom.
                              NOT what documents.routes.js's GET /:id uses for its
                              `latestSnapshot` field anymore — that goes straight to
                              snapshotsRepo.getLatestSnapshot() for the raw, JSON-serializable
                              row, since loadDocumentState's return type changed shape
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
    websocket/
      roomManager.js    — in-memory Room registry (documentId -> {yDoc, clients}). Rooms are
                          hydrated via documentService.loadDocumentState (snapshot + op-log
                          replay — usually empty today, since nothing writes either yet;
                          Phase 11 adds persistence-on-write). getOrCreateRoom is async and
                          coalesces concurrent creation attempts for the same documentId via
                          an in-flight-promise map, to avoid a duplicate-load race. Empty
                          rooms aren't torn down immediately — a 5s grace period
                          (ROOM_EMPTY_GRACE_PERIOD_MS) allows a quick reconnect without a
                          full reload.
      wsServer.js        — attaches `ws` to the same HTTP server as Express (one port)
      messageRouter.js   — message `type` -> handler dispatch (join-document, sync-update,
                          leave-document), UNKNOWN_MESSAGE_TYPE on a miss; wraps handler
                          calls so an unhandled rejection is logged, never crashes the process
      handlers/
        joinDocument.js  — as of Phase 7, requires a valid JWT (jwt.js's verify()) and at
                          least 'viewer' access (documentService.ensureUserCanAccess) —
                          same standard as every REST write path. Denial sends a clear error
                          then closes the socket (custom codes: 4001 unauthorized, 4003
                          permission denied)
        syncUpdate.js    — requires at least 'editor' access before applying/broadcasting;
                          denial sends PERMISSION_DENIED and does neither. Y.applyUpdate
                          failures are logged and dropped, never crash the room
        leaveDocument.js — explicit leave-document message; same removeClientFromRoom path
                          the ws 'close' event uses, so both get the same grace period
    utils/
      logger.js       — pino structured logger (no console.log anywhere in the codebase)
      jwt.js          — sign(payload)/verify(token) helpers, access-token secret by default
      errors.js        — AppError + typed subclasses (ValidationError, AuthError,
                        PermissionError, NotFoundError, ConflictError) carrying
                        statusCode/code for errorHandler
    app.js          — Express app construction (no listener — testable); CORS locked to
                      config.corsOrigin, auth + documents routes mounted, errorHandler
                      mounted last, GET /healthz checks the DB
    index.js        — entrypoint; creates an http.Server explicitly (so the WebSocket
                      server from Phase 6 can attach to the same port), has process-level
                      unhandledRejection/uncaughtException logging
  scripts/
    makeYjsUpdate.js, decodeYjsState.js — manual-testing-only CLI helpers (not part of the
      server) for generating/decoding base64 Yjs updates to use with wscat, since wscat
      can't hand-type valid binary CRDT payloads
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
    unit/crdtMerge.test.js — proves Yjs's convergence guarantee in isolation (no WebSocket,
                              no DB): identical final state regardless of update order,
                              across 2-way/3-way(all 6 permutations)/idempotency/randomized-
                              shuffle scenarios. The single most important test in the project.
    integration/multiClientSync.test.js — real HTTP+WS server (mirrors index.js's wiring
                              exactly), real JWTs via the actual register endpoint, real
                              grants via the actual permissions REST API: editor sync-update
                              accepted+broadcast, viewer sync-update rejected (and
                              positively confirmed NOT broadcast, via a race against a
                              timeout), invalid JWT rejected + socket closed, no-grant
                              stranger rejected at join, a late joiner receiving the room's
                              already-edited in-memory state via loadDocumentState, and (as
                              of Phase 9) 3 real concurrent clients making genuinely
                              overlapping same-position edits, converging to an identical
                              server-side result across 3 distinct delivery orderings
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
    api/
      httpClient.js   — fetch wrapper; owns token storage (see Current Status for the
                        token-storage decision) and the 401 -> silent-refresh-> retry flow
      authApi.js       — register/login/refresh, wraps httpClient.request (not
                        authenticatedRequest -- a 401 here is a real login error, not an
                        expired-session signal)
      documentsApi.js  — one function per Phase 4 backend endpoint, via
                        httpClient.authenticatedRequest
    hooks/
      useAuth.js       — AuthProvider + useAuth(); kept as plain .js (uses createElement,
                        not JSX syntax, since Vite only JSX-transforms .jsx by default)
      useYjsConnection.js — owns a Y.Doc + its WebSocket connection for one document;
                        exposes { yDoc, connectionStatus, canEdit, error }. See "Phase 8"
                        below for the origin-check/echo-loop and reconnect-backoff design.
    components/
      ProtectedRoute.jsx  — redirects to /login if not authenticated
      PermissionsPanel.jsx — owner-only; list/grant/revoke access
      EditorSurface.jsx    — plain contenteditable div bound to yDoc.getText('content');
                        diffs DOM input against the Y.Text via a common-prefix/suffix
                        range, no rich text/formatting
    pages/
      LoginPage.jsx, RegisterPage.jsx, DashboardPage.jsx, DocumentEditorPage.jsx
    App.jsx  — react-router-dom routes; main.jsx is the entrypoint (unchanged since Phase 0)
  tests/e2e/
    collaborativeEdit.spec.js — Playwright: 3 real browser contexts (3 real accounts),
                              typing simultaneously at the same position, asserting all
                              three converge to byte-identical, character-complete content.
                              The single most directly convincing proof in the project. Run
                              via `npm run test:e2e`; wired into CI's `e2e` job (Phase 9).
  playwright.config.js — points at tests/e2e/, expects the full stack already running
                              (locally via docker compose, in CI via the e2e job's own steps)
docs/
  manual-demo-script.md      — numbered live-demo script: 3-way simultaneous typing, then an
                              offline-edit-and-reconnect walkthrough, written to be followed
                              live without improvising
  crdt-convergence-explained.md — plain-language "explain it in an interview with no notes"
                              writeup of why CRDT convergence works; not a restatement of
                              code comments
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

**Phase 4 — Document & Permissions REST API: ✅ Done (merged to main)**

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
- **Post-merge bugfix (found during Phase 5 manual testing, fixed on the Phase 5 branch)**:
  `POST /:id/permissions` had two owner-protecting guards (block granting `role: 'owner'`, block
  revoking the owner) but missed a third variant of the same invariant — nothing stopped
  granting `editor`/`viewer` to a user who *already* held `owner` on that document.
  `grantPermission`'s upsert (`ON CONFLICT ... DO UPDATE SET role = EXCLUDED.role`) would
  silently overwrite their owner row. Real-world trigger: granting access to your own email while
  testing the UI's grant form silently downgrades your own ownership. Fixed by checking the
  target's current role before granting and rejecting with 400 if it's `owner`. Added a
  regression test (`granting editor/viewer to the current owner's own email is rejected and does
  not downgrade their role`) — 70 tests total. One pre-existing dev-DB document had this exact
  corruption (found via direct query); repaired with a single targeted `UPDATE` scoped to that
  exact `document_id`+`user_id`, verified no other rows were affected.

**Phase 5 — Frontend Foundation: ✅ Done (merged to main)**

- **Token storage decision** (explicitly asked for, not a default): the backend returns tokens
  in the JSON response body, not httpOnly cookies, so the strongest option (cookies JS literally
  can't read) isn't available without backend changes outside this phase's scope.
  - **Access token: in-memory only** (module-scoped variable in `httpClient.js`), never written
    to any Web Storage — it's the higher-value credential (used on every request), short-lived
    (15 min) by design, and leaves no persistent artifact for an XSS payload or anyone with
    devtools/disk access to read later.
  - **Refresh token + a small cached user profile: `sessionStorage`**, not `localStorage` — the
    app needs to survive a reload without forcing re-login, so *something* must persist; scoping
    it to the tab (cleared on close, never synced across tabs/browser restarts) bounds the
    exposure window versus `localStorage`'s indefinite lifetime. It's still readable by any
    script running on the page while the tab is open — that's inherent to Web Storage, not a
    sessionStorage-specific gap. The real fix is an httpOnly refresh-token cookie, which is a
    legitimate candidate for Phase 13 (Security Hardening) rather than a silent addition here.
- `httpClient.js` separates `request()` (plain, no auto-refresh — used by `authApi.js`, where a
  401 is a real "wrong credentials" error to show the user) from `authenticatedRequest()`
  (attaches the token, retries once after a silent refresh on 401, and notifies the app to clear
  auth state — causing `ProtectedRoute` to redirect to `/login` — if that refresh also fails).
- Added `authApi.js` and a `RegisterPage` beyond the phase's literal file list — both necessary
  to actually exercise register/login through the UI, which the phase's own verification
  checklist requires.
- **Found and fixed a real bug via manual browser testing** (Playwright, not just lint/build):
  React 18 StrictMode double-invokes effects in dev, and the session-restore effect in
  `useAuth.js` wasn't idempotent against that — it called `/api/auth/refresh` twice on mount,
  and since refresh tokens are single-use (rotate on redemption, per Phase 3), the second call
  presented a token the first had already consumed, failed, and incorrectly cleared a session
  that had actually restored fine. Confirmed in server logs (one refresh succeeded, one got
  "Invalid or expired refresh token"). Fixed with a `useRef` guard so the restore logic only
  ever actually runs once per mount, regardless of how many times StrictMode invokes the effect.
- Two known rough edges, deliberately left as-is rather than silently touching already-merged
  Phase 4 backend code: `PermissionsPanel` displays each grant's raw `userId` (a UUID) instead
  of an email/display name, because `listPermissionsForDocument` doesn't join to `users`; and
  the dashboard doesn't show each document's `role` per PRD FR-12, because `GET /api/documents`
  doesn't return one per document. Both are small, targeted backend query changes if you want
  them — flagging rather than assuming.
- Verified end-to-end in a real headless browser (Playwright, installed standalone in the
  scratchpad — not added as a project dependency): unauthenticated redirect, register, create
  document, open it, register a second account, grant it editor access, log out, redirect,
  repeat unauthenticated redirect, and a page-reload session-restore check. Zero console errors,
  zero failed/5xx requests, across two full runs after the StrictMode fix.

**Phase 6 — CRDT Sync Engine — Isolated Proof of Concept: ✅ Done (merged to main)**

- Added `yjs`. Built the WebSocket layer entirely in-memory, deliberately isolated from the rest
  of the product per this phase's explicit scope: no DB persistence (Phase 11), no auth on the
  socket (Phase 7 — see the large comment block at the top of `handlers/joinDocument.js`), no
  presence/awareness (Phase 10), no frontend wiring (Phase 8).
- `tests/unit/crdtMerge.test.js` — written first, before any WebSocket code, per the phase's own
  instruction. Four tests, deliberately more rigorous than "just one ordering": two-way
  concurrent edits merged in both orders; three-way concurrent edits merged under **all 6**
  possible permutations (asserts the *set* of distinct outcomes has size 1, not just one
  before/after comparison); duplicate-delivery idempotency; and 5 clients x 4 random-position
  edits each, merged under 8 independent random shuffles, all converging to the same result.
- `roomManager.js` matches TECHNICAL_DESIGN.md Section 4's sketch (`Room` class,
  `getOrCreateRoom`/`addClientToRoom`/`removeClientFromRoom`) plus `broadcastToRoom` — not
  explicitly named in this phase's own bullet list, but `syncUpdate.js`'s pseudocode calls it
  directly, so it's necessary supporting code, not scope creep.
- `index.js` now creates an explicit `http.Server` (`http.createServer(app)`) instead of calling
  `app.listen()` directly, so `wsServer.js` can attach a `ws` WebSocketServer to the same port
  via the `{ server }` option — `app.js` itself is unchanged, so every existing test (which
  imports `createApp()` directly) is unaffected.
- Manual verification tooling: `scripts/makeYjsUpdate.js` / `scripts/decodeYjsState.js` —
  `wscat` can't hand-type a valid binary Yjs update, so these generate/decode one to paste in.
  Documented in README with a full two-terminal `wscat` walkthrough.
- 74 tests total (4 new). Also verified live against the running Docker server with a scripted
  two/three-session WebSocket client (not just curl) covering: join → sync-step, broadcast in
  both directions, a late-joining third client correctly seeing the room's already-merged state
  (not just future updates), an unknown message type returning a clean error, and a malformed
  update being dropped with an `INVALID_UPDATE` error while the server stays healthy afterward
  (confirmed via `/healthz` immediately after). 13/13 live checks passed.
- Hit the same stale-anonymous-`node_modules`-volume Docker issue as Phase 3 (bcrypt) and Phase 5
  (react-router-dom) — this time with `yjs`. Documented it properly in the README this time
  (`--force-recreate --renew-anon-volumes`) instead of just fixing it silently again.

**Phase 7 — WebSocket Gateway — Production Integration: ✅ Done (merged to main)**

- `joinDocument.js` now requires a real JWT (`jwt.js`'s `verify()`, same as REST's
  `authenticate.js`) and at least `viewer` access (`documentService.ensureUserCanAccess`, the
  exact function every REST write path uses) — closes the Phase 6 gap where it accepted a bare
  `userId` at face value. Denial sends a clear error then closes the socket: custom close codes
  `4001` (unauthorized) and `4003` (permission denied), `1008` for a malformed message, `1011`
  for an unexpected server error.
- `syncUpdate.js` now requires at least `editor` access before applying or broadcasting; a
  denied update is neither applied nor broadcast — sends `PERMISSION_DENIED` back to the sender
  only.
- `documentService.loadDocumentState()` is now fully implemented: loads the latest snapshot (if
  any), replays every operation-log entry created after it, returns a hydrated `Y.Doc`. Since
  neither snapshot-writing nor operation-log-writing exist until Phase 11, this is almost always
  an empty `Y.Doc` today — expected, not a bug, and already correct for Phase 11 to build on.
- **Found and fixed a real regression this change caused**: `loadDocumentState`'s return type
  changed (raw snapshot row → hydrated `Y.Doc`), but `documents.routes.js`'s REST `GET /:id`
  (Phase 4) was still calling it expecting the old JSON-serializable shape — `res.json()` on a
  `Y.Doc` silently serializes to `{}`. Caught by the existing Phase 4 test suite failing
  (`full document lifecycle`, `{} !== null`), not by anything new. Fixed by having that route
  call `snapshotsRepo.getLatestSnapshot()` directly instead, since that's what it actually needs
  — `loadDocumentState` is correctly repurposed for the WebSocket room manager only.
- `roomManager.getOrCreateRoom` is now async (it awaits `loadDocumentState`), which introduces a
  real race the Phase 6 version never had: two clients joining the same not-yet-open document at
  nearly the same time could each start their own DB load and silently strand whichever client
  attached to the losing one. Fixed with an in-flight-creation-promise map (same coalescing
  pattern as the frontend's refresh-token dedup from Phase 5) so concurrent joins share one load.
- Added the grace-period room cleanup TECHNICAL_DESIGN.md Section 4 describes but Phase 6
  deliberately skipped: an emptied room waits 5s (`ROOM_EMPTY_GRACE_PERIOD_MS`) before being
  dropped from memory, cancelled if a client (re)joins in the meantime. `leaveDocument.js` (new)
  and the `ws` `'close'` handler both route through the same `removeClientFromRoom`, so both get
  this for free.
- 5 new tests (79 total) in `multiClientSync.test.js`, against a real HTTP+WS server with real
  JWTs and real permission grants — including positively confirming a viewer's rejected update
  never reaches other clients (raced against a timeout, not just checking the sender's error).
- Verified live against Docker with a scripted multi-account WebSocket client (not just the
  automated suite): editor accepted + broadcast works, viewer rejected at write, invalid JWT
  rejected + socket closed (confirmed close code `4001`), a stranger with zero grant rejected at
  join. Also specifically verified the server-restart scenario asked for: joined a room, sent an
  edit, ran `docker compose restart server`, reconnected and rejoined the same document —
  succeeded cleanly with an empty room, no crash, `/healthz` fully green afterward. Server logs
  independently confirmed the 5s grace-period cleanup firing correctly in the live container.

**Phase 8 — Frontend Real-Time Editor Integration: ✅ Done (merged to main)**

- `useYjsConnection.js` — owns a `Y.Doc` (recreated via `useMemo` keyed on `documentId`, so
  switching documents gets a fresh doc rather than reusing stale content) and its WebSocket
  lifecycle. The **echo-loop check**: every server-applied update is tagged with a
  `SERVER_ORIGIN` sentinel via `Y.applyUpdate(yDoc, update, SERVER_ORIGIN)`; the `yDoc.on('update')`
  listener that relays local edits to the server skips anything tagged with that origin. A plain
  local `Y.Text` edit's origin is Yjs's default (not the sentinel), so it's the only thing that
  ever gets sent — without this, receiving an update would immediately re-broadcast it back to
  the server, which would rebroadcast it to us again, forever.
- Reconnect state machine exactly as specified: 500ms initial backoff, doubling, capped at 10s,
  gives up after 8 attempts (`connectionStatus` becomes `'disconnected'`). A `PERMISSION_DENIED`/
  `UNAUTHORIZED` error at join time also goes straight to `'disconnected'` without burning
  through retries, since retrying can't fix a permission problem — but the *same* error code
  arriving on a `sync-update` *after* already being connected (e.g. role downgraded mid-session)
  only flips `canEdit` false, since the connection itself is still fine.
- **Deliberate addition beyond the literal spec, to make "reconnect after a network drop" actually
  work**: on every successful `sync-step` (including reconnects), the hook resends its own full
  current state (`Y.encodeStateAsUpdate(yDoc)`) to the server. Yjs updates are idempotent, so this
  is a safe no-op for anything the server already has, and is what actually gets edits made
  *during* a disconnect to the server once back online — without it, those edits would stay
  correctly visible locally (Yjs never loses anything) but would never reach anyone else, since
  Yjs only fires `'update'` for new changes, not ones that already happened while offline. This
  only uses what's already in the in-memory `Y.Doc` — no new persistence layer, so it doesn't
  cross into Phase 12's territory.
- `EditorSurface.jsx` — plain contenteditable div, common-prefix/suffix diffing (not a general
  diff algorithm — unnecessary for single-keystroke/paste-sized changes), caret-position
  preservation across remote-triggered re-renders via the Range/Selection API.
- **Found and fixed a real contenteditable bug via live browser testing**: Chromium leaves a
  stray `<br>` after a user clears all content (select-all + backspace), which `innerText`
  reports as `"\n"`, not `""` — silently corrupting the synced document with a phantom newline
  on every full clear. Fixed with a `getPlainText()` helper that treats a `textContent`-empty div
  as truly empty regardless of what `innerText` says (a `<br>` contributes nothing to
  `textContent`), while still using `innerText` for the non-empty case since it's what correctly
  serializes multi-line content into real `\n` characters.
- **Found and fixed a real design bug via live browser testing**: `DocumentEditorPage` originally
  disabled the editor whenever `connectionStatus !== 'connected'`, which made it *impossible* to
  type while `'reconnecting'` — directly defeating the hook's own offline-resilience design
  (local edits are supposed to stay usable during a brief drop). Fixed so editing is only
  disabled on a truly given-up `'disconnected'` state or `canEdit === false`.
- Connection-status badge (`Connecting…` / `Connected` / `Reconnecting…` / `Connection lost`) in
  `DocumentEditorPage`'s header, plus a "You have view-only access" notice when `canEdit` is
  false — never leaves the user silently guessing.
- Known, deliberately-flagged limitation: an access token that expires mid-session (15 min) while
  the WebSocket stays open has no automatic refresh path here — `httpClient.js`'s silent-refresh
  only triggers on a REST 401, not from `useYjsConnection`. A page reload/renavigation picks up a
  fresh token via the existing session-restore flow. Deliberately not fixed now — felt like
  Phase 12 territory (or a targeted follow-up) rather than something to silently bolt on.
- Verified live in a real browser (Playwright), not just lint/build: two independent logged-in
  tabs both showing `Connected`, A's typing appearing in B and vice versa, both tabs converging to
  byte-identical content, **simultaneous overlapping typing from both tabs at once converging to
  an identical, character-complete result with zero data loss** (the PRD's own headline proof
  point), and a full network-drop/reconnect cycle — status badge correctly reflecting the drop,
  local typing while offline, automatic reconnect, and the offline-typed content actually
  reaching a separate collaborator's browser once back online.
- `TECHNICAL_DESIGN.md` Sections 5 (reconnect state machine) and 6 (hook design) were referenced
  in this phase's prompt but still were never pasted into the file — proceeded anyway since the
  prompt itself specified exact backoff timing and hook responsibilities.

**Phase 9 — Multi-Client Convergence Validation & Proof: ✅ Done (merged to main)**

This phase added no product features — its only job was rigorous, automated, demoable proof of
the core convergence claim.

- Expanded `multiClientSync.test.js` with a real 3-client convergence proof: three genuinely
  concurrent, same-position edits (not just non-overlapping ones — the harder, more meaningful
  case for the CRDT's tie-breaking), applied to three *fresh* documents in three different
  delivery orders (a racing "simultaneous" order, and two explicit strict orders each confirmed
  via broadcast round-trips rather than timing guesses), read back through a 4th observer
  client's `sync-step` — same mechanism the existing "late joiner" test already used, so this
  needed zero new server code. All three orderings assert byte-identical final content, plus a
  length check proving no character was dropped or duplicated. 80 tests total (1 new, but it's
  the load-bearing one).
- `client/tests/e2e/collaborativeEdit.spec.js` — real Playwright, 3 real browser contexts, 3 real
  registered accounts, typing **at the same position at the same time**, polling for convergence
  rather than a fixed sleep, then asserting all three DOMs are byte-identical *and* that all 30
  characters (10 of each user's marker) are present exactly once. Added `@playwright/test` as a
  real `client/` devDependency (previously I'd only ever used a scratchpad-only Playwright install
  for my own manual verification in Phases 5/8 — this is the first phase that asks for a
  committed, CI-wired E2E suite).
- **Flagged rather than silently patched, per this phase's explicit instruction**: writing the
  E2E spec's permission-grant step hit the known Phase-5-flagged limitation again —
  `PermissionsPanel` shows each grant's raw `userId`, not the granted email — which broke my
  first attempt at asserting the grant succeeded. Did not touch the product to fix this; adjusted
  the *test's* assertion to check the permission list's item count instead. Still on the table if
  you want it fixed.
- CI: added a new `e2e` job to `.github/workflows/ci.yml` (Postgres service container, migrate,
  start server, start client dev server, install Playwright browsers, run the suite, upload the
  HTML report + server log as artifacts on failure) — a deliberate, explicit exception pulling
  E2E-in-CI forward from Phase 15's broader "wire up all the tests" scope, not a general rollout.
  **Important limitation**: I validated the YAML syntax and every individual command locally, but
  I cannot trigger or observe an actual GitHub Actions run myself — that requires pushing, which
  is your job per our standing workflow. Please confirm the `e2e` job actually goes green after
  you push, rather than assuming my local verification covers it.
- `docs/manual-demo-script.md` — numbered, narratable live-demo script: 3-way simultaneous
  overlapping typing, then a full offline-edit → reconnect → reconciliation walkthrough, plus a
  troubleshooting section for if something misbehaves live.
- `docs/crdt-convergence-explained.md` — plain-language explanation written for "explain this in
  an interview with no notes," not a restatement of code comments. Covers: why locking/last-
  write-wins fail, the two properties (unique IDs, neighbor-anchoring not position-anchoring)
  that make operations order-independent, the deterministic tie-break for same-position
  concurrent inserts, a worked two-user example, the honest caveat (convergence ≠ semantic
  merge quality), and the "why Yjs over OT" framing from PRD Section 24's interview guidance.
- Verified locally: full backend suite (80/80), the E2E spec run **4 consecutive times** with no
  flakes (~20–30s each), lint clean on both packages, production build clean.

**Standalone fix (post-Phase-9, branch `phase-9b-permissions-email-fix`): PermissionsPanel
userId-vs-email — ✅ Done, uncommitted**

Closes the rough edge flagged since Phase 5 and hit again while writing Phase 9's E2E test.
`permissions.repo.js`'s `listPermissionsForDocument` now `JOIN`s to `users` and returns each
grant's `email`/`displayName` alongside `userId`; `PermissionsPanel.jsx` displays `grant.email`
instead of the raw UUID. No route/API shape removed, only fields added, so nothing else needed
to change — full backend suite (80/80) and client lint/build stayed green with no other edits.
Verified live via curl against a rebuilt Docker server. Not yet committed — see the chat for the
exact staged/uncommitted file list at hand-off.

**Next: Phase 10 — Presence & Live Cursors**

Branch in progress for Phase 10: not yet started — build on top of
`phase-9b-permissions-email-fix` once it's merged, or on main if that lands first.
