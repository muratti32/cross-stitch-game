import { completeProgress } from '../progressSync';
import { apiFetch } from '../apiFetch';

jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));

const mockedApiFetch = jest.mocked(apiFetch);

describe('progress completion API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends completedCells for a Guest completion claim', async () => {
    mockedApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ revision: 0, terminalCompleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await completeProgress('remote-1', 'device-1', 4_000);

    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/v1/sessions/remote-1/progress/complete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'device-1', completedCells: 4_000 }),
      },
    );
  });

  it('leaves the Account completion payload unchanged', async () => {
    mockedApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ revision: 9, terminalCompleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await completeProgress('remote-1', 'device-1');

    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/v1/sessions/remote-1/progress/complete',
      expect.objectContaining({
        body: JSON.stringify({ deviceId: 'device-1' }),
      }),
    );
  });
});
