import { getColorForUser } from '../utils/presenceColor.js';

// Shows who's currently connected to this document -- purely derived from
// useYjsConnection's `participants` map (populated live from user-joined /
// user-left broadcasts), so it updates in real time with no polling, and
// naturally shows nobody once everyone's left. No "last seen" / offline
// history here by design -- PRD.md Section 11 treats presence as strictly
// "who's here right now" (out of scope for this phase, see ROADMAP.md
// Phase 10).
export default function PresenceBar({ participants, currentUser }) {
  const others = Object.values(participants).filter((p) => p.displayName);

  return (
    <div className="presence-bar" role="group" aria-label="People currently viewing this document">
      {currentUser && (
        <span
          className="presence-avatar"
          style={{ backgroundColor: getColorForUser(currentUser.id) }}
          title={`${currentUser.displayName} (you)`}
        >
          {initialsOf(currentUser.displayName)}
        </span>
      )}
      {others.map((p) => (
        <span
          key={p.id}
          className="presence-avatar"
          style={{ backgroundColor: p.color }}
          title={p.displayName}
        >
          {initialsOf(p.displayName)}
        </span>
      ))}
      {others.length === 0 && <span className="presence-empty">You&rsquo;re the only one here</span>}
    </div>
  );
}

function initialsOf(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
