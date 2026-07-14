import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  initDatabase,
  getDatabase,
  getSession,
  getProgressOps,
  getLatestCheckpoint,
  getDeviceId,
  insertProgressOpsBatch,
  saveCheckpoint,
  updateSessionStatus,
  unpackCompletedBitmap,
  ProgressOperation,
  StitchingSession,
} from '../local-db';
import * as FileSystem from 'expo-file-system/legacy';

import { loadBundledPattern } from '../bundled-patterns';
import {
  base64ToUint8Array,
  getOfflinePatternPath,
} from '../session-preparation';
import { decodePatternArtifact } from '../pattern-artifact';
import { getActiveIdentity } from '../local-db';
import { PatternData } from '../pattern-artifact';
import { RendererState } from '../renderer';

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

  // Keep references to avoid stale closures in flusher and timer loops
  const deviceIdRef = useRef<string>('');
  const deviceSeqRef = useRef<number>(0);
  const sessionRevisionRef = useRef<number>(0);
  const pendingOpsRef = useRef<ProgressOperation[]>([]);
  const undoStackRef = useRef<number[]>([]);
  
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
    } catch (err) {
      console.error('Failed to flush progress operations:', err);
      // Prepend them back if insert failed
      pendingOpsRef.current = [...opsToFlush, ...pendingOpsRef.current];
    }
  }, []);

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
        
        // Find highest sequence from progress ops database to continue monotonically
        const db = await getDatabase();
        const maxSeqRow = await db.getFirstAsync<{ max_seq: number | null }>(
          "SELECT MAX(device_seq) as max_seq FROM progress_ops"
        );
        deviceSeqRef.current = maxSeqRow?.max_seq ?? 0;

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

        // 4. Update status to active if ready
        if (sess.status === 'ready') {
          await updateSessionStatus(sess.id, 'active');
          sess.status = 'active';
        }

        // 5. Load Pattern Data
        const pat =
          sess.source === 'catalog'
            ? await loadCatalogPatternFromNamespace(
                sess.patternId,
                sess.artifactChecksum,
              )
            : await loadBundledPattern(sess.patternId);

        // 6. Load Latest Checkpoint
        const checkpoint = await getLatestCheckpoint(sess.id);
        const cellsLength = pat.width * pat.height;
        let completed: Uint8Array;
        let revision = 0;

        if (checkpoint) {
          completed = unpackCompletedBitmap(checkpoint.packedBitmap, cellsLength);
          revision = checkpoint.revision;
        } else {
          completed = new Uint8Array(cellsLength);
        }

        sessionRevisionRef.current = revision;

        // 7. Load and Replay newer operations
        const ops = await getProgressOps(sess.id, revision);
        for (const op of ops) {
          if (op.cellIndex >= 0 && op.cellIndex < cellsLength) {
            completed[op.cellIndex] = op.desiredState === 'completed' ? 1 : 0;
            sessionRevisionRef.current++;
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
    }, 500);

    return () => {
      clearInterval(timer);
    };
  }, [flushPendingOps]);

  // AppState listening to flush & checkpoint on background
  useEffect(() => {
    const handleAppStateChange = (nextStatus: AppStateStatus) => {
      if (nextStatus === 'background' || nextStatus === 'inactive') {
        saveSessionCheckpoint();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [saveSessionCheckpoint]);

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
        createdAt: new Date().toISOString(),
      };

      // Push to in-memory buffers
      pendingOpsRef.current.push(op);
      undoStackRef.current.push(cellIndex);

      // O(1) incremental counters — no grid scan on the stitch path
      remainingCountsRef.current[colorIdx - 1]--;
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

        // Async write completion checkpoint
        (async () => {
          await updateSessionStatus(sess.id, 'completed', ts);
          await saveSessionCheckpoint();
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
  }, [flushPendingOps, saveSessionCheckpoint]);

  // Undo action
  const undo = useCallback((): boolean => {
    const sess = sessionRef.current;
    const pat = patternDataRef.current;
    const rState = rendererStateRef.current;

    if (!sess || !pat || !rState || sess.status === 'completed' || undoStackRef.current.length === 0) {
      return false;
    }

    // Pop from local device undo stack
    const cellIndex = undoStackRef.current.pop();
    if (cellIndex === undefined) return false;

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

    return true;
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
  };
}

// Ready catalog sessions read their verified Offline Pattern Data from the
// identity namespace; the decoder re-verifies the stored checksum on open.
async function loadCatalogPatternFromNamespace(
  patternId: string,
  checksum: string,
) {
  const identity = getActiveIdentity();
  const path = getOfflinePatternPath(patternId, identity);
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
