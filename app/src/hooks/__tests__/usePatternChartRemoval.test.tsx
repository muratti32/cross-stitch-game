import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { captureLocalPersistenceError } from '../../observability/sentry';
import { deleteOfflinePatternFile } from '../../session-preparation';
import { usePatternChartRemoval } from '../usePatternChartRemoval';

jest.mock('../../observability/sentry', () => ({ captureLocalPersistenceError: jest.fn() }));
jest.mock('../../session-preparation', () => ({ deleteOfflinePatternFile: jest.fn() }));

const remove = deleteOfflinePatternFile as jest.MockedFunction<typeof deleteOfflinePatternFile>;

function Harness({ removed }: { removed: boolean }) {
  usePatternChartRemoval('p', removed);
  return null;
}

describe('usePatternChartRemoval', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the on-device copy once removed', async () => {
    remove.mockResolvedValue(undefined);
    await act(async () => { TestRenderer.create(<Harness removed />); });
    expect(remove).toHaveBeenCalledWith('p');
    expect(captureLocalPersistenceError).not.toHaveBeenCalled();
  });

  it('does nothing while the pattern is not removed', async () => {
    await act(async () => { TestRenderer.create(<Harness removed={false} />); });
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports a failed delete instead of swallowing it', async () => {
    const failure = new Error('disk');
    remove.mockRejectedValue(failure);
    await act(async () => { TestRenderer.create(<Harness removed />); });
    expect(captureLocalPersistenceError).toHaveBeenCalledWith('delete-removed-pattern-file', failure);
  });
});
