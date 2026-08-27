import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  initDatabase,
  getSession,
  getProgressOps,
  getUnackedProgressOps,
  getLatestCheckpoint,
  getSyncSnapshot,
  getDeviceId,
  getDeviceSeqHigh,
  setDeviceSeqHigh,
  insertProgressOpsBatch,
  saveCheckpoint,
  updateSessionStatus,
  updateSessionError,
  unpackCompletedBitmap,
  ProgressOperation,
  StitchingSession,
  GameplayEvent,
  getGameplaySeqHigh,
  setGameplaySeqHigh,
  insertGameplayEventsBatch,
} from '../local-db';
import { flushGameplayEvents } from '../sync/gameplayEventEngine';
import * as FileSystem from 'expo-file-system/legacy';

import { loadBundledPattern } from '../bundled-patterns';
import {
  base64ToUint8Array,
  deleteOfflinePatternFile,
  getOfflinePatternPath,
  retryDownload,
  waitUntilSessionReady,
} from '../session-preparation';
import { decodePatternArtifact } from '../pattern-artifact';
import { getActiveIdentity } from '../local-db';
import { PatternData } from '../pattern-artifact';
import { RendererState } from '../renderer';
import { useIdentityStore } from '../identity/guestIdentity';
import { syncSession, completeSession } from '../sync/progressSyncEngine';
import { emitTutorialEvent } from '../onboarding/tutorialEvents';
import { ProgressSyncError } from '../api/progressSync';
import {
  captureGameplayEvent,
  captureSessionGameplayEvent,
} from '../analytics/gameplayEvents';

export function useStitchingSession(sessionId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<StitchingSession | null>(null);
  const [patternData, setPatternData] = useState<PatternData | null>(null);
  const [rendererState, setRendererState] = useState<RendererState | null>(null);
  
  // Reactive states for the UI
  const [remainingCounts, setRemainingCounts] = useState<number[]>([]);
  const [isSessionCompleted, setIsSessionCompleted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [totalCellsCount, setTotalCellsCount] = useState(0);
  const [completedCellsCount, setCompletedCellsCount] = useState(0);

  // Reactive: a single conflict notice when the server overrode a local op.
  const [hasSyncConflict, setHasSyncConflict] = useState(false);
  // Set when the backend reports this Pattern was Safety Removed while the
  // session was open. Offline Pattern Data for it is deleted locally and the
  // session stops accepting further play.
  const [patternRemoved, setPatternRemoved] = useState(false);
  // Bumped whenever a sync folds server-changed cells into the renderer, so the
  // canvas can refresh its shared completed bitmap.
  const [syncTick, setSyncTick] = useState(0);

  // Keep references to avoid stale closures in flusher and timer loops
  const deviceIdRef = useRef<string>('');
  const deviceSeqRef = useRef<number>(0);
  const sessionRevisionRef = useRef<number>(0);
  // Last-known server revision (account sessions). Stamped onto each op so the
  // server can judge causality; advanced after every successful sync.
  const serverRevisionRef = useRef<number>(0);
  const isAccountSessionRef = useRef<boolean>(false);
  const remoteSessionIdRef = useRef<string | null>(null);
  const syncInFlightRef = useRef<boolean>(false);
  const gameplaySyncInFlightRef = useRef<boolean>(false);
  const pendingOpsRef = useRef<ProgressOperation[]>([]);
  const undoStackRef = useRef<number[]>([]);
  const gameplayClientSeqRef = useRef<number>(0);
  const pendingGameplayEventsRef = useRef<GameplayEvent[]>([]);
  
  const sessionRef = useRef<StitchingSession | null>(null);
  const patternDataRef = useRef<PatternData | null>(null);
  const rendererStateRef = useRef<RendererState | null>(null);

  // Incremental counters so the stitch path never scans the grid (ADR-0031)
  const remainingCountsRef = useRef<number[]>([]);
  const totalCellsRef = useRef(0);
  const completedCellsRef = useRef(0);

  // Keep refs updated
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    patternDataRef.current = patternData;
  }, [patternData]);

  useEffect(() => {
    rendererStateRef.current = rendererState;
  }, [rendererState]);

  // Derive remaining counts per color index
  const updateCountsAndCompletion = useCallback(() => {
    const pat = patternDataRef.current;
    const rState = rendererStateRef.current;
    if (!pat || !rState) return;

    const paletteSize = pat.palette.length;
    const totals = new Array(paletteSize).fill(0);
    const completed = new Array(paletteSize).fill(0);
    
    let totalNonEmpty = 0;
    let completedNonEmpty = 0;

    for (let i = 0; i < pat.grid.length; i++) {
      const colorIdx = pat.grid[i];
      if (colorIdx > 0) {
        totals[colorIdx - 1]++;
        totalNonEmpty++;
        
        const x = i % pat.width;
        const y = Math.floor(i / pat.width);
        if (rState.isCompleted(x, y)) {
          completed[colorIdx - 1]++;
          completedNonEmpty++;
        }
      }
    }

    const remaining = totals.map((tot, idx) => Math.max(0, tot - completed[idx]));
    remainingCountsRef.current = remaining;
    totalCellsRef.current = totalNonEmpty;
    completedCellsRef.current = completedNonEmpty;
    setRemainingCounts([...remaining]);
    setTotalCellsCount(totalNonEmpty);
    setCompletedCellsCount(completedNonEmpty);
    setCanUndo(undoStackRef.current.length > 0);

    const isAllDone = remaining.every((count) => count === 0);
    setIsSessionCompleted(isAllDone);
  }, []);

  // Flush loop
  const flushPendingOps = useCallback(async () => {
    const opsToFlush = [...pendingOpsRef.current];
    if (opsToFlush.length === 0) return;
    pendingOpsRef.current = []; // Clear immediately to prevent double flush

    try {
      await insertProgressOpsBatch(opsToFlush);
      // Persist the monotonic sequence high-water mark alongside the ops so it
      // never regresses after sync compaction deletes acknowledged ops.
      await setDeviceSeqHigh(deviceSeqRef.current);
    } catch (err) {
      console.error('Failed to flush progress operations:', err);
      // Prepend them back if insert failed
      pendingOpsRef.current = [...opsToFlush, ...pendingOpsRef.current];
    }
  }, []);

  const flushPendingGameplayEvents = useCallback(async () => {
    const eventsToFlush = [...pendingGameplayEventsRef.current];
    if (eventsToFlush.length === 0) return;
    pendingGameplayEventsRef.current = [];

    try {
      await insertGameplayEventsBatch(eventsToFlush);
      const sess = sessionRef.current;
      if (sess) {
        await setGameplaySeqHigh(sess.id, gameplayClientSeqRef.current);
      }
    } catch (err) {
      console.error('Failed to flush gameplay events to local db:', err);
      pendingGameplayEventsRef.current = [...eventsToFlush, ...pendingGameplayEventsRef.current];
    }
  }, []);

  const flushGameplayEventsToServer = useCallback(async () => {
    if (!remoteSessionIdRef.current || gameplaySyncInFlightRef.current) return;
    gameplaySyncInFlightRef.current = true;
    try {
      await flushPendingGameplayEvents();
      await flushGameplayEvents();
    } catch {
      // Stay queued locally (nothing is deleted from local-db until a 201
      // response); the next sync trigger retries.
    } finally {
      gameplaySyncInFlightRef.current = false;
    }
  }, [flushPendingGameplayEvents]);

  // Push local ops + pull authoritative state for account sessions. Never
  // blocks local play; failures (offline, transient) are swallowed and retried
  // on the next trigger.
  const runSync = useCallback(async () => {
    const sess = sessionRef.current;
    const rState = rendererStateRef.current;
    const remoteSessionId = remoteSessionIdRef.current;
    if (
      !isAccountSessionRef.current ||
      !sess ||
      !rState ||
      !remoteSessionId ||
      syncInFlightRef.current
    ) {
      return;
    }

    syncInFlightRef.current = true;
    try {
      await flushGameplayEventsToServer();
      // Persist buffered ops first so the engine uploads a consistent set.
      await flushPendingOps();

      const completed = rState.getCompletedArray();
      const outcome = await syncSession(
        sess.id,
        remoteSessionId,
        deviceIdRef.current,
        completed,
      );

      serverRevisionRef.current = outcome.serverRevision;

      // Reflect any server-changed cells back into the live renderer state.
      if (outcome.changedCells.length > 0 && sess.status !== 'completed') {
        for (const cellIndex of outcome.changedCells) {
          const x = cellIndex % (patternDataRef.current?.width ?? 1);
          const y = Math.floor(cellIndex / (patternDataRef.current?.width ?? 1));
          rState.setCompleted(x, y, completed[cellIndex] === 1);
          rState.settleCompletedStitch(x, y);
        }
        updateCountsAndCompletion();
        setSyncTick((tick) => tick + 1);
      }

      if (outcome.conflictedCells.length > 0) {
        setHasSyncConflict(true);
      }
    } catch (err) {
      if (err instanceof ProgressSyncError && err.status === 404) {
        // Not an account-owned session server-side; stop trying to sync it.
        isAccountSessionRef.current = false;
      } else if (err instanceof ProgressSyncError && err.code === 'pattern_removed') {
        // Safety Removal deletion instruction: stop syncing, wipe the local
        // Offline Pattern Data, and keep the session unavailable.
        isAccountSessionRef.current = false;
        setPatternRemoved(true);
        if (sess) {
          await updateSessionError(
            sess.id,
            'This Community Pattern was removed by moderation.',
          );
          await deleteOfflinePatternFile(sess.patternId).catch(() => undefined);
        }
      }
      // Otherwise stay silent: local play is unaffected and the next trigger retries.
    } finally {
      syncInFlightRef.current = false;
    }
  }, [flushPendingOps, updateCountsAndCompletion, flushGameplayEventsToServer]);

  // Save checkpoint helper
  const saveSessionCheckpoint = useCallback(async () => {
    const sess = sessionRef.current;
    const rState = rendererStateRef.current;
    if (!sess || !rState) return;

    // 1. Flush any pending operations first
    await flushPendingOps();

    // 2. Save the checkpoint
    const currentRevision = sessionRevisionRef.current;
    const completedArray = rState.getCompletedArray();
    await saveCheckpoint(sess.id, currentRevision, completedArray);
  }, [flushPendingOps]);

  // Load session data
  useEffect(() => {
    if (!sessionId) return;

    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // 1. Init Database
        await initDatabase();

        // 2. Get Device Config
        deviceIdRef.current = await getDeviceId();

        // Continue from the persistent monotonic sequence high-water mark. This
        // survives sync compaction (acked ops are deleted) so device_seq never
        // regresses and collides with a server-side watermark.
        deviceSeqRef.current = await getDeviceSeqHigh();

        if (!sessionId) {
          if (active) setError('Session ID is missing.');
          return;
        }

        // 3. Load Session
        const sess = await getSession(sessionId);
        if (!sess) {
          if (active) setError('Stitching session not found.');
          return;
        }

        gameplayClientSeqRef.current = await getGameplaySeqHigh(sess.id);

        // 4. Update status to active if ready
        if (sess.status === 'ready') {
          await updateSessionStatus(sess.id, 'active');
          sess.status = 'active';
          await captureSessionGameplayEvent(
            'session_started',
            sess.id,
            sess.remoteSessionId,
          );
        }

        // 5. Load Pattern Data. Catalog and personal sessions both download
        // their artifact into the identity namespace during preparation.
        let pat: PatternData;
        if (sess.source === 'bundled') {
          pat = await loadBundledPattern(sess.patternId);
        } else {
          try {
            pat = await loadRemotePatternFromNamespace(
              sess.patternId,
              sess.artifactChecksum,
            );
          } catch (loadErr) {
            if (loadErr instanceof OfflinePatternMissingError) {
              // The .bin file was purged from disk. Re-download it and wait.
              console.warn(
                `Offline pattern file missing for ${sess.patternId}, triggering re-download…`,
              );
              await retryDownload(sess.id);
              const refreshedSess = await waitUntilSessionReady(sess.id);
              // Session status may have changed; update our local reference.
              sess.status = refreshedSess.status;
              pat = await loadRemotePatternFromNamespace(
                sess.patternId,
                sess.artifactChecksum,
              );
            } else {
              throw loadErr;
            }
          }
        }

        // 6. Determine whether this session syncs (Registered Account + linked
        //    remote session) and pick the reload base accordingly.
        const identity = useIdentityStore.getState();
        const isAccountSession = identity.isAccount && !!sess.remoteSessionId;
        isAccountSessionRef.current = isAccountSession;
        remoteSessionIdRef.current = sess.remoteSessionId ?? null;

        const cellsLength = pat.width * pat.height;
        let completed: Uint8Array;

        const snapshot = isAccountSession ? await getSyncSnapshot(sess.id) : null;
        if (snapshot) {
          // Account base: server-authoritative folded snapshot, then this
          // device's not-yet-acknowledged ops replayed on top.
          completed = unpackCompletedBitmap(snapshot.packedBitmap, cellsLength);
          serverRevisionRef.current = snapshot.serverRevision;
          sessionRevisionRef.current = 0;
          const unacked = await getUnackedProgressOps(sess.id);
          for (const op of unacked) {
            if (op.cellIndex >= 0 && op.cellIndex < cellsLength) {
              completed[op.cellIndex] = op.desiredState === 'completed' ? 1 : 0;
            }
          }
        } else {
          // Local base: latest local checkpoint + newer local ops (guest sessions
          // and account sessions that have never synced yet).
          const checkpoint = await getLatestCheckpoint(sess.id);
          let revision = 0;
          if (checkpoint) {
            completed = unpackCompletedBitmap(checkpoint.packedBitmap, cellsLength);
            revision = checkpoint.revision;
          } else {
            completed = new Uint8Array(cellsLength);
          }
          sessionRevisionRef.current = revision;
          const ops = await getProgressOps(sess.id, revision);
          for (const op of ops) {
            if (op.cellIndex >= 0 && op.cellIndex < cellsLength) {
              completed[op.cellIndex] = op.desiredState === 'completed' ? 1 : 0;
              sessionRevisionRef.current++;
            }
          }
        }

        // 8. Rebuild device undo stack
        const allOps = await getProgressOps(sess.id, 0);
        const undoStack: number[] = [];
        for (const op of allOps) {
          if (op.deviceId === deviceIdRef.current) {
            if (op.desiredState === 'completed') {
              undoStack.push(op.cellIndex);
            } else {
              const idx = undoStack.lastIndexOf(op.cellIndex);
              if (idx !== -1) {
                undoStack.splice(idx, 1);
              }
            }
          }
        }
        undoStackRef.current = undoStack;

        // 9. Instantiate Renderer State
        const rState = new RendererState(pat.width, pat.height, completed);

        if (active) {
          setSession(sess);
          setPatternData(pat);
          setRendererState(rState);

          // Force refs sync for immediate layout/render
          patternDataRef.current = pat;
          rendererStateRef.current = rState;

          updateCountsAndCompletion();
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to load stitching session:', err);
        if (active) {
          setError(err instanceof Error ? err.message : 'Unknown error during session setup.');
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [sessionId, updateCountsAndCompletion]);

  // Periodic flush timer (500 ms)
  useEffect(() => {
    const timer = setInterval(() => {
      flushPendingOps();
      flushPendingGameplayEvents();
      void flushGameplayEventsToServer();
    }, 500);

    return () => {
      clearInterval(timer);
    };
  }, [flushPendingOps, flushPendingGameplayEvents, flushGameplayEventsToServer]);

  // Opportunistic progress-sync loop (account sessions only; runSync self-gates).
  // Gameplay Events are flushed independently above for any prepared remote
  // session, including a Guest's server-authoritative Ledger.
  useEffect(() => {
    if (loading) return;
    runSync();
    const timer = setInterval(() => {
      runSync();
    }, 4000);
    return () => {
      clearInterval(timer);
    };
  }, [loading, runSync]);

  // AppState listening to flush, checkpoint & sync on background
  useEffect(() => {
    const handleAppStateChange = (nextStatus: AppStateStatus) => {
      if (nextStatus === 'background' || nextStatus === 'inactive') {
        saveSessionCheckpoint();
        runSync();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [saveSessionCheckpoint, runSync]);

  // Flush and save checkpoint on unmount
  useEffect(() => {
    return () => {
      saveSessionCheckpoint();
    };
  }, [saveSessionCheckpoint]);

  // Stitch cell action
  const stitchCell = useCallback((x: number, y: number, activeColorIndex: number): boolean => {
    const sess = sessionRef.current;
    const pat = patternDataRef.current;
    const rState = rendererStateRef.current;

    if (!sess || !pat || !rState || sess.status === 'completed') return false;

    const cellIndex = y * pat.width + x;
    const colorIdx = pat.grid[cellIndex];

    // Check if cell is matching the active thread color index
    if (colorIdx > 0 && colorIdx - 1 === activeColorIndex) {
      if (rState.isCompleted(x, y)) {
        return true; // Already done
      }

      // Update renderer state immediately (same frame)
      rState.setCompleted(x, y, true);

      // Increment sequence & revision
      deviceSeqRef.current++;
      const baseRev = sessionRevisionRef.current;
      sessionRevisionRef.current++;

      // Create ProgressOperation
      const op: ProgressOperation = {
        opId: generateUUID(),
        sessionId: sess.id,
        deviceId: deviceIdRef.current,
        deviceSeq: deviceSeqRef.current,
        cellIndex,
        desiredState: 'completed',
        baseRevision: baseRev,
        serverBaseRevision: serverRevisionRef.current,
        createdAt: new Date().toISOString(),
      };

      // Push to in-memory buffers
      pendingOpsRef.current.push(op);
      undoStackRef.current.push(cellIndex);

      // O(1) incremental counters — no grid scan on the stitch path
      remainingCountsRef.current[colorIdx - 1]--;
      if (remainingCountsRef.current[colorIdx - 1] === 0) {
        void emitTutorialEvent({ type: 'thread_color_completed', dmcCode: pat.palette[activeColorIndex].dmcCode });
      }

      const remoteSessionId = remoteSessionIdRef.current;
      if (remoteSessionId) {
        const dmcCode = pat.palette[activeColorIndex].dmcCode;
        const occurredAt = new Date().toISOString();

        gameplayClientSeqRef.current++;
        pendingGameplayEventsRef.current.push({
          eventId: generateUUID(),
          sessionId: remoteSessionId,
          kind: 'stitch_action',
          dmcCode,
          clientSeq: gameplayClientSeqRef.current,
          occurredAt,
        });

        if (remainingCountsRef.current[colorIdx - 1] === 0) {
          gameplayClientSeqRef.current++;
          pendingGameplayEventsRef.current.push({
            eventId: generateUUID(),
            sessionId: remoteSessionId,
            kind: 'color_completion',
            dmcCode,
            clientSeq: gameplayClientSeqRef.current,
            occurredAt,
          });
        }
      }

      completedCellsRef.current++;
      setRemainingCounts([...remainingCountsRef.current]);
      setCompletedCellsCount(completedCellsRef.current);
      setCanUndo(true);

      const isAllDone = completedCellsRef.current === totalCellsRef.current;
      if (isAllDone) {
        // Complete the session
        const ts = new Date().toISOString();
        setSession((prev) => prev ? { ...prev, status: 'completed', completedAt: ts } : null);
        setIsSessionCompleted(true);

        // Async write completion checkpoint, then finalize server-side.
        (async () => {
          await updateSessionStatus(sess.id, 'completed', ts);
          await captureSessionGameplayEvent(
            'session_completed',
            sess.id,
            remoteSessionIdRef.current,
          );
          await saveSessionCheckpoint();
          if (isAccountSessionRef.current && remoteSessionIdRef.current) {
            await runSync();
            try {
              await completeSession(
                remoteSessionIdRef.current,
                deviceIdRef.current,
              );
            } catch {
              // Server may still be catching up on the final ops; the next sync
              // retries completion. Local completion already stands.
            }
          }
        })();
      } else {
        // Trigger flush if buffer gets large
        if (pendingOpsRef.current.length >= 50) {
          flushPendingOps();
        }
      }

      return true;
    }

    return false; // Mismatched cell
  }, [flushPendingOps, saveSessionCheckpoint, runSync]);

  // Undo action
  const undo = useCallback((): { x: number; y: number } | null => {
    const sess = sessionRef.current;
    const pat = patternDataRef.current;
    const rState = rendererStateRef.current;

    if (!sess || !pat || !rState || sess.status === 'completed' || undoStackRef.current.length === 0) {
      return null;
    }

    // Pop from local device undo stack
    const cellIndex = undoStackRef.current.pop();
    if (cellIndex === undefined) return null;

    const x = cellIndex % pat.width;
    const y = Math.floor(cellIndex / pat.width);

    // Update in-memory state
    rState.setCompleted(x, y, false);

    // Increment seq & revision
    deviceSeqRef.current++;
    const baseRev = sessionRevisionRef.current;
    sessionRevisionRef.current++;

    // Record an incomplete Progress Operation
    const op: ProgressOperation = {
      opId: generateUUID(),
      sessionId: sess.id,
      deviceId: deviceIdRef.current,
      deviceSeq: deviceSeqRef.current,
      cellIndex,
      desiredState: 'incomplete',
      baseRevision: baseRev,
      serverBaseRevision: serverRevisionRef.current,
      createdAt: new Date().toISOString(),
    };

    pendingOpsRef.current.push(op);

    // O(1) incremental counters — no grid scan on the undo path
    const colorIdx = pat.grid[cellIndex];
    if (colorIdx > 0) {
      remainingCountsRef.current[colorIdx - 1]++;
      completedCellsRef.current--;
    }
    setRemainingCounts([...remainingCountsRef.current]);
    setCompletedCellsCount(completedCellsRef.current);
    setCanUndo(undoStackRef.current.length > 0);

    if (pendingOpsRef.current.length >= 50) {
      flushPendingOps();
    }

    return { x, y };
  }, [flushPendingOps]);

  return {
    loading,
    error,
    session,
    patternData,
    rendererState,
    remainingCounts,
    isSessionCompleted,
    canUndo,
    totalCellsCount,
    completedCellsCount,
    stitchCell,
    undo,
    flushPendingOps,
    hasSyncConflict,
    dismissSyncConflict: () => setHasSyncConflict(false),
    syncTick,
    patternRemoved,
  };
}

class OfflinePatternMissingError extends Error {
  constructor(readonly path: string) {
    super(`Offline pattern file not found: ${path}`);
    this.name = 'OfflinePatternMissingError';
  }
}

// Ready catalog and personal sessions read their verified Offline Pattern
// Data from the identity namespace; the decoder re-verifies the stored
// checksum on open.
async function loadRemotePatternFromNamespace(
  patternId: string,
  checksum: string,
) {
  const identity = getActiveIdentity();
  const path = getOfflinePatternPath(patternId, identity);

  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    throw new OfflinePatternMissingError(path);
  }

  const base64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return decodePatternArtifact(base64ToUint8Array(base64), checksum);
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
