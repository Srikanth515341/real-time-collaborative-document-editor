// Mirrors server/src/utils/presenceColor.js exactly (same palette, same
// hash) so a user's own avatar shows the identical color their collaborators
// see for them -- the server is the source of truth for every OTHER user's
// color (it comes over the wire in user-joined/awareness-update messages),
// but there's no message that tells you your own, so the local user computes
// it the same deterministic way. If you change one file, change both.
const PALETTE = [
  '#E64980',
  '#F76707',
  '#F59F00',
  '#66A80F',
  '#0CA678',
  '#1098AD',
  '#4C6EF5',
  '#7048E8',
  '#AE3EC9',
  '#495057',
];

export function getColorForUser(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
