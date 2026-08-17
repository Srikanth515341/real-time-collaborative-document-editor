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

This README is built out progressively as each phase lands, with a full polish pass in the final
phase.
