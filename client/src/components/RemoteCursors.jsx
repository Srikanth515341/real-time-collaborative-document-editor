import { useEffect, useMemo, useState } from 'react';

// Overlays other users' cursor position (and selection range, where given)
// on top of EditorSurface's plain contenteditable div, in their assigned
// color. Pure rendering -- all the presence data comes from useYjsConnection's
// `participants` map (populated from user-joined/user-left/awareness-update
// broadcasts); this component does no networking of its own.
//
// `containerRef` must point at the SAME DOM node EditorSurface renders text
// into (it forwards its ref for exactly this reason), since positions are
// computed by measuring Range rects against that element's actual text node.
export default function RemoteCursors({ containerRef, yDoc, participants }) {
  const ytext = useMemo(() => yDoc.getText('content'), [yDoc]);
  // No data is derived into state here on purpose -- this just needs a
  // render trigger. An edit anywhere in the doc can shift where an
  // unrelated remote cursor's offset lands on screen, so any ytext change
  // (or a resize, which changes line-wrapping) forces a re-measure.
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const rerender = () => forceRerender((n) => n + 1);
    ytext.observe(rerender);
    window.addEventListener('resize', rerender);
    return () => {
      ytext.unobserve(rerender);
      window.removeEventListener('resize', rerender);
    };
  }, [ytext]);

  const container = containerRef.current;
  if (!container) return null;

  const textLength = ytext.toString().length;
  const withCursors = Object.values(participants).filter((p) => typeof p.cursor === 'number');

  return (
    <div className="remote-cursors-layer" aria-hidden="true">
      {withCursors.map((p) => {
        const cursor = Math.min(p.cursor, textLength);
        const caretRect = getOffsetRect(container, cursor);
        const selectionRects =
          Array.isArray(p.selection) && p.selection.length === 2
            ? getRangeRects(container, Math.min(...p.selection), Math.max(...p.selection))
            : [];

        return (
          <div key={p.id}>
            {selectionRects.map((rect, i) => (
              <div
                key={i}
                className="remote-selection"
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  backgroundColor: p.color,
                }}
              />
            ))}
            {caretRect && (
              <div
                className="remote-caret"
                style={{ left: caretRect.left, top: caretRect.top, height: caretRect.height, backgroundColor: p.color }}
              >
                <span className="remote-caret-label" style={{ backgroundColor: p.color }}>
                  {p.displayName ?? 'Someone'}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Computes the on-screen position of a character offset within `container`,
// relative to the container's own top-left corner (so it can be placed with
// `position: absolute` inside a `position: relative` wrapper). EditorSurface
// always renders a single flat text node (or an empty div) -- see its own
// getCaretOffset/getSelectionRange comments -- so the offset maps directly
// onto that one node without walking any DOM tree.
function getOffsetRect(container, offset) {
  const textNode = container.firstChild;
  const containerRect = container.getBoundingClientRect();

  const range = document.createRange();
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const safeOffset = Math.min(offset, textNode.textContent.length);
    range.setStart(textNode, safeOffset);
    range.setEnd(textNode, safeOffset);
  } else {
    range.setStart(container, 0);
    range.setEnd(container, 0);
  }

  const rect = range.getClientRects()[0];
  if (!rect) {
    // An offset right at a line break can have no rect of its own -- fall
    // back to the container's top-left rather than rendering nothing.
    return { left: 0, top: 0, height: 20 };
  }
  return {
    left: rect.left - containerRect.left,
    top: rect.top - containerRect.top,
    height: rect.height,
  };
}

// Same idea as getOffsetRect but spans a range instead of a single point --
// getClientRects() naturally returns one rect per visual line, so a
// selection that wraps across multiple lines highlights correctly with no
// extra handling needed here.
function getRangeRects(container, start, end) {
  const textNode = container.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE || start === end) return [];

  const containerRect = container.getBoundingClientRect();
  const len = textNode.textContent.length;
  const range = document.createRange();
  range.setStart(textNode, Math.min(start, len));
  range.setEnd(textNode, Math.min(end, len));

  return Array.from(range.getClientRects()).map((rect) => ({
    left: rect.left - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height,
  }));
}
