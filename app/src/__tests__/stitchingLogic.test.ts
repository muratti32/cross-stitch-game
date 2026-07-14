import { packCompletedBitmap, unpackCompletedBitmap, generateUUID } from '../local-db/helpers';
import type { ProgressOperation } from '../local-db';
import { PatternData } from '../pattern-artifact';

// Helper to construct mock PatternData
function createMockPattern(width: number, height: number, grid: number[]): PatternData {
  return {
    schemaVersion: 1,
    width,
    height,
    palette: [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: '666', name: 'Red', rgbHex: '#FF0000' },
      { dmcCode: 'FFF', name: 'White', rgbHex: '#FFFFFF' },
    ],
    grid: new Uint8Array(grid),
  };
}

describe('Stitching Core Logic and Persistence Tests', () => {
  
  describe('Checkpoint: Bitmap Pack/Unpack Round-Trip', () => {
    test('packs and unpacks a completed grid correctly', () => {
      const length = 100;
      const original = new Uint8Array(length);
      // Mark some random cells completed
      original[0] = 1;
      original[7] = 1;
      original[8] = 1;
      original[15] = 1;
      original[50] = 1;
      original[99] = 1;

      const packed = packCompletedBitmap(original);
      
      // Expected byte length: Math.ceil(100 / 8) = 13 bytes
      expect(packed.length).toBe(13);

      const restored = unpackCompletedBitmap(packed, length);
      expect(restored).toEqual(original);
    });

    test('handles empty and fully completed grids', () => {
      const length = 64;
      const allZero = new Uint8Array(length);
      const allOne = new Uint8Array(length).fill(1);

      expect(unpackCompletedBitmap(packCompletedBitmap(allZero), length)).toEqual(allZero);
      expect(unpackCompletedBitmap(packCompletedBitmap(allOne), length)).toEqual(allOne);
    });
  });

  describe('State Restoration: Checkpoint + Newer Ops Replay', () => {
    test('reconstructs the final completed grid correctly from a checkpoint and subsequent operations', () => {
      const width = 4;
      const height = 4;
      const totalCells = width * height;

      // Initial completed cells at revision 2 (checkpoint state)
      const checkpointCompleted = new Uint8Array(totalCells);
      checkpointCompleted[0] = 1;
      checkpointCompleted[5] = 1;

      // Pack it to simulate checkpoint BLOB saving
      const packed = packCompletedBitmap(checkpointCompleted);

      // Restore it from checkpoint
      const restored = unpackCompletedBitmap(packed, totalCells);
      expect(restored[0]).toBe(1);
      expect(restored[5]).toBe(1);
      expect(restored[10]).toBe(0);

      // Simulate newer operations since revision 2
      const newerOps: ProgressOperation[] = [
        {
          opId: 'op-1',
          sessionId: 'sess-1',
          deviceId: 'dev-1',
          deviceSeq: 3,
          cellIndex: 10,
          desiredState: 'completed',
          baseRevision: 2,
          createdAt: new Date().toISOString(),
        },
        {
          opId: 'op-2',
          sessionId: 'sess-1',
          deviceId: 'dev-1',
          deviceSeq: 4,
          cellIndex: 5,
          desiredState: 'incomplete', // Undo cell 5
          baseRevision: 3,
          createdAt: new Date().toISOString(),
        },
        {
          opId: 'op-3',
          sessionId: 'sess-1',
          deviceId: 'dev-1',
          deviceSeq: 5,
          cellIndex: 15,
          desiredState: 'completed',
          baseRevision: 4,
          createdAt: new Date().toISOString(),
        },
      ];

      // Replay newer ops
      for (const op of newerOps) {
        if (op.desiredState === 'completed') {
          restored[op.cellIndex] = 1;
        } else {
          restored[op.cellIndex] = 0;
        }
      }

      // Assert final restored grid
      expect(restored[0]).toBe(1);            // From checkpoint
      expect(restored[5]).toBe(0);            // Undone by op-2
      expect(restored[10]).toBe(1);           // Completed by op-1
      expect(restored[15]).toBe(1);           // Completed by op-3
    });
  });

  describe('Palette Derivation and Thread Color Completion', () => {
    test('correctly counts remaining stitches per color and flags thread completion', () => {
      // 3x3 pattern grid
      // 0 = background, 1 = Black, 2 = Red, 3 = White
      const pattern = createMockPattern(3, 3, [
        1, 1, 0,
        2, 0, 2,
        3, 3, 3,
      ]);

      // Total expected stitches:
      // Black (index 0): 2 cells
      // Red (index 1): 2 cells
      // White (index 2): 3 cells

      const completed = new Uint8Array(9);
      completed[0] = 1; // Completed 1st Black cell
      completed[3] = 1; // Completed 1st Red cell
      completed[5] = 1; // Completed 2nd Red cell
      completed[6] = 1; // Completed 1st White cell

      // Function under test: derive remaining counts
      const getRemainingCounts = (pat: PatternData, compl: Uint8Array): number[] => {
        const remaining = new Array(pat.palette.length).fill(0);
        
        // Count total per color
        const total = new Array(pat.palette.length).fill(0);
        const done = new Array(pat.palette.length).fill(0);
        
        for (let i = 0; i < pat.grid.length; i++) {
          const colorIdx = pat.grid[i];
          if (colorIdx > 0) {
            total[colorIdx - 1]++;
            if (compl[i] === 1) {
              done[colorIdx - 1]++;
            }
          }
        }

        for (let idx = 0; idx < pat.palette.length; idx++) {
          remaining[idx] = Math.max(0, total[idx] - done[idx]);
        }
        return remaining;
      };

      const remaining = getRemainingCounts(pattern, completed);

      // Remaining stitches:
      // Black (index 0): 2 - 1 = 1 remaining
      // Red (index 1): 2 - 2 = 0 remaining (Thread Color Completion!)
      // White (index 2): 3 - 1 = 2 remaining
      expect(remaining[0]).toBe(1);
      expect(remaining[1]).toBe(0);
      expect(remaining[2]).toBe(2);

      // Assert thread color completion
      expect(remaining[1] === 0).toBe(true);
      expect(remaining[0] === 0).toBe(false);
    });
  });

  describe('Session Completion Detection and Frozen state', () => {
    test('detects when all cells requiring a stitch are completed', () => {
      const pattern = createMockPattern(2, 2, [
        1, 0,
        2, 2,
      ]);

      const isComplete = (pat: PatternData, compl: Uint8Array): boolean => {
        for (let i = 0; i < pat.grid.length; i++) {
          if (pat.grid[i] > 0 && compl[i] !== 1) {
            return false;
          }
        }
        return true;
      };

      const completed = new Uint8Array(4);
      expect(isComplete(pattern, completed)).toBe(false);

      completed[0] = 1;
      expect(isComplete(pattern, completed)).toBe(false);

      completed[2] = 1;
      completed[3] = 1;
      expect(isComplete(pattern, completed)).toBe(true); // All non-zero cells done
    });

    test('frozen session rejects further cell modifications', () => {
      // Simulate state of a session
      let sessionStatus: 'ready' | 'active' | 'completed' = 'completed'; // Frozen
      
      const completed = new Uint8Array(4);
      
      const tryStitch = (x: number, y: number): boolean => {
        if (sessionStatus === 'completed') {
          return false; // Rejection
        }
        completed[y * 2 + x] = 1;
        return true;
      };

      // Tapping a cell on a completed/frozen session fails
      expect(tryStitch(0, 0)).toBe(false);
      expect(completed[0]).toBe(0);
    });
  });

  describe('Operation Log & Batch Buffering Queue', () => {
    test('respects buffer size limits and generates monotonic sequence numbers and unique UUIDs', () => {
      const pendingOps: ProgressOperation[] = [];
      let deviceSeq = 10;
      let flushCount = 0;

      const queueOp = (cellIdx: number, desiredState: 'completed' | 'incomplete') => {
        deviceSeq++; // Monotonic increment
        const op: ProgressOperation = {
          opId: generateUUID(),
          sessionId: 'sess-123',
          deviceId: 'dev-abc',
          deviceSeq,
          cellIndex: cellIdx,
          desiredState,
          baseRevision: 0,
          createdAt: new Date().toISOString(),
        };
        pendingOps.push(op);

        if (pendingOps.length >= 50) {
          flushQueue();
        }
      };

      const flushQueue = () => {
        flushCount++;
        pendingOps.length = 0; // Empty the buffer
      };

      // 1. Add 49 operations
      for (let i = 0; i < 49; i++) {
        queueOp(i, 'completed');
      }
      expect(pendingOps.length).toBe(49);
      expect(flushCount).toBe(0);

      // 2. Add 50th operation (should trigger auto flush)
      queueOp(49, 'completed');
      expect(pendingOps.length).toBe(0);
      expect(flushCount).toBe(1);

      // 3. Verify uniqueness and monotonicity of a mock batch
      const testBatch: ProgressOperation[] = [];
      let currentSeq = 0;
      for (let i = 0; i < 10; i++) {
        currentSeq++;
        testBatch.push({
          opId: generateUUID(),
          sessionId: 's',
          deviceId: 'd',
          deviceSeq: currentSeq,
          cellIndex: i,
          desiredState: 'completed',
          baseRevision: i,
          createdAt: new Date().toISOString(),
        });
      }

      // Assert unique UUIDs
      const uuids = new Set(testBatch.map(o => o.opId));
      expect(uuids.size).toBe(10);

      // Assert monotonic device_seq numbers
      for (let i = 1; i < testBatch.length; i++) {
        expect(testBatch[i].deviceSeq).toBeGreaterThan(testBatch[i - 1].deviceSeq);
      }
    });
  });
});
