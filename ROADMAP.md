# Real-Time Collaborative Document Editor — Technical Implementation Roadmap

Companion documents: PRD.md, TECHNICAL_DESIGN.md (keep all three in the repo root)
Purpose: A sequential, 18-phase build plan. Each phase is sized to be handed to Claude Code as
one standalone prompt, verified by you, and committed before the next phase begins.
Audience: Solo developer feeding phases into Claude Code one at a time.

> Note: only Phase 0 has been fully detailed so far (phase prompts are supplied one at a time).
> As each subsequent phase's prompt is provided, its full "Goal / Detailed Scope / Explicitly Out
> of Scope / Verification Checklist / Ready-to-Use Claude Code Prompt" section should be appended
> to this file in place of its entry below, so this document stays the complete build record.

## How to Use This Document

- Before Phase 0, make sure PRD.md, TECHNICAL_DESIGN.md, and this file (saved as ROADMAP.md)
  exist somewhere you can copy from. Phase 0's own scope adds all three to the repo root, so from
  Phase 1 onward Claude Code can read them directly instead of you re-pasting schemas and payloads
  into every prompt.
- Work through phases strictly in order. Every phase assumes every earlier phase is done and
  verified.
- For each phase, copy the "Ready-to-Use Claude Code Prompt" block exactly as written and paste it
  into Claude Code. Don't paraphrase it yourself — if you want to change scope, that should be a
  deliberate decision, not an accident of rewording.
- After Claude Code finishes a phase, work through that phase's Verification Checklist yourself
  before moving on. Do not chain phases without verifying — a wrong assumption that slips through
  in Phase 6 is far more expensive to unwind by Phase 12 than it is to catch immediately.
- Commit and merge each phase on its own branch before starting the next one (see Global Standards
  below).

A note on phase numbering: This roadmap replaces the PRD's own Section 22 milestone sketch (a
simpler Phase 0–7 outline) with a more granular 18-phase sequence, better suited to iterative
AI-agent prompting. Where a prompt below references "TECHNICAL_DESIGN.md Section 7," that refers
to that document's own internal step-by-step build sequence for the sync engine — not to a
"Phase" in this roadmap's numbering.

## What Changed From the Original PRD Milestone Plan, and Why

- The CRDT engine now gets its own isolated proof-of-concept phase (Phase 6), separated from
  wiring it into the real product (Phase 7). The Technical Design Doc already recommended proving
  the merge logic with wscat before touching a browser (its Section 7) — this roadmap turns that
  internal recommendation into a hard phase boundary with its own commit, its own tests, and its
  own verification, so the single riskiest piece of the entire project is proven correct in total
  isolation before anything else depends on it.
- A dedicated validation phase (Phase 9) sits between "it works when I click around" (Phase 8) and
  "I have automated, repeatable proof that it works" (Phase 9). This is the resume/interview proof
  point named in the PRD — it earns its own deliberate phase rather than being an afterthought
  inside a feature phase.
- Security is its own phase (13), not folded into a combined "testing & security" phase as the
  PRD's original sketch had it. It deserves an explicit, checklist-driven pass on its own.
- Rate limiting on WebSocket messages (the PRD's FR-17) moved from a P2/stretch feature into a
  required item in Phase 13. It's an abuse-prevention control, not a nice-to-have.
- Basic structured logging and a DB-aware health check now ship in Phase 2, not only at deployment
  (Phase 16). Real teams don't wait until launch week to add logging.
- Every phase prompt below explicitly tells Claude Code to stop at that phase's boundary and ask
  before assuming scope. This is new relative to the PRD, which was written assuming a human
  pacing themselves. It matters specifically because you're directing an AI agent — the biggest
  risk in agent-driven builds is silent scope drift, not slow progress.

## Global Engineering Standards

(These apply to every phase. Each phase below only calls out what's specific or new to it.)

**Version control**
- One branch per phase: `phase-N-short-description`, merged to main via pull request even when
  working solo, so CI gates every merge once it exists (from Phase 0/15 onward).
- Commits are small and descriptive (`feat: add refresh token rotation`) — never `wip` or
  `fix stuff`.

**Code conventions** (per TECHNICAL_DESIGN.md Section 10)
- `camelCase.js` for backend modules, `PascalCase.jsx` for React components, `*.repo.js` for data
  access, `*.service.js` for business logic, `*.test.js` / `*.spec.js` for tests.
- ESLint + Prettier enforced from Phase 0 onward. No phase should introduce a lint failure.

**Security baseline — non-negotiable from Phase 3 onward**
- Every write path, REST and WebSocket alike, independently verifies authentication and
  authorization server-side. Never trust what the client claims or what the UI hides.
- All SQL parameterized, never string-concatenated.
- No secret, password hash, or token is ever committed, logged, or hardcoded.

**Testing**
- Tests are written in the same phase as the code they cover. Phases 9 and 14 exist to prove
  completeness and close gaps — not to write the first test in the project.

**Directing Claude Code**
- Every prompt below tells Claude Code to stop at that phase's boundary, ask before assuming
  anything ambiguous, and explain what it built and why — not silently dump code.
- You independently verify each phase's checklist yourself before feeding in the next phase's
  prompt.

## Phase Index

0. Repository, Environment & Tooling Foundation
1. Database Schema, Migrations & Data Access Layer
2. Backend Application Skeleton
3. Authentication & Authorization System
4. Document & Permissions REST API
5. Frontend Foundation
6. CRDT Sync Engine — Isolated Proof of Concept
7. WebSocket Gateway — Production Integration
8. Frontend Real-Time Editor Integration
9. Multi-Client Convergence Validation & Proof
10. Presence & Live Cursors
11. Persistence — Snapshots, Operation Log & Version History
12. Offline Resilience & Reconnection Reconciliation
13. Security Hardening
14. Comprehensive Automated Testing Suite
15. CI/CD Pipeline
16. Cloud Deployment & Observability
17. Final Polish — Documentation, Resume & Interview Readiness

---

## Phase 0 — Repository, Environment & Tooling Foundation

**Status: ✅ Done**

### Goal

A working, empty full-stack scaffold that runs locally with one command, with CI already wired
(lint-only for now), and the project's own planning documents committed as the source of truth
every later phase will reference.

### Prerequisites

Node.js LTS, Docker Desktop, Git, a GitHub account, and Claude Code installed and working.

### Detailed Scope

1. Initialize the git repo; initial commit.
2. Create the repository structure from TECHNICAL_DESIGN.md Section 1 (`server/`, `client/`, root
   config files).
3. Add PRD.md, TECHNICAL_DESIGN.md, and ROADMAP.md to the repo root.
4. `docker-compose.yml` (postgres + server + client) per TECHNICAL_DESIGN.md Section 2.
5. `.env.example` per the same section; `.gitignore` covering `node_modules`, `.env`, build
   output.
6. `server/package.json` with the backend dependencies listed in TECHNICAL_DESIGN.md Section 3 —
   installed, not yet used beyond a health route.
7. `client/package.json` — a default Vite + React scaffold, no custom code yet.
8. Minimal Express server exposing `GET /healthz` → `{ status: 'ok' }`.
9. Minimal React page showing "Collaborative Editor — Setup OK".
10. ESLint + Prettier config for both `server/` and `client/`.
11. GitHub Actions workflow: a lint-only job for now (the test job gets built out once tests
    exist, from Phase 1 onward).
12. `README.md` stub with basic run instructions (fully rewritten in Phase 17).

### Explicitly Out of Scope

Any auth, document, or CRDT logic. Any deployment. Any tests beyond a placeholder.

### Professional Engineering Standards

Apply Global Standards. Additionally: `docker compose up` must work from a completely clean clone
with zero manual steps beyond copying `.env.example` to `.env`.

### Verification Checklist

- [ ] Clone into a fresh folder, run `docker compose up` — postgres, server, and client all start
      with no errors.
- [ ] `curl http://localhost:4000/healthz` returns `{"status":"ok"}`.
- [ ] `http://localhost:5173` shows the placeholder React page.
- [ ] Push to GitHub; the Actions tab shows a green lint run.
- [ ] `.env` is not committed (check `git status`), but `.env.example` is.

---

## Phases 1–17

Full detail for each phase (Goal / Detailed Scope / Explicitly Out of Scope / Verification
Checklist / Ready-to-Use Claude Code Prompt) will be appended here as each phase's prompt is
supplied, in the same format as Phase 0 above.
