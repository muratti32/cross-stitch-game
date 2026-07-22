import { flushGameplayEvents } from '../gameplayEventEngine';
import * as localDb from '../../local-db';
import * as api from '../../api/dailyTasks';

jest.mock('../../local-db', () => ({
  getUnackedGameplayEvents: jest.fn(),
  markGameplayEventsAcked: jest.fn(),
}));

jest.mock('../../api/dailyTasks', () => ({
  postGameplayEvents: jest.fn(),
}));

const mockedDb = localDb as jest.Mocked<typeof localDb>;
const mockedApi = api as jest.Mocked<typeof api>;

describe('flushGameplayEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('flushes a single batch under 500 and marks them acked', async () => {
    const mockEvents = [
      {
        eventId: 'e1',
        sessionId: 's1',
        kind: 'stitch_action' as const,
        dmcCode: '310',
        clientSeq: 1,
        occurredAt: '2026-07-22T10:41:52Z',
      },
      {
        eventId: 'e2',
        sessionId: 's1',
        kind: 'color_completion' as const,
        dmcCode: '310',
        clientSeq: 2,
        occurredAt: '2026-07-22T10:41:53Z',
      },
    ];

    mockedDb.getUnackedGameplayEvents.mockResolvedValueOnce(mockEvents);
    mockedApi.postGameplayEvents.mockResolvedValueOnce(undefined);
    mockedDb.markGameplayEventsAcked.mockResolvedValueOnce(undefined);

    await flushGameplayEvents();

    expect(mockedDb.getUnackedGameplayEvents).toHaveBeenCalledWith(500);
    expect(mockedApi.postGameplayEvents).toHaveBeenCalledWith(
      mockEvents.map((e) => ({
        eventId: e.eventId,
        kind: e.kind,
        sessionId: e.sessionId,
        dmcCode: e.dmcCode,
        clientSeq: e.clientSeq,
        occurredAt: e.occurredAt,
      })),
    );
    expect(mockedDb.markGameplayEventsAcked).toHaveBeenCalledWith(['e1', 'e2']);
    expect(mockedDb.getUnackedGameplayEvents).toHaveBeenCalledTimes(1);
  });

  it('loops and flushes a second batch when the first batch returned exactly 500 items', async () => {
    const batch1 = Array.from({ length: 500 }, (_, i) => ({
      eventId: `e${i}`,
      sessionId: 's1',
      kind: 'stitch_action' as const,
      dmcCode: '310',
      clientSeq: i + 1,
      occurredAt: '2026-07-22T10:41:52Z',
    }));

    const batch2 = [
      {
        eventId: 'e500',
        sessionId: 's1',
        kind: 'color_completion' as const,
        dmcCode: '310',
        clientSeq: 501,
        occurredAt: '2026-07-22T10:41:53Z',
      },
    ];

    mockedDb.getUnackedGameplayEvents
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2);

    mockedApi.postGameplayEvents
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    mockedDb.markGameplayEventsAcked
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await flushGameplayEvents();

    expect(mockedDb.getUnackedGameplayEvents).toHaveBeenCalledTimes(2);
    expect(mockedApi.postGameplayEvents).toHaveBeenCalledTimes(2);
    expect(mockedDb.markGameplayEventsAcked).toHaveBeenCalledTimes(2);

    expect(mockedDb.markGameplayEventsAcked).toHaveBeenNthCalledWith(
      1,
      batch1.map((e) => e.eventId),
    );
    expect(mockedDb.markGameplayEventsAcked).toHaveBeenNthCalledWith(
      2,
      batch2.map((e) => e.eventId),
    );
  });

  it('does not call markGameplayEventsAcked or loop again when postGameplayEvents rejects', async () => {
    const mockEvents = [
      {
        eventId: 'e1',
        sessionId: 's1',
        kind: 'stitch_action' as const,
        dmcCode: '310',
        clientSeq: 1,
        occurredAt: '2026-07-22T10:41:52Z',
      },
    ];

    const error = new Error('Network error');
    mockedDb.getUnackedGameplayEvents.mockResolvedValueOnce(mockEvents);
    mockedApi.postGameplayEvents.mockRejectedValueOnce(error);

    await expect(flushGameplayEvents()).rejects.toThrow(error);

    expect(mockedDb.getUnackedGameplayEvents).toHaveBeenCalledTimes(1);
    expect(mockedApi.postGameplayEvents).toHaveBeenCalledTimes(1);
    expect(mockedDb.markGameplayEventsAcked).not.toHaveBeenCalled();
  });
});
