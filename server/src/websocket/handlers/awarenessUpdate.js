import { broadcastToRoom } from '../roomManager.js';

// Relays cursor/selection presence to everyone else in the room. This is
// deliberately the simplest handler in the codebase: per PRD.md Section 11,
// awareness data is ephemeral, "who's where right now" state that is never
// persisted -- there is no DB import here at all, and none should ever be
// added. A client that hasn't joined a room yet (or already left) has
// nothing to broadcast to, so it's silently ignored rather than erroring --
// unlike sync-update, a stray or late awareness ping isn't worth surfacing
// an error for.
//
// No separate permission re-check here beyond "successfully joined this
// room": join-document already enforced at least 'viewer' access, and
// FR-7/FR-8 apply to every active collaborator, not just editors, so a
// viewer's cursor should be visible too, same as an editor's.
export function handleAwarenessUpdate(client, message) {
  const room = client.room;
  if (!room) {
    return;
  }

  const { awareness } = message;
  if (!awareness || typeof awareness !== 'object') {
    return;
  }
  if (awareness.cursor !== undefined && typeof awareness.cursor !== 'number') {
    return;
  }

  broadcastToRoom(
    room,
    {
      type: 'awareness-update',
      documentId: room.documentId,
      userId: client.userId,
      awareness: {
        cursor: awareness.cursor,
        selection: Array.isArray(awareness.selection) ? awareness.selection : null,
        color: client.color,
      },
    },
    client
  );
}
