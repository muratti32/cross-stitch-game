import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { PromotionFlowSnapshot, PromotionRunner } from '../promotionRunner';
import { usePromotionSessionsRefresh } from '../usePromotionSessionsRefresh';
import { captured } from './fixtures';

jest.mock('../promotionRuntime', () => ({ promotionRunner: {} }));

function fakeRunner(initial: PromotionFlowSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const runner = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as PromotionRunner;
  const publish = (next: PromotionFlowSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return { runner, publish };
}

function Probe({ reload, runner }: { reload: () => void; runner: PromotionRunner }) {
  usePromotionSessionsRefresh(reload, runner);
  return null;
}

describe('usePromotionSessionsRefresh', () => {
  test('reloads when the handoff changes or finishes, and not on mount or on a failure alone', () => {
    const handoff = captured();
    const { runner, publish } = fakeRunner({ handoff, failure: null });
    const reload = jest.fn();
    act(() => {
      TestRenderer.create(<Probe reload={reload} runner={runner} />);
    });
    expect(reload).not.toHaveBeenCalled();

    act(() => publish({ handoff, failure: { kind: 'network' } as never }));
    expect(reload).not.toHaveBeenCalled();

    act(() => publish({ handoff: captured(), failure: null }));
    expect(reload).toHaveBeenCalledTimes(1);

    act(() => publish({ handoff: null, failure: null }));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test('stops listening on unmount', () => {
    const { runner, publish } = fakeRunner({ handoff: captured(), failure: null });
    const reload = jest.fn();
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<Probe reload={reload} runner={runner} />);
    });

    act(() => tree?.unmount());
    publish({ handoff: null, failure: null });

    expect(reload).not.toHaveBeenCalled();
  });
});
