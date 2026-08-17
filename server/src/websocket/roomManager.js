import * as Y from 'yjs';
import { logger } from '../utils/logger.js';

// In-memory room registry: documentId -> Room. Phase 6 is deliberately
// in-memory only -- no database calls anywhere in this file. Phase 11
// replaces the "create a brand-new empty Y.Doc" branch in getOrCreateRoom
// below with actually loading persisted state (documentService's
// loadDocumentState), and adds a snapshot flush + short grace period to
// removeClientFromRoom before dropping an emptied room.
const rooms = new Map();

export class Room {
  constructor(documentId, yDoc) {
    this.documentId = documentId;
    this.yDoc = yDoc;
    this.clients = new Map(); // ws connection -> { userId }
  }
}

// Returns the existing in-memory room for documentId, creating one with a
// fresh, empty Y.Doc if it doesn't exist yet.
export function getOrCreateRoom(documentId) {
  let room = rooms.get(documentId);
  if (!room) {
    room = new Room(documentId, new Y.Doc());
    rooms.set(documentId, room);
    logger.info({ documentId }, 'created new in-memory room');
  }
  return room;
}

// Registers a connected client (a ws connection) in the room.
export function addClientToRoom(room, client, user) {
  room.clients.set(client, user);
  logger.info(
    { documentId: room.documentId, userId: user.userId, roomSize: room.clients.size },
    'client added to room'
  );
}

// Removes a client from the room. If the room is now empty, it's dropped
// from the in-memory registry immediately.
export function removeClientFromRoom(room, client) {
  const user = room.clients.get(client);
  room.clients.delete(client);
  logger.info(
    { documentId: room.documentId, userId: user?.userId, roomSize: room.clients.size },
    'client removed from room'
  );
  if (room.clients.size === 0) {
    rooms.delete(room.documentId);
    logger.info({ documentId: room.documentId }, 'room emptied, removed from memory');
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
