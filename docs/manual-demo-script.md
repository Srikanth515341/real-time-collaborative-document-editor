# Manual Demo Script — Live Collaborative Editing & Offline Reconciliation

A precise, numbered walkthrough for demonstrating this project's core claim live — in an
interview, or as a screen-recorded demo video. Follow it exactly; don't improvise the steps
(the narration is yours to make natural, but the actions and what to point at are scripted so
nothing gets fumbled live).

**Total time: ~4–5 minutes.** Two parts: Part A (3-way live sync, ~2 min) and Part B (offline
edit + reconnect reconciliation, ~2–3 min). Part A is the more visually convincing "wow" moment;
lead with it.

---

## Before you start (do this off-camera / before the call)

1. Make sure the full stack is running:
   ```bash
   docker compose up -d
   ```
   Confirm `http://localhost:4000/healthz` returns `{"status":"ok","db":"ok"}` and
   `http://localhost:5173` loads.
2. Open **three separate browser windows** (not just tabs — windows side by side are much
   clearer on screen than tabs you have to switch between). Arrange them so all three are
   visible at once (e.g. three vertical columns, or a 2-up + 1 below layout).
3. In each window, register a fresh account (or reuse three you've already created):
   - Window 1: **Maya** (this will be the document owner)
   - Window 2: **Alex**
   - Window 3: **Jordan**

   (These names match the PRD's own personas — using them ties the demo back to the product
   narrative if anyone asks "who would actually use this?")
4. In Window 1 (Maya), create a new document and rename it to something demo-friendly, e.g.
   "Live Demo — Q3 Planning Doc".
5. Still in Window 1, open the Access panel and grant **Alex** and **Jordan** `editor` access.
6. In Windows 2 and 3, navigate to the same document URL. All three windows should now show a
   green **Connected** badge. **Do not proceed until all three say Connected** — if one is stuck
   on "Connecting…", refresh it.
7. Clear the editor content in all three windows so you're starting from a blank document
   (select all, delete, in any one window — the others will sync to match).

You're ready. Everything from here on is the live part.

---

## Part A — Three-way simultaneous overlapping editing

**What you're proving:** three independent people, typing in the same place at the same time,
never lose a keystroke and always end up looking at the identical document.

1. **Say out loud** (or type as a caption if recording silently): "All three of these windows
   are logged in as different accounts, connected to the same document over its own WebSocket
   connection. Watch what happens when all three of us type at the exact same position, at the
   exact same time."
2. Click into the editor in **all three windows** (click, don't just focus — make sure the caret
   is visibly blinking in each).
3. **At the same time** (literally: place your hands on all three... if solo, use two hands plus
   have a plan — or genuinely alternate keystrokes fast enough that it's clearly concurrent, not
   sequential), type into each window:
   - Window 1 (Maya): `MMMMMMMMMM`
   - Window 2 (Alex): `AAAAAAAAAA`
   - Window 3 (Jordan): `JJJJJJJJJJ`

   It doesn't matter that this isn't "real" prose — the point being demonstrated is merge
   correctness, not writing quality. (If you want a more narrative version for a polished demo
   video, have each window type a different overlapping sentence fragment instead, e.g. Window 1
   types "The roadmap should prioritize " at position 0 while Window 2 simultaneously types
   "mobile first, then " at the same position 0 — the effect is the same, just prettier on
   screen.)
4. Stop typing. Wait 1–2 seconds.
5. **Point at all three screens.** All three should show the exact same interleaved jumble of
   M's, A's, and J's, in the exact same order, in every window.
6. **Say out loud:** "Nobody's edit overwrote anyone else's. All 30 characters from all three of
   us are present, in the same order, in every single window — and none of us saw a merge
   conflict dialog or had to resolve anything. That's the CRDT doing its job: the server never
   decided whose edit 'won,' because there's no such thing as winning — every edit is just
   folded into the shared state, and the math guarantees everyone converges on the same result
   regardless of what order the network happened to deliver things in."

This is the single most convincing sixty seconds of the entire project. If you only have time to
show one thing, show this.

---

## Part B — Offline edit + reconnection reconciliation

**What you're proving:** a dropped connection doesn't lose work, and reconnecting doesn't require
any manual "resolve conflict" step.

1. Pick **one** window — Window 3 (Jordan) — to go offline.
2. Open that browser's DevTools (F12), go to the **Network** tab, and set throttling to
   **Offline**. (Alternatively: physically disconnect Wi-Fi, but devtools throttling is cleaner
   for a screen recording since it's scoped to just that one window/tab.)
3. **Point at Jordan's window.** Within a few seconds, the connection badge should change from
   **Connected** to **Reconnecting…**.
4. **Say out loud:** "Jordan just lost their connection — you can see the status badge reflect
   that immediately, so they're never left guessing. But watch: they can keep working."
5. Click into Jordan's editor and type: `OFFLINE EDIT FROM JORDAN `
6. **Point out**: the text appears normally in Jordan's own window, even though it's offline —
   nothing is blocked or greyed out.
7. **Say out loud:** "This edit only exists locally right now — it hasn't reached the server or
   the other two windows. If Jordan just closed their laptop here, this line would be safely
   sitting in their local document. Now let's reconnect."
8. In DevTools, set the Network throttle back to **No throttling** (or reconnect Wi-Fi).
9. **Point at Jordan's badge**: it should transition back to **Connected** within a couple of
   seconds.
10. **Point at Windows 1 and 2 (Maya and Alex)**: within a moment, `OFFLINE EDIT FROM JORDAN`
    should appear in their editors too, merged in with everything already there.
11. **Say out loud:** "As soon as Jordan reconnected, that offline edit synced automatically — no
    dialog, no manual merge, no 'accept theirs / accept mine.' From the CRDT's perspective, a
    change that happened while offline is just an update that arrived late. It merges exactly
    the same way a live concurrent edit does, which is the whole reason this architecture handles
    both cases with the same mechanism instead of needing separate special-case logic for
    'offline mode.'"

---

## If something goes wrong live

- **A window won't show Connected**: refresh it. If it still won't connect, check that
  `docker compose ps` shows all three containers `Up` and `/healthz` is green.
- **Typing doesn't appear to sync**: give it 2–3 seconds — same-machine localhost latency should
  be near-instant, but don't panic-narrate if there's a beat of lag.
- **You fumble the "simultaneous" typing and it looks sequential instead of interleaved**: that's
  fine — even sequential concurrent edits from three sources prove the same point, just less
  dramatically. Don't restart the demo; keep going and let the final "look, all three converged
  identically" moment carry it.
- **Someone asks "what if it hadn't converged?"**: that's your cue to reference
  `docs/crdt-convergence-explained.md` and `server/tests/unit/crdtMerge.test.js` /
  `server/tests/integration/multiClientSync.test.js` — this isn't just a demo that happened to
  work once, it's backed by automated tests that prove convergence across multiple explicit
  delivery orderings, every time, in CI.
