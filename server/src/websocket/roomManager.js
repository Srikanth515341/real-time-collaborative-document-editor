import { logger } from '../utils/logger.js';
import * as documentService from '../services/documentService.js';

// In-memory room registry: documentId -> Room.
const rooms = new Map();

// In-flight room creations: documentId -> Promise<Room>. Guards against a
// race where two clients join the same not-yet-open document at nearly the
// same time -- without this, both could see `rooms` miss and each start
// their own loadDocumentState() call, producing two different Y.Docs and
// silently losing whichever client got attached to the one that didn't win
// the final `rooms.set`.
const roomCreationPromises = new Map();

// Pending empty-room cleanup timers: documentId -> Timeout.
const pendingCleanups = new Map();
const ROOM_EMPTY_GRACE_PERIOD_MS = 5000;

export class Room {
  constructor(documentId, yDoc) {
    this.documentId = documentId;
    this.yDoc = yDoc;
    this.clients = new Map(); // ws connection -> { userId }
  }
}

// Returns the existing in-memory room for documentId, or creates one by
// hydrating it via documentService.loadDocumentState (snapshot + operation
// log replay — see documentService.js for what that means today vs. once
// Phase 11 adds persistence-on-write).
export async function getOrCreateRoom(documentId) {
  const existing = rooms.get(documentId);
  if (existing) {
    return existing;
  }

  let creating = roomCreationPromises.get(documentId);
  if (!creating) {
    creating = createRoom(documentId);
    roomCreationPromises.set(documentId, creating);
    creating.finally(() => roomCreationPromises.delete(documentId));
  }
  return creating;
}

async function createRoom(documentId) {
  const yDoc = await documentService.loadDocumentState(documentId);
  const room = new Room(documentId, yDoc);
  rooms.set(documentId, room);
  logger.info({ documentId }, 'created new in-memory room');
  return room;
}

// Registers a connected client (a ws connection) in the room. `user` is
// { userId, displayName, color } -- the same shape broadcast in user-joined
// / user-left messages, so removeClientFromRoom below can announce a leave
// without needing any extra lookup. Cancels any pending empty-room cleanup,
// since the room is no longer empty.
export function addClientToRoom(room, client, user) {
  clearPendingCleanup(room.documentId);
  room.clients.set(client, user);
  logger.info(
    { documentId: room.documentId, userId: user.userId, roomSize: room.clients.size },
    'client added to room'
  );
}

// Removes a client from the room and announces the departure to whoever's
// left (PRD.md Section 10.5's `user-left`) so this fires exactly once no
// matter which of the two paths that can trigger a leave -- the explicit
// leave-document message, or the ws 'close' event -- called it, instead of
// duplicating the broadcast at both call sites. If the room is now empty,
// it isn't torn down immediately -- a short grace period lets the same user
// reconnect (e.g. a brief network blip, or navigating between documents)
// without forcing a full reload of the room's state.
export function removeClientFromRoom(room, client) {
  const user = room.clients.get(client);
  room.clients.delete(client);
  logger.info(
    { documentId: room.documentId, userId: user?.userId, roomSize: room.clients.size },
    'client removed from room'
  );
  if (user) {
    broadcastToRoom(room, { type: 'user-left', documentId: room.documentId, userId: user.userId }, client);
  }
  if (room.clients.size === 0) {
    scheduleRoomCleanup(room);
  }
}

function scheduleRoomCleanup(room) {
  clearPendingCleanup(room.documentId);
  const timeoutId = setTimeout(() => {
    pendingCleanups.delete(room.documentId);
    // Only remove if still empty and still the current room for this
    // documentId -- someone may have reconnected during the grace period.
    if (room.clients.size === 0 && rooms.get(room.documentId) === room) {
      rooms.delete(room.documentId);
      logger.info(
        { documentId: room.documentId },
        'room emptied and grace period elapsed, removed from memory'
      );
    }
  }, ROOM_EMPTY_GRACE_PERIOD_MS);
  // Let the process exit if this timer is the only thing keeping it alive
  // (matters for tests and clean shutdown).
  timeoutId.unref?.();
  pendingCleanups.set(room.documentId, timeoutId);
}

function clearPendingCleanup(documentId) {
  const existing = pendingCleanups.get(documentId);
  if (existing) {
    clearTimeout(existing);
    pendingCleanups.delete(documentId);
  }
}

// Sends message to every client in the room except (optionally) one.
export function broadcastToRoom(room, message, excludeClient) {
  const payload = JSON.stringify(message);
  for (const client of room.clients.keys()) {
    if (client !== excludeClient && client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

// Exposed for tests/introspection only.
export function getRoomCount() {
  return rooms.size;
}
