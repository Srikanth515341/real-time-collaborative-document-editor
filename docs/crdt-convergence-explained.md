# Why CRDT Convergence Works — Explained Without Notes

This is written for one specific reader: me, a few months from now, in an interview, with no
code open and no time to look anything up. If I can read this once and then explain it out loud
in my own words, it did its job. Clarity beats completeness everywhere in this document.

## The problem, in one sentence

When two people edit the same document at the same time, you need a way to combine both edits
into one final document that makes sense — without a central server having to freeze everyone
else out while it decides whose edit goes first.

## Why the obvious approaches fail

**Locking** (only one person can edit at a time) isn't collaboration, it's a queue. Nobody wants
to wait for a lock to type a sentence.

**Last-write-wins** (whoever's save request reaches the server last overwrites everyone else) is
worse than it sounds: it doesn't just lose *conflicting* work, it can silently delete a
collaborator's *entire unrelated paragraph* just because their save request happened to lose a
network race. There's no warning, and there's nothing to undo, because the system never even
noticed a conflict happened.

Both approaches share the same flaw: they treat "the document" as one big blob of text, and the
only way to merge two versions of a blob is to pick one (or clumsily diff them, which is what
`git merge` does, and it's exactly the "conflict markers, please resolve manually" experience
nobody wants in a live text editor).

## The key idea: don't merge text, merge *operations*

A CRDT (Conflict-free Replicated Data Type) never actually merges two documents. Instead, it
represents the document as the *result of every insertion that ever happened to it*, and each of
those insertions is its own small, independent, permanently-identified fact. "Merging" two
people's edits is really just taking the union of two sets of facts. Union is a much easier
problem than diffing text, because union doesn't care what order you add things in — `{1, 2} ∪
{3}` is the same set as `{3} ∪ {1, 2}`, no matter which side you start from.

That single property — **the result doesn't depend on order** — is the entire trick. Everything
below is just explaining how Yjs (the CRDT library this project uses) actually builds "insertions"
that have that property.

## How one insertion gets built so it's order-independent

Two things make this work, and both are necessary:

**1. Every character you type gets a permanent, globally unique ID.** It's a pair: `(client ID,
counter)` — literally "the 47th operation the browser tab with ID `abc123` ever made." No two
clients ever produce the same ID, because no two clients share a client ID. This means when two
different browsers apply "the same" incoming update twice (say, because of a flaky reconnect),
the second application is a no-op — the ID's already there, nothing changes. That's what makes
CRDT updates **idempotent**, which is the same property this project leans on to safely resend a
client's full local state after a reconnect: redundant, already-known operations just get ignored.

**2. Every character remembers its neighbor, not its numeric position.** This is the part people
usually get wrong when they first hear "CRDT." It's tempting to think an insertion says "put this
at index 12" — but index 12 is meaningless the moment someone else inserts or deletes something
before position 12, because now "12" points somewhere else. Instead, a Yjs insertion says
something closer to "I go immediately after the character with ID `(clientB, 5)`." That
relationship never becomes stale, because it's not tied to a position that can shift — it's tied
to another specific character, which either exists or doesn't, regardless of anything else that
happened around it.

Put those two together and you get a big, append-only set of facts like: *"character X has ID
(A,1), goes after nothing (start of document); character Y has ID (B,1), goes after X."* Given
that same set of facts, any two computers will reconstruct the exact same sequence of characters,
because "who comes after whom" is fully determined by the facts themselves — there's no
"and then I looked at what else was around at the time" ambiguity that order of arrival could
affect.

## The one genuinely tricky case: two people insert at the exact same spot

Say Alice and Bob are both looking at an empty document and *both* type a character at the very
start, at the same instant, having never seen each other's keystroke. Both insertions say "I go
after nothing (start of document)" — they can't both be first. This is the one place order-of-
arrival *could* matter if it weren't handled carefully.

Yjs resolves this with a **deterministic tie-breaker**: when two insertions claim the same
"after" position, the one with the higher client ID wins the position and the other slots in
right behind it. Critically, *every* replica applies the exact same tie-breaking rule, so every
replica reaches the same decision regardless of which insertion it physically received first. The
result is deterministic, not "whoever the server heard from first" — which is exactly the
distinction that matters: nobody is favored by network luck.

## Why this adds up to "any order, same result"

Once every operation is (a) uniquely identified, (b) anchored to a stable relationship instead of
a shifting position, and (c) resolved by a rule that doesn't depend on arrival order — applying a
set of operations becomes what mathematicians would call **commutative and idempotent**: adding
operation A then B lands you in the same place as adding B then A, and adding the same operation
twice is the same as adding it once. That's not an accident of how Yjs happens to be implemented —
it's the actual design goal a CRDT is built to satisfy, and it's what "conflict-free" in the name
refers to: there is no conflict *state* to resolve, because the merge function was built from the
ground up to never produce a conflict in the first place.

This is also why the server in this project can get away with doing so little. It never inspects
an incoming edit to decide if it's "valid" relative to other edits, never queues edits waiting to
see what else might come in, never re-orders anything. It applies whatever arrives, to its own
copy of the CRDT, and rebroadcasts it. Every client does the same. Everyone ends up with the same
document, and the server never had to be smart about it — the correctness lives entirely in the
data structure, not in server logic.

## A concrete walk-through

Alice and Bob both start from the shared text `"Hello world"`.

- Alice, without seeing Bob's edit, inserts `"A says: "` at position 0.
- Bob, without seeing Alice's edit, inserts `" -- B was here"` at the end (position 11).

Each of those is really: *"insert these new characters, anchored to `H` (start-of-document) /
anchored to the final `d`."* Alice's insertion never mentions position 11 and Bob's never mentions
position 0 — they're anchored to completely different existing characters, so there's no
contention between them at all (the tie-breaker above only matters when two insertions anchor to
the *same* spot).

Whichever order the server (or any client) applies these two updates in, the reconstructed
sequence is the same: Alice's text is anchored before `Hello`, Bob's is anchored after `world`, and
the original `Hello world` sits, unchanged, in between. Final result either way:
`"A says: Hello world -- B was here"`.

This is exactly what `server/tests/unit/crdtMerge.test.js` proves mechanically (feeding the same
updates to two fresh documents in opposite orders and asserting identical output), what it then
proves under *all six* possible orderings of a three-way concurrent edit, and what
`server/tests/integration/multiClientSync.test.js` proves again — this time through the real
network and the real server, not just in an isolated unit test — including three genuinely
different delivery orderings for three real, authenticated WebSocket clients.

## The honest caveat, if asked

Yjs's guarantee applies to *character-level* insert/delete operations — it doesn't magically
understand semantic intent. If Alice and Bob both rewrite the same sentence into two totally
different sentences at the same time, the CRDT still converges to a well-defined result (both
sets of characters exist, deterministically ordered), but that result can look like garbled,
interleaved text rather than "the version a human would have picked." Convergence guarantees
*consistency* — everyone sees the same thing — not that the merged content is always what a
human would consider the *smartest* possible merge. That's a real, known tradeoff, and it's the
honest answer if someone probes on it rather than pretending CRDTs are magic.

## What I'd say if asked "why Yjs instead of Operational Transformation?"

OT can achieve a similar end result, but it does it by having the server maintain a canonical
order and *transform* incoming operations against whatever it missed — which means the server is
a required, stateful participant in every merge decision, and getting that transform logic
correct is notoriously easy to get subtly wrong (Google Wave's OT implementation was famous for
exactly this difficulty). A CRDT moves that complexity into the data structure itself, at the
cost of some extra metadata per character (the ID and anchor). For a project like this one, that
trade is clearly worth it: the correctness guarantee is provable and testable in complete
isolation from the server (see `crdtMerge.test.js`, which needs no server, no network, and no
database to prove the core claim) — which is a very different, and much stronger, position to
defend in an interview than "we transformed the operations and it seemed to work."
