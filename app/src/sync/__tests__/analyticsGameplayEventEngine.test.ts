import { flushAnalyticsGameplayEvents } from '../analyticsGameplayEventEngine';
import * as localDb from '../../local-db';
import * as api from '../../api/gameplayEvents';

jest.mock('../../local-db', () => ({
  getUnackedAnalyticsGameplayEvents: jest.fn(),
  markAnalyticsGameplayEventsAcked: jest.fn(),
}));

// GameplayEventSyncError stays real: the engine branches on it to tell a
// permanent rejection from a transient one.
jest.mock('../../api/gameplayEvents', () => ({
  ...jest.requireActual<typeof import('../../api/gameplayEvents')>(
    '../../api/gameplayEvents',
  ),
  postAnalyticsGameplayEvents: jest.fn(),
}));

const mockedDb = localDb as jest.Mocked<typeof localDb>;
const mockedApi = api as jest.Mocked<typeof api>;

const event = {
  eventId: '72bb19f7-e78e-4b72-bc75-d761122a25df',
  occurredAt: '2026-07-25T10:00:00.000Z',
  kind: 'session_started' as const,
  payload: { session_id: '0b5fe1ce-5f79-4c80-aa32-5ca9e67b8dd5' },
};

describe('flushAnalyticsGameplayEvents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps an offline batch queued and reuses its persisted id after reconnect', async () => {
    mockedDb.getUnackedAnalyticsGameplayEvents.mockResolvedValue([event]);
    mockedApi.postAnalyticsGameplayEvents.mockRejectedValueOnce(new Error('offline'));

    await expect(flushAnalyticsGameplayEvents()).rejects.toThrow('offline');
    expect(mockedDb.markAnalyticsGameplayEventsAcked).not.toHaveBeenCalled();

    mockedApi.postAnalyticsGameplayEvents.mockResolvedValueOnce(undefined);
    await flushAnalyticsGameplayEvents();

    expect(mockedApi.postAnalyticsGameplayEvents).toHaveBeenLastCalledWith([event]);
    expect(mockedDb.markAnalyticsGameplayEventsAcked).toHaveBeenCalledWith([event.eventId]);
  });

  it('reads a persisted batch after restart and prunes only after acceptance', async () => {
    mockedDb.getUnackedAnalyticsGameplayEvents.mockResolvedValue([event]);
    mockedApi.postAnalyticsGameplayEvents.mockResolvedValueOnce(undefined);

    await flushAnalyticsGameplayEvents();

    expect(mockedDb.getUnackedAnalyticsGameplayEvents).toHaveBeenCalledWith(500);
    expect(mockedDb.markAnalyticsGameplayEventsAcked).toHaveBeenCalledWith([event.eventId]);
  });

  it('drops a batch the backend permanently rejects so it cannot block the queue', async () => {
    mockedDb.getUnackedAnalyticsGameplayEvents.mockResolvedValue([event]);
    mockedApi.postAnalyticsGameplayEvents.mockRejectedValueOnce(
      new api.GameplayEventSyncError(400),
    );

    await expect(flushAnalyticsGameplayEvents()).resolves.toBeUndefined();
    expect(mockedDb.markAnalyticsGameplayEventsAcked).toHaveBeenCalledWith([
      event.eventId,
    ]);
  });

  it('keeps a batch queued when the rejection could succeed later', async () => {
    mockedDb.getUnackedAnalyticsGameplayEvents.mockResolvedValue([event]);
    mockedApi.postAnalyticsGameplayEvents.mockRejectedValueOnce(
      new api.GameplayEventSyncError(503),
    );

    await expect(flushAnalyticsGameplayEvents()).rejects.toBeInstanceOf(
      api.GameplayEventSyncError,
    );
    expect(mockedDb.markAnalyticsGameplayEventsAcked).not.toHaveBeenCalled();
  });

  it('uses the backend DTO limit for successive accepted batches', async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) => ({
      ...event,
      eventId: `event-${index}`,
    }));
    const secondBatch = [{ ...event, eventId: 'event-500' }];
    mockedDb.getUnackedAnalyticsGameplayEvents
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);
    mockedApi.postAnalyticsGameplayEvents.mockResolvedValue(undefined);

    await flushAnalyticsGameplayEvents();

    expect(mockedApi.postAnalyticsGameplayEvents).toHaveBeenCalledTimes(2);
    expect(mockedDb.markAnalyticsGameplayEventsAcked).toHaveBeenNthCalledWith(
      1,
      firstBatch.map(({ eventId }) => eventId),
    );
  });
});
