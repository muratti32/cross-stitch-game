import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useKeyedAsync } from '../useKeyedAsync';

let seen: string | null | undefined;

function Harness({ k, load }: { k: string | undefined; load: (key: string) => Promise<string | null> }) {
  seen = useKeyedAsync(k, load, null);
  return null;
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe('useKeyedAsync', () => {
  it('is undefined while loading, then the loaded value for the key', async () => {
    const load = jest.fn().mockResolvedValue('a-value');
    await act(async () => { TestRenderer.create(<Harness k="a" load={load} />); });
    expect(load).toHaveBeenCalledWith('a');
    expect(seen).toBe('a-value');
  });

  it('settles to the fallback when the load rejects', async () => {
    await act(async () => { TestRenderer.create(<Harness k="a" load={() => Promise.reject(new Error('x'))} />); });
    expect(seen).toBeNull();
  });

  it('does nothing without a key', async () => {
    const load = jest.fn();
    await act(async () => { TestRenderer.create(<Harness k={undefined} load={load} />); });
    expect(load).not.toHaveBeenCalled();
    expect(seen).toBeUndefined();
  });

  it('never returns a previous key\'s value and ignores a stale response', async () => {
    let resolveA!: (v: string) => void;
    const load = jest.fn((key: string) => key === 'a'
      ? new Promise<string>((res) => { resolveA = res; })
      : Promise.resolve('b-value'));
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<Harness k="a" load={load} />); });
    await act(async () => { r.update(<Harness k="b" load={load} />); });
    await flush();
    expect(seen).toBe('b-value');
    await act(async () => { resolveA('a-value'); });
    expect(seen).toBe('b-value');
  });
});
