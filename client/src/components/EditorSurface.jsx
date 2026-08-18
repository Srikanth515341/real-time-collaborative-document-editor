import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';

// A plain-text contenteditable div bound to a Y.Text. Deliberately no rich
// formatting and no editing framework -- the goal for this phase is a
// correct, working plain-text sync engine, not a polished editor (that's a
// later concern, if ever).
//
// Forwards its DOM node so RemoteCursors (Phase 10) can measure caret
// positions against the exact same element this component renders text
// into -- the two need to agree on the same flat-text-node DOM shape
// described in the getCaretOffset/setCaretOffset comments below.
const EditorSurface = forwardRef(function EditorSurface({ yDoc, disabled, onAwarenessChange }, forwardedRef) {
  const ytext = useMemo(() => yDoc.getText('content'), [yDoc]);
  const divRef = useRef(null);
  useImperativeHandle(forwardedRef, () => divRef.current, []);

  // Re-renders the div's text from ytext, preserving the caret position if
  // the div is currently focused. Called both on mount and whenever ytext
  // changes -- including from a REMOTE update applied via
  // useYjsConnection -- since that's the only way another user's edit ever
  // actually shows up on screen.
  const renderFromYText = useCallback(() => {
    const div = divRef.current;
    if (!div) return;
    const newText = ytext.toString();
    if (getPlainText(div) === newText) return; // already showing this; don't touch the caret

    const hasFocus = document.activeElement === div;
    const caretOffset = hasFocus ? getCaretOffset(div) : null;

    div.innerText = newText;

    if (hasFocus && caretOffset !== null) {
      setCaretOffset(div, Math.min(caretOffset, newText.length));
    }
  }, [ytext]);

  useEffect(() => {
    renderFromYText();
    ytext.observe(renderFromYText);
    return () => ytext.unobserve(renderFromYText);
  }, [ytext, renderFromYText]);

  // Reports the local caret/selection to the parent (which forwards it to
  // useYjsConnection's throttled sendAwareness) whenever it changes --
  // typing, clicking, arrow keys, drag-selecting. `selectionchange` is a
  // document-wide event (not scoped to this element), so it's filtered down
  // to "is this editor actually focused right now".
  const reportSelection = useCallback(() => {
    const div = divRef.current;
    if (!div || !onAwarenessChange || document.activeElement !== div) return;
    const range = getSelectionRange(div);
    if (!range) return;
    onAwarenessChange({
      cursor: range.end,
      selection: range.start === range.end ? null : [range.start, range.end],
    });
  }, [onAwarenessChange]);

  useEffect(() => {
    document.addEventListener('selectionchange', reportSelection);
    return () => document.removeEventListener('selectionchange', reportSelection);
  }, [reportSelection]);

  // Translates a DOM input event into the minimal Y.Text insert/delete pair
  // needed to reconcile the old content with the new. A single keystroke or
  // paste almost always changes one contiguous region, so a common-prefix /
  // common-suffix diff is enough -- no need for a general diff algorithm.
  const handleInput = useCallback(() => {
    const div = divRef.current;
    if (!div) return;
    const newText = getPlainText(div);
    const oldText = ytext.toString();
    if (newText === oldText) return;

    const { start, oldEnd, newEnd } = diffRange(oldText, newText);

    // No explicit origin here -- that's what marks this as a LOCAL change.
    // useYjsConnection's 'update' listener relays anything that isn't
    // tagged with its SERVER_ORIGIN sentinel, which is exactly this.
    yDoc.transact(() => {
      if (oldEnd > start) {
        ytext.delete(start, oldEnd - start);
      }
      if (newEnd > start) {
        ytext.insert(start, newText.slice(start, newEnd));
      }
    });
    reportSelection();
  }, [ytext, yDoc, reportSelection]);

  return (
    <div
      ref={divRef}
      className="editor-surface"
      contentEditable={!disabled}
      suppressContentEditableWarning
      onInput={handleInput}
      onFocus={reportSelection}
      role="textbox"
      aria-multiline="true"
      aria-label="Document content"
      aria-readonly={disabled}
    />
  );
});

export default EditorSurface;

// A contenteditable div that's been fully cleared by the user (select-all +
// delete/backspace) is left by the browser holding a single stray <br> to
// keep the caret placeable in the now-empty region. innerText reports that
// state as "\n", not "" -- which would otherwise corrupt the synced content
// with a phantom newline every single time someone clears all the text.
// textContent doesn't have this quirk (a <br> element contributes nothing
// to it), so a textContent-empty div is treated as truly empty regardless
// of what innerText says. innerText is still used for the non-empty case
// since it's what correctly serializes multi-line content (typed Enter
// presses) into real "\n" characters -- textContent alone doesn't do that
// reliably across how browsers structure multi-line contenteditable DOM.
function getPlainText(div) {
  return div.textContent === '' ? '' : div.innerText;
}

function diffRange(oldText, newText) {
  const maxStart = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < maxStart && oldText[start] === newText[start]) {
    start += 1;
  }

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return { start, oldEnd, newEnd };
}

// These only need to handle a single flat text node -- renderFromYText
// always sets the div's content via `innerText`, which normalizes to
// exactly that (or an empty div), so there's no nested-element case to
// worry about.
function getCaretOffset(container) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

function setCaretOffset(container, offset) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const node = container.firstChild;

  if (node && node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, Math.min(offset, node.textContent.length));
  } else {
    range.setStart(container, 0);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Like getCaretOffset, but returns both ends of the current selection (equal
// if it's just a collapsed caret) for reporting to awareness. Same flat
// single-text-node assumption as everything else in this file: since
// startContainer/endContainer can only be the div itself (offset 0, an empty
// document) or its lone text node (offset == character offset directly),
// there's no need for the prefix-string-length trick getCaretOffset uses.
function getSelectionRange(container) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const offsetOf = (node, offset) => (node === container ? 0 : offset);
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
