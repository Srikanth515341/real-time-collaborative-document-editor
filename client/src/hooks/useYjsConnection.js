import { useEffect, useMemo, useRef, useState } from 'react';
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

// Owns a Y.Doc and its WebSocket connection to the sync gateway for one
// document. Exposes { yDoc, connectionStatus, canEdit, error }.
export function useYjsConnection(documentId) {
  // documentId isn't used inside the factory, but it's the whole point of
  // the dependency: a new document needs a brand-new Y.Doc, not the
  // previous document's content carried over.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yDoc = useMemo(() => new Y.Doc(), [documentId]);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [canEdit, setCanEdit] = useState(true);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const connectionStatusRef = useRef('connecting'); // mirrors state for use inside WS callbacks
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const intentionalCloseRef = useRef(false);

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
      wsRef.current?.close();
      yDoc.destroy();
    };
  }, [documentId, yDoc]);

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

  return { yDoc, connectionStatus, canEdit, error };
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
