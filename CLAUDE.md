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
  src/
    routes/       — Express route handlers (thin, delegate to services)
    services/      — business logic
    db/            — query functions (parameterized SQL via pg)
    middleware/     — JWT verification, error handling
    websocket/      — connection handling, room management, broadcast logic
    app.js          — Express app construction (no listener — testable)
    index.js        — entrypoint, starts the HTTP listener
client/
  src/
    App.jsx, main.jsx, etc.
PRD.md
TECHNICAL_DESIGN.md
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

**Phase 0 — Repository, Environment & Tooling Foundation: ✅ Done**

- Monorepo scaffolded: `server/` (Express, health check at `GET /healthz`) and `client/`
  (Vite + React, placeholder page).
- `docker-compose.yml` wired for postgres + server + client; `.env.example` and `.gitignore` in
  place.
- ESLint + Prettier configured and passing in both `server/` and `client/`.
- GitHub Actions CI (`.github/workflows/ci.yml`) runs lint for both packages on every push/PR
  (test job intentionally deferred to Phase 1+, once tests exist).
- `PRD.md` and `TECHNICAL_DESIGN.md` added as placeholders (paste full content in); `ROADMAP.md`
  populated with the roadmap content supplied so far.
- README.md stub in place.

**Next: Phase 1 — Database Schema, Migrations & Data Access Layer**

Branch in progress: `phase-0-repo-setup` (not yet merged — pending user verification and commit).
