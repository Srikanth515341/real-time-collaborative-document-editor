import * as Y from 'yjs';

// Manual-testing helper only (not part of the server itself). wscat can't
// hand-craft a valid binary Yjs update, so this prints one you can paste
// into a sync-update message body. Usage:
//   node scripts/makeYjsUpdate.js "some text"
const text = process.argv[2];
if (!text) {
  console.error('Usage: node scripts/makeYjsUpdate.js "text to insert"');
  process.exit(1);
}

const doc = new Y.Doc();
doc.getText('content').insert(0, text);
const update = Y.encodeStateAsUpdate(doc);
console.log(Buffer.from(update).toString('base64'));
