import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { getAccessToken } from '../api/httpClient.js';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000';

// Tags a Y.Doc transaction as having come FROM the server. This is the
// single most important detail in this hook: every update to the Y.Doc --
// whether it's a change WE just typed, or a change we just received over
// the WebSocket -- fires the same 'update' event below, which is what
// relays local edits to the server. Without a way to tell those two cases
// apart, receiving an update would immediately re-send it right back to the
// server, which would broadcast it to us again, forever -- an infinite echo
// loop. Applying server-originated updates with this origin (instead of the
// default) is what lets the 'update' listener skip them.
const SERVER_ORIGIN = 'server-sync';

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 8;

// Caps outgoing awareness (cursor/selection) messages to at most one per
// 100ms per client -- PRD.md Section 11's presence pings are meant to be
// frequent enough to feel live, but a raw keyup/selectionchange listener can
// fire far faster than that (every keystroke, every arrow key, every mouse
// drag), so without this a fast typist would flood the room with dozens of
// messages a second for no visible benefit.
const AWARENESS_THROTTLE_MS = 100;

// Owns a Y.Doc and its WebSocket connection to the sync gateway for one
// document. Exposes { yDoc, connectionStatus, canEdit, error, participants,
// sendAwareness }.
export function useYjsConnection(documentId) {
  // documentId isn't used inside the factory, but it's the whole point of
  // the dependency: a new document needs a brand-new Y.Doc, not the
  // previous document's content carried over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yDoc = useMemo(() => new Y.Doc(), [documentId]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [canEdit, setCanEdit] = useState(true);
  const [error, setError] = useState(null);
  // Other users currently in the room: userId -> { id, displayName, color,
  // cursor, selection }. Populated entirely from user-joined / user-left /
  // awareness-update broadcasts -- never persisted, never fetched via REST,
  // exactly the ephemeral "who's where right now" model PRD.md Section 11
  // describes. Reset on every fresh join (including reconnects), since a
  // stale entry for someone who left while we were offline would otherwise
  // linger forever with no user-left to clear it.
  const [participants, setParticipants] = useState({});

  const wsRef = useRef(null);
  const connectionStatusRef = useRef('connecting'); // mirrors state for use inside WS callbacks
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const intentionalCloseRef = useRef(false);

  // Awareness throttle state -- see AWARENESS_THROTTLE_MS above. Leading +
  // trailing: the first call in a quiet period sends immediately, rapid
  // follow-up calls are coalesced into a single trailing send of the LATEST
  // position once the throttle window elapses, so the final cursor position
  // is never silently dropped.
  const awarenessLastSentAtRef = useRef(0);
  const awarenessPendingRef = useRef(null);
  const awarenessTimeoutRef = useRef(null);

  useEffect(() => {
    intentionalCloseRef.current = false;
    reconnectAttemptRef.current = 0;

    function updateStatus(next) {
      connectionStatusRef.current = next;
      setConnectionStatus(next);
    }

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      // A fresh join (first connect, or a reconnect after a drop) gets fresh
      // user-joined broadcasts for whoever's currently in the room -- any
      // stale entries from before are meaningless without that, since we
      // have no way to know who left while we were disconnected.
      setParticipants({});

      ws.addEventListener('open', () => {
        ws.send(
          JSON.stringify({ type: 'join-document', documentId, token: getAccessToken() })
        );
      });

      ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'sync-step' || message.type === 'sync-update') {
          Y.applyUpdate(yDoc, base64ToBytes(message.update), SERVER_ORIGIN);
          if (message.type === 'sync-step') {
            // A sync-step only ever arrives right after a successful join,
            // so this is our real "connected" signal -- not the WS 'open'
            // event, which only means the socket handshake succeeded, not
            // that the server actually accepted us into the room.
            reconnectAttemptRef.current = 0;
            setCanEdit(true);
            setError(null);
            updateStatus('connected');

            // Tell the server everything WE have, not just apply what it
            // just told us. Yjs updates are idempotent, so resending our
            // full current state is a safe no-op for anything the server
            // already knows, and is what keeps a brief disconnect from
            // silently dropping edits made locally during the gap (e.g.
            // typing while "Reconnecting"): they're still sitting in this
            // Y.Doc, and this is what actually gets them to the server once
            // we're back. Persisting an offline queue across a full page
            // reload is still Phase 12 -- this only covers what already
            // survives in memory across a live reconnect.
            ws.send(
              JSON.stringify({
                type: 'sync-update',
                documentId,
                update: bytesToBase64(Y.encodeStateAsUpdate(yDoc)),
              })
            );
          }
          return;
        }

        if (message.type === 'user-joined') {
          const { user } = message;
          setParticipants((prev) => ({
            ...prev,
            [user.id]: { ...prev[user.id], id: user.id, displayName: user.displayName, color: user.color },
          }));
          return;
        }

        if (message.type === 'user-left') {
          setParticipants((prev) => {
            if (!(message.userId in prev)) return prev;
            const next = { ...prev };
            delete next[message.userId];
            return next;
          });
          return;
        }

        if (message.type === 'awareness-update') {
          setParticipants((prev) => ({
            ...prev,
            [message.userId]: {
              ...prev[message.userId],
              id: message.userId,
              color: message.awareness.color ?? prev[message.userId]?.color,
              cursor: message.awareness.cursor,
              selection: message.awareness.selection,
            },
          }));
          return;
        }

        if (message.type === 'error') {
          setError(message);
          if (message.code === 'PERMISSION_DENIED' || message.code === 'UNAUTHORIZED') {
            if (connectionStatusRef.current === 'connected') {
              // Rejected on a sync-update while already connected (e.g. our
              // role was downgraded mid-session). The connection itself is
              // still fine -- just this edit wasn't allowed -- so don't
              // tear anything down, just stop treating ourselves as able
              // to edit.
              setCanEdit(false);
            } else {
              // Rejected at join. The server closes the socket right after
              // sending this, and retrying won't help (the permission
              // problem won't fix itself), so don't reconnect.
              intentionalCloseRef.current = true;
              updateStatus('disconnected');
            }
          }
          return;
        }
      });

      ws.addEventListener('close', () => {
        if (intentionalCloseRef.current) {
          return;
        }
        scheduleReconnect();
      });
    }

    function scheduleReconnect() {
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setError({
          code: 'CONNECTION_LOST',
          message: 'Unable to reconnect after several attempts.',
        });
        updateStatus('disconnected');
        setParticipants({}); // no live connection left to have any presence over
        return;
      }
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttemptRef.current,
        MAX_RECONNECT_DELAY_MS
      );
      reconnectAttemptRef.current += 1;
      updateStatus('reconnecting');
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    }

    updateStatus('connecting');
    connect();

    return () => {
      intentionalCloseRef.current = true;
      clearTimeout(reconnectTimeoutRef.current);
      clearTimeout(awarenessTimeoutRef.current);
      wsRef.current?.close();
      yDoc.destroy();
    };
  }, [documentId, yDoc]);

  // Sends a throttled cursor/selection ping to the server (PRD.md Section
  // 10.5's `awareness-update`). `awareness` is `{ cursor, selection }` --
  // `cursor` a character offset, `selection` either null (collapsed caret)
  // or a [start, end] pair. See AWARENESS_THROTTLE_MS above for why this
  // isn't a plain unthrottled ws.send.
  const sendAwareness = useCallback(
    (awareness) => {
      const doSend = () => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        awarenessLastSentAtRef.current = Date.now();
        ws.send(JSON.stringify({ type: 'awareness-update', documentId, awareness }));
      };

      const elapsed = Date.now() - awarenessLastSentAtRef.current;
      if (elapsed >= AWARENESS_THROTTLE_MS) {
        awarenessPendingRef.current = null;
        doSend();
        return;
      }

      // Within the throttle window: remember the LATEST position and make
      // sure exactly one trailing send is scheduled for when the window
      // ends, so a burst of calls (e.g. every keystroke) collapses into one
      // message instead of one per call.
      awarenessPendingRef.current = awareness;
      if (!awarenessTimeoutRef.current) {
        awarenessTimeoutRef.current = setTimeout(() => {
          awarenessTimeoutRef.current = null;
          const pending = awarenessPendingRef.current;
          awarenessPendingRef.current = null;
          if (pending) {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            awarenessLastSentAtRef.current = Date.now();
            ws.send(JSON.stringify({ type: 'awareness-update', documentId, awareness: pending }));
          }
        }, AWARENESS_THROTTLE_MS - elapsed);
      }
    },
    [documentId]
  );

  // Relays LOCAL edits to the server. See the SERVER_ORIGIN comment above --
  // this is the other half of the echo-loop check: updates applied with
  // SERVER_ORIGIN (i.e. ones we just received) are skipped; everything else
  // (a plain local Y.Text.insert/delete from EditorSurface, whose origin is
  // the Yjs default) gets sent on.
  useEffect(() => {
    function handleUpdate(update, origin) {
      if (origin === SERVER_ORIGIN) {
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Not connected right now. The edit is still safely in our own
        // Y.Doc; there's no queueing to do here beyond what Yjs already
        // gives us for free -- full offline queueing/reconciliation is
        // Phase 12. Once reconnected, our next join-document gets us a
        // fresh sync-step, and this local change becomes part of what we
        // broadcast via future updates from here.
        return;
      }
      ws.send(
        JSON.stringify({
          type: 'sync-update',
          documentId,
          update: bytesToBase64(update),
        })
      );
    }

    yDoc.on('update', handleUpdate);
    return () => yDoc.off('update', handleUpdate);
  }, [yDoc, documentId]);

  return { yDoc, connectionStatus, canEdit, error, participants, sendAwareness };
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
