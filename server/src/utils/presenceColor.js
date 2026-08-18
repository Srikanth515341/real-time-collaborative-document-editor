// A small, fixed, visually-distinct palette. Presence colors don't need to
// be infinite -- just distinct enough to tell collaborators apart at a
// glance and legible against a light editor background.
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

// Deterministic: the same userId always maps to the same color, computed
// independently by every server instance (and mirrored on the client for the
// local user's own avatar -- see client/src/utils/presenceColor.js) with no
// coordination needed. This is what PRD.md FR-7 means by "a distinct,
// consistent color per user" -- consistent across reconnects and sessions,
// not just for the lifetime of one connection.
export function getColorForUser(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
