// Role hierarchy per PRD.md Section 10.7: owner > editor > viewer.
const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 };

// Returns true if actualRole grants at least as much access as requiredRole.
// A null/undefined actualRole (no permission grant at all) never satisfies
// any required role.
export function satisfiesRole(actualRole, requiredRole) {
  if (!actualRole || !(actualRole in ROLE_RANK)) {
    return false;
  }
  return ROLE_RANK[actualRole] >= ROLE_RANK[requiredRole];
}
