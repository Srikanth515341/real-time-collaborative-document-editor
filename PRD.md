# Real-Time Collaborative Document Editor

## Product Requirements Document (PRD)

**Author:** Srikanth (Solo Developer/PM/Engineer)
**Status:** Draft v1.0 — Source of Truth for Build
**Document Type:** Portfolio Engineering Project PRD

---

## Table of Contents

1. Document Overview & Purpose
2. Problem Statement
3. Goals & Objectives
4. Non-Goals
5. Target Users / Personas
6. User Stories
7. Functional Requirements
8. Non-Functional Requirements
9. System Architecture Overview
10. Detailed Technical Requirements
11. Core Feature Deep-Dive
12. Edge Cases & Failure Scenarios
13. Security Considerations
14. Scalability Considerations
15. Testing Strategy
16. DevOps / CI-CD Strategy
17. Cloud Deployment Strategy
18. Monitoring & Observability Strategy
19. Success Metrics / KPIs
20. Assumptions & Constraints
21. Risks & Open Questions
22. Milestone-Based Development Plan
23. Definition of Done
24. Resume / Interview Talking Points

---

## 1. Document Overview & Purpose

This PRD defines everything needed to design, build, test, and ship a real-time collaborative
document editor — a browser-based writing tool where multiple people can edit the same document
at the same time, the way Google Docs or Notion works, without one person's changes silently
overwriting another's.

This document exists to solve a specific problem for a solo developer: when you're building
alone, "I'll figure it out as I code" is how projects end up half-finished or architecturally
confused three weeks in. A real product team would never start writing code before agreeing on
what "done" means, how the system is structured, and what happens when things go wrong. This PRD
makes those decisions up front, once, in writing, so that every coding session has a clear answer
to "what am I building right now, and why."

Treat this as your single source of truth. When you're unsure what a feature should do, the
answer is here. When you finish the project, this document — kept in the repo — is also evidence
to a reviewer that you think like an engineer, not just someone who followed a tutorial.

---

## 2. Problem Statement

Real-time collaboration looks simple from the outside — "just let two people type in the same
box" — but almost every homegrown attempt at it fails in one of two ways:

- **Pessimistic locking**: the document locks to whoever opened it first, and everyone else is
  stuck watching until they leave. This isn't collaboration; it's a queue.
- **Silent overwrites** (last-write-wins on the whole document): two people type in different
  parts of the same paragraph, one of them hits save a half-second after the other, and the first
  person's work vanishes with no warning and no way to recover it.

The reason this is hard is that it isn't a UI problem — it's a data structure problem. When two
users type at the "same" position in a document at the "same" time, you need a way to merge both
edits so that the resulting document makes sense to both of them, without a central server acting
as a single bottleneck deciding whose edit "wins." This is exactly the problem Conflict-free
Replicated Data Types (CRDTs) and Operational Transformation (OT) were invented to solve, and it's
why Google Docs, Figma, and Notion all have entire engineering teams dedicated to this one
problem.

Almost no portfolio project attempts this, because it requires understanding both the theory (how
do you guarantee two replicas converge to the same state no matter what order updates arrive in?)
and the systems engineering (how do you get those updates from one browser to another in real
time, and persist them so nothing is lost if a server restarts?). That gap is exactly what this
project is designed to close.

---

## 3. Goals & Objectives

**Product Goals** (framed as if this were a real product)
- Let multiple users edit the same document simultaneously with zero data loss, regardless of
  typing speed, network latency, or edit position overlap.
- Make every user aware of who else is in the document and roughly where they're working
  (presence/cursors), so collaboration feels alive, not silent.
- Ensure a user's work is never lost, even if their connection drops mid-edit.

**Technical Goals**
- Implement CRDT-based conflict resolution correctly, verified by an automated test that proves
  convergence under concurrent, interleaved edits.
- Achieve sub-200ms edit-propagation latency between clients on a reasonable connection
  (same-region deployment).
- Design a persistence model that survives a server restart with zero committed data loss.
- Build a system where the "hard part" (the merge engine) is genuinely understood and testable in
  isolation, not just imported and trusted blindly.

**Personal / Career Goals**
- Produce a portfolio project whose core technical claim ("it correctly merges concurrent edits")
  is provable in under a minute of demo time — the single most convincing kind of proof point for
  a reviewer with limited attention.
- Build genuine, defensible fluency in a systems-programming topic (CRDTs, WebSocket
  architecture, eventual consistency) that comes up directly in senior-level technical interviews,
  so the project is not just a resume line but a real interview asset.
- Practice full-cycle engineering discipline — PRD, design doc, milestone planning, testing,
  deployment — the way a real engineering org operates, not just "write code until it works."

---

## 4. Non-Goals

Explicitly not building, and why:

| Not Building | Why It's Out of Scope |
|---|---|
| Rich media embeds (images, video, embedded files) | Adds significant complexity (storage, rendering) without adding to the core technical proof point (conflict-free concurrent editing). |
| Native mobile apps | Browser-only is sufficient to demonstrate the system; mobile adds a whole second client platform for no additional signal. |
| Full WYSIWYG parity with Google Docs (tables, complex formatting, footnotes) | The differentiator is the sync engine, not the editor's feature completeness. Basic rich text (bold/italic/headers/lists) is enough. |
| Enterprise SSO / SCIM / org-level admin | Solves an enterprise problem this project isn't trying to solve; JWT-based auth with document-level permissions is sufficient. |
| Google Docs-style "Suggesting mode" (tracked changes as proposals) | A genuinely separate, complex feature layered on top of the CRDT model; real-time direct editing already proves the core claim. |
| Real-time voice/video chat | Out of scope — this is a text-editing systems project, not a communications platform. |
| AI writing assistance | Unrelated to the core technical thesis of this project; would dilute focus. |
| Multi-region / globally distributed deployment | A single-region deployment is sufficient to prove the architecture; multi-region is a documented "how I'd scale this" answer, not something to actually build. |

---

## 5. Target Users / Personas

**Persona 1 — Maya, Startup Product Manager**
Maya co-writes specs with two engineers across different time zones. Her biggest pain point with
existing tools that lack real collaboration: she never knows if she's looking at the latest
version, and merging feedback from three people via comments and copy-paste is slow and
error-prone. She needs to see edits appear live and trust that nothing gets silently lost.

**Persona 2 — Alex, Graduate Student**
Alex is co-writing a thesis chapter with two classmates, often working late at night with
unreliable dorm Wi-Fi. Alex's pain point: a previous tool "ate" 20 minutes of work after a brief
disconnect. Alex needs the editor to queue local changes when offline and reconcile safely when
reconnected, without asking Alex to manually resolve a conflict they don't understand.

**Persona 3 — Jordan, Small Team Lead**
Jordan manages document permissions for a small team — some documents should be editable by
everyone, others should be view-only for most people and editable only by two leads. Jordan needs
a simple, reliable way to grant and revoke access per document, and trusts that the system
actually enforces those permissions, not just hides the edit button in the UI.

---

## 6. User Stories

**Authentication & Documents**
- As a new user, I want to register with email and password, so that I have a persistent identity
  across sessions.
- As a returning user, I want to log in and see a list of documents I own or have access to, so
  that I can quickly resume work.
- As a user, I want to create a new blank document, so that I can start writing immediately.

**Real-Time Editing**
- As a user editing a document, I want my keystrokes to appear instantly for me and to sync to
  other active editors within a fraction of a second, so that collaboration feels live.
- As a user, I want another person's edits to merge into my view automatically without
  overwriting what I'm currently typing, so that I never lose my own work.
- As a user, I want to see other active editors' cursor positions and selections in distinct
  colors, so that I know where my collaborators are working and can avoid literally typing over
  their cursor visually.

**Resilience**
- As a user whose Wi-Fi drops mid-edit, I want my local changes to keep being applied to my own
  view and queued locally, so that I don't lose anything I typed while offline.
- As a user who reconnects after being offline, I want my queued local changes to merge correctly
  with everything that happened on the document while I was gone, so that no one's work — mine or
  theirs — is lost.

**History & Recovery**
- As a user, I want to view a history of past versions of the document, so that I can see how it
  evolved or recover from an unwanted change.
- As a user, I want to restore an earlier version if something goes wrong, so that mistakes (mine
  or a collaborator's) are recoverable.

**Permissions**
- As a document owner, I want to invite specific people as editors or viewers, so that I control
  who can change the document versus just read it.
- As a document owner, I want to revoke someone's access, so that I can remove people who no
  longer need it.
- As a viewer, I want to be prevented from editing (both in the UI and by the server, not just
  visually), so that permission boundaries are actually enforced.

---

## 7. Functional Requirements

Priorities: P0 = required for the core demo/proof point to exist at all. P1 = required for the
project to feel complete and portfolio-ready. P2 = stretch goals if time allows.

**P0 — Must Have**

| ID | Requirement |
|---|---|
| FR-1 | Users can register and log in via email/password; sessions are authenticated via JWT. |
| FR-2 | Authenticated users can create a new document and become its owner. |
| FR-3 | Two or more users with edit access can open the same document simultaneously and type concurrently; all edits merge correctly with zero data loss, verified by the system's own CRDT engine (Yjs), regardless of timing or position overlap. |
| FR-4 | Edits from one client propagate to all other connected clients viewing the same document via WebSocket, with visible propagation latency under roughly 200ms on a normal connection. |
| FR-5 | Document content persists to PostgreSQL such that reopening the document (or restarting the server) restores the exact last-saved state, not a stale or partial one. |
| FR-6 | Document owners can grant editor or viewer access to other registered users; the server enforces these roles on every write operation (WebSocket and REST), not just in the UI. |

**P1 — Should Have**

| ID | Requirement |
|---|---|
| FR-7 | Users see live cursor positions and text selections of other active collaborators, each rendered in a distinct, consistent color per user. |
| FR-8 | Users see a list of who is currently active in a document (presence list), updated in real time as people join/leave. |
| FR-9 | The system periodically snapshots full document state and maintains an operation log, enabling a version history view where a user can browse and open past states. |
| FR-10 | A user who loses network connectivity mid-edit can continue typing locally (changes visibly apply to their own screen); on reconnect, their offline changes automatically reconcile with the current document state via the CRDT merge, with no manual conflict resolution required. |
| FR-11 | Document owners can revoke a user's access at any time; that user is disconnected from the live session (or blocked from further edits) promptly after revocation. |
| FR-12 | Users see a dashboard listing all documents they own or have been granted access to, with basic metadata (title, last edited, role). |

**P2 — Nice to Have / Stretch**

| ID | Requirement |
|---|---|
| FR-13 | Basic rich text formatting: bold, italic, headings, bullet/numbered lists. |
| FR-14 | Users can create a named version checkpoint (e.g., "Draft for review") in addition to automatic snapshots. |
| FR-15 | Users can restore a document to a selected historical version. |
| FR-16 | Basic export of document content to plain text or Markdown. |
| FR-17 | Rate limiting on WebSocket message volume per connection to protect against a misbehaving client flooding the server. |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Latency | Edit propagation from Client A's keystroke to Client B's rendered screen: target < 200ms on same-region deployment under normal load (single-digit concurrent users per document). |
| Consistency | The system must guarantee strong eventual consistency: given the same set of updates, all connected clients converge to an identical document state, regardless of the order updates were received in. This is the core correctness guarantee CRDTs provide and must be explicitly tested, not assumed. |
| Data Durability | No committed edit (one that has been broadcast and acknowledged) should be lost due to a server restart. Snapshot + operation log design must guarantee this. |
| Concurrency Scale (target for this project) | Support at least 10 concurrent users editing the same document, and at least 50 concurrent WebSocket connections across all documents, without degraded performance. This is a deliberately modest, honestly-scoped target for a portfolio project — not an attempt to prove Google-scale numbers. |
| Availability | Single-instance deployment; no formal uptime SLA required for a portfolio project, but the app should recover cleanly (no data corruption) from a server restart. |
| Security | All write operations (REST and WebSocket) must verify both authentication (who is this) and authorization (are they allowed to do this) — never trust the client to self-report its role. |
| Browser Support | Modern evergreen browsers (Chrome, Firefox, Edge, Safari, latest 2 versions). No IE11 support needed. |

---

## 9. System Architecture Overview

At a high level, there are three moving pieces: browser clients, a Node.js server (which hosts
both a REST API and a WebSocket gateway), and PostgreSQL.

- The REST API handles everything that isn't live editing: registering/logging in, creating
  documents, managing permissions, listing documents, and fetching version history.
- The WebSocket gateway handles everything that is live editing: a client connects to a specific
  document's "room," sends its local edits as compact binary updates, and receives other clients'
  updates broadcast back.
- PostgreSQL stores everything durably: user accounts, document metadata, who has access to what,
  periodic full-state snapshots of each document, and an append-only log of every edit for replay
  and version history.

The key architectural idea: the actual merging of concurrent edits does not happen by the server
making decisions about whose edit is "right." It happens because every client and the server all
run the same CRDT algorithm (via the Yjs library), which mathematically guarantees that applying
the same set of updates — in any order — produces the same final document. The server's job is
simpler than it sounds: relay updates to everyone in the room, and periodically persist the
current state. The hard correctness guarantee is provided by the CRDT itself, not by clever server
logic — which is exactly why understanding how the CRDT provides that guarantee is the real
technical depth of this project.

```
flowchart TB
    subgraph Clients["Browser Clients"]
        C1["Client A<br/>React + Yjs"]
        C2["Client B<br/>React + Yjs"]
        C3["Client N<br/>React + Yjs"]
    end

    subgraph Server["Node.js Server"]
        REST["REST API<br/>(Express)"]
        AUTH["Auth Middleware<br/>(JWT verification)"]
        WS["WebSocket Gateway<br/>(ws / Socket.IO)"]
    end

    DB[("PostgreSQL<br/>users, documents,<br/>permissions, snapshots,<br/>operation_log")]

    C1 -- "HTTPS: login, create doc, permissions" --> REST
    C2 -- "HTTPS: login, create doc, permissions" --> REST
    C1 -- "WSS: CRDT updates + presence" --> WS
    C2 -- "WSS: CRDT updates + presence" --> WS
    C3 -- "WSS: CRDT updates + presence" --> WS

    REST --> AUTH
    WS --> AUTH
    AUTH --> DB
    WS -- "periodic snapshot + op log write" --> DB
    WS -- "broadcast update to room" --> C1
    WS -- "broadcast update to room" --> C2
    WS -- "broadcast update to room" --> C3
```

---

## 10. Detailed Technical Requirements

### 10.1 Frontend Architecture

- Framework: React, functional components with hooks.
- Editor surface: A contenteditable-based rich text area bound to a Yjs shared text type (Y.Text
  or Y.XmlFragment if supporting rich formatting), using a binding library (e.g., y-prosemirror if
  using ProseMirror as the editing framework, which is the realistic, well-supported path for rich
  text + Yjs — a raw contenteditable binding is possible but noticeably more error-prone).
- State management: Yjs's shared document (Y.Doc) is the source of truth for document content —
  no separate Redux store duplicating it. React component state is used for UI-only concerns
  (which panel is open, connection status indicator, etc.).
- Component structure (high level):
  - App → routing (login, dashboard, document editor)
  - Dashboard → document list, create-new button
  - DocumentEditor → hosts the editor, presence bar, version history panel
    - EditorSurface → the actual editable text area bound to Yjs
    - PresenceBar → avatars/colors of active collaborators
    - RemoteCursors → overlay rendering other users' cursor/selection positions
    - VersionHistoryPanel → list of snapshots, preview, restore action
    - PermissionsPanel → owner-only, manage who has access
- Real-time connection management: a custom hook (e.g., `useYjsConnection(documentId)`) that owns
  the Y.Doc, the WebSocket provider, connection status, and exposes them to child components.

### 10.2 Backend Architecture

- Framework: Node.js with Express for REST endpoints.
- WebSocket layer: a dedicated WebSocket server (using `ws`, or y-websocket's server utilities as
  a strong starting reference) mounted alongside the Express HTTP server on the same port
  (upgrading HTTP connections to WebSocket).
- Layered structure:
  - `routes/` — Express route handlers (thin, delegate to services)
  - `services/` — business logic (document creation, permission checks, snapshot scheduling)
  - `websocket/` — connection handling, room management, broadcast logic
  - `db/` — query functions / a lightweight query builder (raw SQL with a library like `pg` and
    parameterized queries is a perfectly reasonable, transparent choice for a project like this —
    an ORM is optional, not required)
  - `middleware/` — JWT verification, error handling
- Room model: each open document is a "room" — an in-memory map from `documentId` to
  `{ yDoc, connectedClients, lastSnapshotAt }`. When the last client leaves a room, the server
  flushes a final snapshot and can free the in-memory Y.Doc (it will be reloaded from the database
  next time someone opens it).

### 10.3 Real-Time Sync Engine (CRDT) Design

Library choice: Yjs. This is a deliberate, realistic choice — hand-rolling a full custom CRDT or
OT engine from scratch is a multi-month research-grade undertaking prone to extremely subtle
correctness bugs (this is genuinely one of the harder problems in distributed systems). Using Yjs
does not mean this project is "just plugging in a library" — correctly integrating Yjs with a
custom backend (persistence, room management, permission enforcement, presence protocol) still
requires real understanding of how the CRDT guarantees work, and that understanding is exactly
what you need to be able to defend in an interview.

How it works, conceptually:
- Every client holds a local Y.Doc — a CRDT-backed document.
- When a user types, Yjs generates a small binary "update" representing that change.
- That update is sent to the server, which applies it to its own server-side Y.Doc (the
  authoritative in-memory copy for that room) and rebroadcasts it to every other connected client.
- Each receiving client applies the update to its own local Y.Doc. Because of how the CRDT is
  mathematically constructed, applying the same updates in any order (or applying them more than
  once) always converges to the same final state — this is the core property that makes "just
  relay everything" a correct server strategy.

Persistence strategy:
- Every incoming update is appended to the `operation_log` table (for replay/audit/version
  history).
- Every N seconds (configurable, e.g., every 10 seconds) or every M operations, the server calls
  `Y.encodeStateAsUpdate(yDoc)` to serialize the entire current state as a compact binary blob and
  writes it to `document_snapshots`. This bounds how much of the operation log needs to be
  replayed to reconstruct state, and gives you natural "checkpoints" for version history.
- When a document is opened and no one else has it loaded in memory, the server reconstructs the
  Y.Doc by loading the latest snapshot and replaying any operation-log entries created after that
  snapshot.

Pseudocode — server-side update handling:

```
on WebSocket message "sync-update" { documentId, update }:
    verify sender has 'editor' or 'owner' role on documentId
    room = getOrCreateRoom(documentId)
    Y.applyUpdate(room.yDoc, update)
    appendToOperationLog(documentId, senderId, update)
    for each client in room.connectedClients:
        if client != sender:
            send(client, "sync-update", { update, fromUserId: sender.id })
    if shouldSnapshot(room):
        snapshot = Y.encodeStateAsUpdate(room.yDoc)
        saveSnapshot(documentId, snapshot)
```

### 10.4 Database Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled Document',
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE document_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, user_id)
);

CREATE TABLE document_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshot_data BYTEA NOT NULL,      -- Y.encodeStateAsUpdate() output
  version_label VARCHAR(100),        -- optional user-named checkpoint
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE operation_log (
  id BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  update_data BYTEA NOT NULL,        -- a single Yjs update
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_operation_log_document_time ON operation_log(document_id, created_at);
CREATE INDEX idx_permissions_user ON document_permissions(user_id);
```

```
erDiagram
    USERS ||--o{ DOCUMENTS : owns
    USERS ||--o{ DOCUMENT_PERMISSIONS : granted
    DOCUMENTS ||--o{ DOCUMENT_PERMISSIONS : "shared via"
    DOCUMENTS ||--o{ DOCUMENT_SNAPSHOTS : has
    DOCUMENTS ||--o{ OPERATION_LOG : has

    USERS {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar display_name
    }
    DOCUMENTS {
        uuid id PK
        varchar title
        uuid owner_id FK
        boolean is_archived
    }
    DOCUMENT_PERMISSIONS {
        uuid id PK
        uuid document_id FK
        uuid user_id FK
        varchar role
    }
    DOCUMENT_SNAPSHOTS {
        uuid id PK
        uuid document_id FK
        bytea snapshot_data
        varchar version_label
    }
    OPERATION_LOG {
        bigserial id PK
        uuid document_id FK
        uuid user_id FK
        bytea update_data
    }
```

### 10.5 API Design

REST endpoints:

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | /api/auth/register | Create account | None |
| POST | /api/auth/login | Get JWT + refresh token | None |
| POST | /api/auth/refresh | Rotate access token | Refresh token |
| GET | /api/documents | List documents user can access | JWT |
| POST | /api/documents | Create a document | JWT |
| GET | /api/documents/:id | Get metadata + latest snapshot | JWT + permission check |
| PATCH | /api/documents/:id | Rename / archive | JWT + editor/owner |
| DELETE | /api/documents/:id | Delete document | JWT + owner only |
| GET | /api/documents/:id/permissions | List access grants | JWT + owner |
| POST | /api/documents/:id/permissions | Grant access | JWT + owner |
| DELETE | /api/documents/:id/permissions/:userId | Revoke access | JWT + owner |
| GET | /api/documents/:id/versions | List snapshots | JWT + permission check |

Example payload — `POST /api/documents/:id/permissions`:

```json
// Request
{
  "email": "collaborator@example.com",
  "role": "editor"
}

// Response 201
{
  "id": "9d3f...",
  "documentId": "a12b...",
  "userId": "77ce...",
  "role": "editor",
  "grantedAt": "2026-08-17T10:15:00Z"
}
```

WebSocket protocol (JSON envelope wrapping base64-encoded binary Yjs payloads):

Client → Server:
```json
{ "type": "join-document", "documentId": "a12b...", "token": "<jwt>" }
{ "type": "sync-update", "documentId": "a12b...", "update": "<base64 Yjs update>" }
{ "type": "awareness-update", "documentId": "a12b...", "awareness": { "cursor": 142, "selection": [140, 150], "color": "#FF6B6B" } }
{ "type": "leave-document", "documentId": "a12b..." }
```

Server → Client:
```json
{ "type": "sync-step", "documentId": "a12b...", "update": "<base64 full state>" }
{ "type": "sync-update", "documentId": "a12b...", "update": "<base64>", "fromUserId": "77ce..." }
{ "type": "awareness-update", "documentId": "a12b...", "userId": "77ce...", "awareness": { "cursor": 142, "color": "#FF6B6B" } }
{ "type": "user-joined", "documentId": "a12b...", "user": { "id": "77ce...", "displayName": "Maya", "color": "#FF6B6B" } }
{ "type": "user-left", "documentId": "a12b...", "userId": "77ce..." }
{ "type": "error", "code": "PERMISSION_DENIED", "message": "You do not have edit access to this document." }
```

### 10.6 Authentication & Authorization Design

- Access tokens: short-lived JWT (e.g., 15 minutes), signed with a server secret, containing
  `userId` and `email`.
- Refresh tokens: longer-lived (e.g., 7 days), stored hashed in the `refresh_tokens` table, used
  to mint new access tokens without re-entering a password.
- REST auth: standard `Authorization: Bearer <token>` header, verified by Express middleware on
  every protected route.
- WebSocket auth: WebSocket connections don't carry headers the same way REST does, so the client
  sends its JWT as the first message after connecting (`join-document` includes `token`) — the
  server verifies it before adding the connection to any room. A connection that fails auth is
  closed immediately.

### 10.7 Permissions Model

Three roles per document: **owner** (full control, including granting/revoking access and
deleting the document — exactly one owner per document, the creator), **editor** (can read and
write content, cannot manage permissions or delete), **viewer** (read-only, blocked from sending
`sync-update` messages at the server level, not just hidden in the UI).

Critical design rule: every permission check happens server-side, on every write path (REST and
WebSocket), independent of what the client UI shows. A viewer's client should never even attempt
to send edits, but the server must reject them regardless, because a modified or malicious client
could bypass UI restrictions entirely.

---

## 11. Core Feature Deep-Dive

How live sync actually works, step by step:

1. User A opens a document. Client requests the latest snapshot via REST
   (`GET /api/documents/:id`), initializes a local Y.Doc from it, then opens a WebSocket
   connection and sends `join-document`.
2. Server verifies A's JWT and permission, adds A's connection to the document's room, and sends
   a `sync-step` with the current authoritative state (in case anything changed since A's REST
   fetch).
3. User B opens the same document — same flow, and both A and B now receive `user-joined` events
   for each other.
4. User A types a character. Locally, Yjs updates A's Y.Doc instantly (A sees it immediately — no
   waiting on the network). Yjs also emits a small binary update representing just that change.
5. A's client sends that update to the server via `sync-update`.
6. The server applies the update to its own server-side Y.Doc for that room, logs it to
   `operation_log`, and rebroadcasts it to every other client in the room (here, B).
7. B's client receives the update and applies it to B's local Y.Doc. Yjs's merge guarantees this
   integrates correctly with whatever B has typed locally in the meantime — no manual conflict
   resolution, no "accept/reject" prompts.
8. The editor UI re-renders based on the updated Y.Doc content.

How presence/cursors work: separately from document content, each client periodically sends its
cursor position and selection range as an `awareness-update`. The server rebroadcasts these to the
room (these are not persisted — they're ephemeral, "who's where right now" state). Each client
renders remote cursors as colored markers overlaid on the text at the reported position.

How offline queueing/reconciliation works: Yjs updates generated while offline are simply queued
in memory (or optionally in localStorage/IndexedDB for resilience across a page reload) since they
were never successfully sent. When the WebSocket reconnects, the client first requests the current
server state (in case other edits happened while offline), and Yjs's merge logic reconciles the
offline-generated updates with whatever changed on the server in the interim — the same
convergence guarantee that makes live multi-user editing work also makes "I was offline for 10
minutes" work, since from the CRDT's perspective it's just updates arriving late, not a special
case.

How version history works: the version history panel lists `document_snapshots` rows for the
document, newest first, with the `version_label` if one was set. Selecting a version loads that
snapshot's binary state into a read-only preview (a separate, non-shared Y.Doc instance used just
for rendering, so browsing history never risks mutating the live document). Restoring a version
applies that snapshot's state as a new update on top of the current document (never destructively
deleting history), so restoring is itself just another trackable change.

---

## 12. Edge Cases & Failure Scenarios

| Scenario | Expected Behavior |
|---|---|
| Client's WebSocket disconnects mid-edit (network drop) | Client keeps applying local edits to its own Y.Doc; UI shows a "reconnecting" indicator; on reconnect, client re-syncs and reconciles automatically (see 11). |
| Server restarts while clients are connected | All WebSocket connections drop; clients detect this and attempt reconnection with backoff; server reconstructs each room's Y.Doc from the latest snapshot + operation log on first re-join. |
| Two users are offline simultaneously and both edit the same paragraph, then both reconnect | Both sets of updates apply to the server's Y.Doc in whatever order they arrive; CRDT convergence guarantees both users end up seeing the identical final merged state, even though neither saw the other's edit happen live. |
| A malformed or corrupted binary update is received | Server wraps `Y.applyUpdate` in a try/catch; a failing update is logged and dropped rather than crashing the room or corrupting the shared state; the offending client receives an error message. |
| User's permission is downgraded (editor → viewer) while they're actively connected | Server should proactively notify the affected connection (a targeted `permission-changed` event) and reject any subsequent `sync-update` from them; client UI should switch to read-only immediately on receiving this event. |
| Same user opens the same document in two browser tabs | Both tabs are treated as independent connections in the room; this works correctly by default since it's architecturally identical to two different users — mention this explicitly as a "handled for free by the design" case in interviews. |
| A document grows very large (long operation log, many snapshots) | Old operation-log entries prior to the most recent snapshot are safe to prune periodically, since a snapshot + everything after it is always sufficient to reconstruct current state — document this as a planned maintenance job even if not fully implemented. |
| Clock skew between client and server for timestamps | Use server-assigned timestamps (`now()` in Postgres) for anything ordering-sensitive in storage, not client-reported times, since client clocks can't be trusted. |

---

## 13. Security Considerations

- AuthN/AuthZ on every layer: as stated in 10.7, both REST and WebSocket paths verify identity and
  role on every write — never inferred from what the UI displays.
- Input sanitization: rendered rich text must be sanitized to prevent stored XSS (a malicious user
  pasting a `<script>` tag into a shared document must not execute in other users' browsers) —
  sanitize on render, not just on save, as defense in depth.
- Rate limiting: basic per-connection rate limiting on WebSocket message volume prevents a single
  misbehaving or malicious client from flooding the room.
- Password storage: hashed with a strong, slow algorithm (bcrypt or argon2), never stored or
  logged in plaintext.
- JWT secrets and DB credentials: stored in environment variables, never committed to the
  repository; `.env` in `.gitignore` from day one.
- SQL injection: all queries parameterized (no string-concatenated SQL), regardless of whether a
  query builder or raw `pg` client is used.
- CORS: explicitly configured to only allow the deployed frontend's origin in production, not left
  wide open.
- Dependency hygiene: run `npm audit` (or equivalent) as part of CI to catch known-vulnerable
  dependencies before they ship.

---

## 14. Scalability Considerations

This project is deliberately scoped to prove correctness at a modest scale (see Non-Functional
Requirements), not to handle Google-scale traffic — but understanding how it would need to evolve
is itself valuable interview material:

- Horizontal scaling of the WebSocket layer: a single Node.js instance can hold rooms in memory,
  but multiple instances behind a load balancer need a shared way to broadcast updates across
  instances (since two users in the same room might land on different server instances). The
  standard solution is a pub/sub backplane (Redis pub/sub, or a message broker) so any instance
  can publish an update and all instances relay it to their locally-connected clients in that
  room.
- Database load: the operation log is write-heavy; at meaningful scale this benefits from
  batching writes and/or moving to an append-optimized store, plus the snapshot-based pruning
  strategy described in Edge Cases to keep replay bounded.
- Very large documents: extremely large documents (tens of thousands of concurrent operations) can
  make full-state snapshots expensive; a real system at that scale would look at more granular,
  incremental persistence rather than periodic full snapshots.
- Sharding: at very large scale, documents could be sharded across multiple database instances by
  document ID, since documents are independent of each other (no cross-document transactions
  needed) — this is a natural, "embarrassingly parallel" scaling axis worth naming explicitly.

---

## 15. Testing Strategy

- Unit tests: CRDT merge logic correctness (feed the same set of updates in different orders,
  assert identical final state); permission-check functions; JWT verification middleware;
  snapshot/restore serialization round-trips.
- Integration tests: simulate multiple WebSocket clients programmatically (using a test client
  library) issuing concurrent, interleaved edits to the same document, and assert the server's
  final state matches what all clients converge to.
- Concurrency/load tests: a scripted test that opens N simulated concurrent connections to one
  document and fires overlapping edits, verifying no update is dropped and no crash occurs.
- End-to-end tests: browser-level tests (Playwright) driving two real browser contexts editing the
  same document, asserting both views show identical, correctly merged content — this is the test
  that most directly proves the core FR-3 requirement.
- Manual test script for the demo recording: a documented step-by-step (open doc in 3 tabs, type
  simultaneously in overlapping positions, disconnect one tab's network, type more, reconnect,
  verify convergence) — this becomes both your test plan and your demo script.

---

## 16. DevOps / CI-CD Strategy

- Local development: `docker-compose.yml` running the Node.js app and PostgreSQL together, with a
  single `docker compose up` to get a full local environment running.
- CI pipeline (GitHub Actions): on every push/PR — install dependencies, run lint, run unit +
  integration test suites (spinning up a test Postgres instance as a CI service container), build
  the Docker image. A failing pipeline blocks merge.
- Branching: simple trunk-based flow is sufficient for a solo project — feature branches merged to
  main via PR, even if reviewing your own PR, to keep the habit of a clean commit history and a CI
  gate before merge.
- Secrets: managed via GitHub Actions secrets for CI, and the hosting provider's environment
  variable configuration for deployment — never hardcoded.

---

## 17. Cloud Deployment Strategy

- Recommended platform: Render or Fly.io — both support long-lived WebSocket connections (unlike
  some serverless platforms that aren't a natural fit for persistent connections) and have
  generous free/low-cost tiers appropriate for a portfolio project.
- Database: a managed Postgres instance (Render's managed Postgres, Neon, or Supabase) rather than
  self-hosting — removes an entire category of operational concerns not central to this project's
  learning goals.
- WebSocket considerations: ensure the chosen platform's load balancer/proxy supports WebSocket
  upgrade requests and doesn't aggressively time out idle-but-open connections.
- Environment separation: a single production environment is sufficient for this project; document
  how you'd add a staging environment as a "next step" rather than actually building one, to keep
  scope honest.

---

## 18. Monitoring & Observability Strategy

- Structured logging: use a structured logger (e.g., pino) rather than raw `console.log`, emitting
  JSON logs for connect/disconnect events, room joins/leaves, applied updates, and errors —
  structured logs are what real systems use because they're queryable, not just readable.
- Key metrics to track (even if just logged and eyeballed, not wired to a full dashboard): active
  WebSocket connections, active rooms, updates-processed-per-minute, snapshot-write latency,
  WebSocket error/disconnect rate.
- Health check endpoint: a simple `GET /healthz` verifying the process is up and the database is
  reachable, for use by the hosting platform's health monitoring.
- Optional cross-project tie-in: if you build the Real-Time Observability Dashboard project from
  your stack list later, this project's metrics endpoint is a natural, genuine data source to wire
  into it — worth a one-line note in the README even if not built now.

---

## 19. Success Metrics / KPIs

This project is "done and good" when:

- Three or more simultaneous users can type in overlapping positions of the same document with
  zero observed data loss, demonstrated on video.
- Automated tests prove CRDT convergence under at least 3 different update-ordering scenarios.
- Measured edit-propagation latency is under 200ms in a same-region deployed environment.
- A server restart mid-session results in zero loss of previously-synced (committed) content.
- Test suite (unit + integration + at least one E2E scenario) passes in CI on every commit to
  main.
- The application is reachable at a public URL, fully functional, not just runnable locally.

---

## 20. Assumptions & Constraints

- Solo developer, working part-time alongside a job search — realistic weekly time budget assumed
  to be roughly 15–25 hours.
- Timeline: 5–7 weeks total (see Milestone Plan).
- Budget: free or near-free hosting tiers only; no paid infrastructure required to hit the success
  metrics above.
- Browser-only, no native mobile client.
- English-only UI, no internationalization required.
- Text-focused rich formatting, not full document-processing feature parity with commercial tools.
- Yjs is the CRDT library of choice — not a hand-rolled CRDT — as a deliberate, honest scoping
  decision explained in 10.3.

---

## 21. Risks & Open Questions

**Risks:**
- Learning curve risk: Yjs and its ecosystem (providers, awareness protocol, editor bindings) have
  real depth; budget extra time in Phase 3 of the milestone plan specifically for this learning
  curve rather than assuming it's a quick integration.
- Scope creep risk: rich text formatting (P2) can quietly expand into a much bigger effort than it
  looks (ProseMirror/Yjs rich-text bindings have their own learning curve); if time is tight,
  plain-text-with-basic-formatting is a legitimate, honest place to stop.
- WebSocket hosting risk: not every free-tier hosting platform handles long-lived WebSocket
  connections well; validate this early (Phase 0) rather than discovering it during deployment in
  the final week.

**Open Questions** (to resolve during build, documented here so the decision is intentional, not
accidental):
- Should a permission downgrade mid-session forcibly disconnect the user, or just switch their
  client to read-only in place? (Current plan: switch in place, per Edge Cases section — revisit
  if it proves awkward.)
- Should offline edits persist across a full page reload (via IndexedDB), or is in-memory-only
  queuing sufficient for the demo? (Current plan: in-memory is sufficient for P0/P1; IndexedDB
  persistence is a reasonable P2 if time allows.)
- How aggressively should the operation log be pruned, and is that worth implementing versus just
  documenting as a "next step"? (Current plan: document the strategy in the README; only implement
  if core features are done with time to spare.)

---

## 22. Milestone-Based Development Plan

> Note: superseded operationally by the more granular 18-phase `ROADMAP.md`, which restructures
> this same plan for iterative AI-agent prompting. Kept here as the original product-level
> milestone framing.

**Phase 0 — Setup & Scaffolding (Days 1–3)**
- Initialize repo, docker-compose.yml (Node app + Postgres), basic Express server responding to a
  health check, basic React app shell, CI pipeline skeleton (lint + a placeholder test) running on
  push.
- Deliverable: `docker compose up` gives you a running (empty) full-stack app locally, and CI is
  green.

**Phase 1 — Single-User Editor + Persistence (Week 1)**
- Auth (register/login/JWT), document creation, a basic (non-real-time) editor that saves/loads
  content via REST.
- Deliverable: one logged-in user can create a document, type in it, refresh the page, and see
  their content persisted.

**Phase 2 — Permissions (Week 2, early)**
- Document ownership, document_permissions table and enforcement, permission-management UI
  (owner-only).
- Deliverable: an owner can grant/revoke editor/viewer access, and the server actually enforces it
  on REST endpoints.

**Phase 3 — Real-Time Sync Core (Week 2 late – Week 3)** — the heart of the project; budget the
most time here.
- Integrate Yjs on the client, build the WebSocket gateway and room management on the server, get
  two browser tabs syncing correctly.
- Deliverable: two simultaneous clients editing the same document converge correctly, verified
  manually and by an initial integration test.

**Phase 4 — Presence & Cursors (Week 4, early)**
- Awareness protocol, colored remote cursor rendering, active-user presence list.
- Deliverable: you can see who else is in the document and roughly where they're editing.

**Phase 5 — Version History & Offline Reconciliation (Week 4 late – Week 5)**
- Snapshot scheduling, operation log, version history UI, offline queueing + reconnect
  reconciliation.
- Deliverable: you can browse past versions, and disconnecting/reconnecting a client demonstrably
  reconciles correctly.

**Phase 6 — Testing & Security Hardening (Week 6, early)**
- Fill out the unit/integration/E2E test suite from Section 15, input sanitization, rate limiting,
  dependency audit.
- Deliverable: CI runs a real test suite covering the CRDT convergence claim, not just smoke
  tests.

**Phase 7 — Deployment, Monitoring, Demo Prep (Week 6 late – Week 7)**
- Deploy to Render/Fly.io with managed Postgres, wire up structured logging and the health check,
  record the demo video following the manual test script from Section 15, write the README
  (including this PRD as a linked doc), draft resume bullets.
- Deliverable: a public URL, a recorded demo, a polished README, and this project ready to put on
  a resume.

---

## 23. Definition of Done

This project is complete when all of the following are true:

- [ ] All P0 functional requirements (FR-1 through FR-6) are implemented and working in the
      deployed environment, not just locally.
- [ ] At least 4 of the 6 P1 requirements are implemented.
- [ ] The CRDT convergence guarantee is proven by an automated test, not just manual observation.
- [ ] A recorded demo exists showing 3+ simultaneous users editing without data loss, in under 2
      minutes of video.
- [ ] The app is deployed and reachable at a public URL.
- [ ] CI passes on main with a real test suite (not placeholder tests).
- [ ] The README includes: what the project does, why it's technically interesting, how to run it
      locally, architecture summary, and a link to this PRD.
- [ ] You can explain, without notes, how CRDT convergence works and why the server doesn't need
      to "decide" whose edit wins.

---

## 24. Resume / Interview Talking Points

**Resume bullet (example):**
> Built a real-time collaborative document editor supporting concurrent multi-user editing with
> zero data loss, implementing CRDT-based conflict resolution (Yjs), a WebSocket sync layer, and
> PostgreSQL-backed persistence with automated convergence testing; deployed and publicly
> accessible.

**Interview narrative — the story arc to have ready:**

1. The problem: most homegrown "collaborative" editors either lock the document or silently
   overwrite changes — explain why that's the case (no conflict-resolution data structure),
   briefly and confidently.
2. The core decision: why CRDTs (and specifically Yjs) rather than Operational Transformation or a
   naive last-write-wins approach — be ready to explain the tradeoff (OT requires a central
   sequencing authority and is notoriously hard to implement correctly; CRDTs guarantee
   convergence without one, at the cost of some metadata overhead per operation).
3. What you'd defend under pressure: be ready to explain, in your own words, why applying the same
   updates in different orders still converges — this is the single most likely deep-dive
   question, and it's the one place a shallow "I used a library" answer falls apart versus genuine
   understanding.
4. The failure-handling story: the offline-reconnect-reconciliation flow is a great concrete
   example to walk through — it shows you thought about the unhappy path, not just the demo path.
5. What you'd change at 100x scale: the Redis pub/sub backplane answer from Section 14 — shows
   system-design thinking beyond what you actually built, which is exactly what a senior
   interviewer is probing for.
6. Honest scoping: be upfront that this uses Yjs rather than a hand-rolled CRDT, and explain why
   that was the right engineering call (not a shortcut) — interviewers respect honest, reasoned
   scoping far more than an inflated claim that falls apart under one follow-up question.
