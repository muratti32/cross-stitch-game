import { applyResolvedOperations, ResolvedOperation } from '../syncApply';

describe('applyResolvedOperations', () => {
  it('applies resolved states in server_revision order regardless of input order', () => {
    const completed = new Uint8Array(4);
    const ops: ResolvedOperation[] = [
      { cellIndex: 0, resolvedState: 'completed', serverRevision: 3 },
      { cellIndex: 0, resolvedState: 'incomplete', serverRevision: 1 },
      { cellIndex: 1, resolvedState: 'completed', serverRevision: 2 },
    ];

    const result = applyResolvedOperations(completed, ops, 0);

    // Cell 0: incomplete@1 then completed@3 -> completed (1). Cell 1 -> completed.
    expect(Array.from(result.completed)).toEqual([1, 1, 0, 0]);
    expect(result.serverRevision).toBe(3);
  });

  it('corrects the client optimistic op (server completed-wins over local incomplete)', () => {
    // Client optimistically marked cell 2 incomplete; server resolved completed.
    const completed = new Uint8Array([0, 0, 0]);
    const ops: ResolvedOperation[] = [
      { cellIndex: 2, resolvedState: 'completed', serverRevision: 5 },
    ];

    const result = applyResolvedOperations(completed, ops, 4);

    expect(result.completed[2]).toBe(1);
    expect(result.changedCells).toEqual([2]);
    expect(result.serverRevision).toBe(5);
  });

  it('keeps the watermark and reports no changes when there are no operations', () => {
    const completed = new Uint8Array([1, 0]);
    const result = applyResolvedOperations(completed, [], 7);
    expect(result.serverRevision).toBe(7);
    expect(result.changedCells).toEqual([]);
    expect(Array.from(result.completed)).toEqual([1, 0]);
  });

  it('ignores out-of-range cell indexes but still advances the watermark', () => {
    const completed = new Uint8Array(2);
    const ops: ResolvedOperation[] = [
      { cellIndex: 9, resolvedState: 'completed', serverRevision: 8 },
    ];
    const result = applyResolvedOperations(completed, ops, 0);
    expect(Array.from(result.completed)).toEqual([0, 0]);
    expect(result.serverRevision).toBe(8);
    expect(result.changedCells).toEqual([]);
  });

  it('does not report an unchanged cell as changed', () => {
    const completed = new Uint8Array([1]);
    const ops: ResolvedOperation[] = [
      { cellIndex: 0, resolvedState: 'completed', serverRevision: 2 },
    ];
    const result = applyResolvedOperations(completed, ops, 1);
    expect(result.changedCells).toEqual([]);
  });
});
