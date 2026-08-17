# Real-Time Collaborative Document Editor

A browser-based document editor where multiple users edit the same document simultaneously,
with live cursors/presence, conflict-free merging (CRDT via Yjs), offline resilience, and
version history.

## Running locally

1. Copy `.env.example` to `.env` (fill in real values for any secrets — never commit `.env`).
2. Run:

   ```bash
   docker compose up
   ```

3. Server health check: [http://localhost:4000/healthz](http://localhost:4000/healthz)
4. Client: [http://localhost:5173](http://localhost:5173)

Note: only one Postgres should own port 5432 on your machine. If you also run a native/local
Postgres install, stop it before `docker compose up`, or remap the `postgres` service's published
port in `docker-compose.yml`.

## Database migrations

Schema lives in `server/migrations/` as plain, ordered `.sql` files (source of truth:
`PRD.md` Section 10.4). Apply them to the dev database:

```bash
cd server
npm run migrate
```

This reads `DATABASE_URL` from `server/.env` (a host-side env file, separate from the root
`.env` used by Docker Compose — when running scripts from your host machine rather than inside
a container, point `DATABASE_URL` at `localhost`, not the Docker-internal `postgres` hostname).

## Running the server test suite

The data-access layer (`server/src/db/*.repo.js`) is tested against a real, disposable Postgres
database — not mocked. One-time setup:

```bash
docker compose exec postgres psql -U collab_editor -d collab_editor -c "CREATE DATABASE collab_editor_test;"
cd server
cp .env.test.example .env.test   # then edit if your credentials differ
```

`config.js` fails fast if any required env var is missing (`DATABASE_URL`, `CORS_ORIGIN`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`), so `.env.test` needs all of them even though the test
suite only exercises the database layer directly — anything importing a repo module pulls in
`pool.js` → `config.js`.

Then run:

```bash
npm test
```

This automatically drops/recreates the test database's schema and re-applies migrations before
each run (`pretest` → `test:reset-db`), so tests always start from a clean, known schema.
`resetTestDb.js` refuses to run against any database whose name doesn't contain `test`, as a
safeguard against accidentally wiping dev data.

## Application skeleton

- `server/src/config.js` is the **only** module that reads `process.env` directly — it validates
  every required var at import time and fails fast (clear error, non-zero exit) if one's missing.
  Everything else imports `config` from there.
- `server/src/utils/logger.js` — structured pino logging. No `console.log` anywhere in the
  codebase from this phase forward.
- `server/src/middleware/errorHandler.js` — centralized Express error handler (mounted last in
  `app.js`). Logs the full error server-side, but only ever returns
  `{ error: { code, message } }` to the client — never a stack trace.
- `GET /healthz` now also checks the database (`SELECT 1`) and reports it without ever crashing
  the process if the DB is unreachable: `200 { status: 'ok', db: 'ok' }` when healthy, or
  `503 { status: 'ok', db: 'error' }` when the DB can't be reached.

## Authentication

```
POST /api/auth/register   { email, password, displayName } -> 201 { user, accessToken, refreshToken }
POST /api/auth/login      { email, password }               -> 200 { user, accessToken, refreshToken }
POST /api/auth/refresh    { refreshToken }                  -> 200 { accessToken, refreshToken }
```

- Access tokens are short-lived JWTs (15 min); refresh tokens are opaque random values, stored
  hashed in the database, and **rotate on every use** — refreshing invalidates the token you just
  presented, so a stolen-then-reused refresh token is always rejected.
- Login returns the same generic error for a wrong password and a nonexistent email (both message
  and response timing), so a failed login never reveals whether an account exists.

Example:

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"maya@example.com","password":"correct horse battery staple","displayName":"Maya"}'
```

## Documents & permissions API

```
GET    /api/documents                          list documents you own or have access to
POST   /api/documents                          create a document (you become its owner)
GET    /api/documents/:id                      metadata + latest snapshot (viewer+)
PATCH  /api/documents/:id                      rename / archive (editor+)
DELETE /api/documents/:id                      delete, cascades to permissions/snapshots (owner)
GET    /api/documents/:id/versions             list snapshots (viewer+)
GET    /api/documents/:id/permissions          list access grants (owner)
POST   /api/documents/:id/permissions          grant access, { email, role } (owner)
DELETE /api/documents/:id/permissions/:userId  revoke access (owner)
```

All routes require `Authorization: Bearer <accessToken>`. Every write is enforced server-side
regardless of what a client UI shows — a viewer's token gets 403 on every write path, not just a
hidden button. Granting `role: "owner"` and revoking the document owner's own access are both
rejected (400) to preserve exactly one owner per document.

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maya@example.com","password":"correct horse battery staple"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

curl -X POST http://localhost:4000/api/documents \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Q3 Roadmap"}'
```

## Frontend

React + react-router-dom. Register/log in at `/login` and `/register`, then the dashboard (`/`)
lists your documents and lets you create one; opening a document (`/documents/:id`) shows its
metadata, a placeholder where the real-time editor lands in Phase 8, and — for the document's
owner — an access panel to grant/revoke `editor`/`viewer` roles by email.

**Token storage**: the access token lives in memory only (never in `localStorage`/
`sessionStorage`); the refresh token (plus a small cached display profile) lives in
`sessionStorage`, so a page reload doesn't force a re-login but a closed tab doesn't leave a
lingering credential. This is a deliberate tradeoff, not a default — see `CLAUDE.md`'s Phase 5
notes for the full reasoning and what a stronger (httpOnly-cookie) version would need.

## Docker build gotcha (fixed, kept here as a note)

Both `server/` and `client/` need a `.dockerignore` excluding `node_modules` — without it,
`COPY . .` in the Dockerfile copies your host's own `node_modules` into the image on top of the
one `npm install` just built there. This is invisible for pure-JS dependencies but corrupts
native modules (e.g. `bcrypt`) with a platform mismatch. If you ever see `invalid ELF header` or
`Exec format error` from a native module inside a container, this is almost certainly why.

This README is built out progressively as each phase lands, with a full polish pass in the final
phase.
