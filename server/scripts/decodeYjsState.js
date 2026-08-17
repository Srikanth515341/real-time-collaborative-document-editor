import * as Y from 'yjs';

// Manual-testing helper only (not part of the server itself). Decodes a
// base64 Yjs update/state (e.g. copied from a sync-step or sync-update
// message received in wscat) back into readable text, so you can actually
// see what a room's merged content is. Usage:
//   node scripts/decodeYjsState.js "<base64>"
const base64 = process.argv[2];
if (!base64) {
  console.error('Usage: node scripts/decodeYjsState.js "<base64 update>"');
  process.exit(1);
}

const doc = new Y.Doc();
Y.applyUpdate(doc, Buffer.from(base64, 'base64'));
console.log(doc.getText('content').toString());
