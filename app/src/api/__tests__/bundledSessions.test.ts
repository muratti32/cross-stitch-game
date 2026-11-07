const mockApiFetch = jest.fn();

jest.mock('../apiFetch', () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));

import { registerBundledSessionRemote } from '../bundledSessions';

const request = {
  patternId: 'dc47c329-35fd-4173-9ad9-5098369beb44',
  localState: 'in_progress' as const,
  completedAt: null,
  packedBitmapBase64: null,
};

const respond = (status: number, body: unknown) => ({ status, json: async () => body });

describe('registerBundledSessionRemote', () => {
  beforeEach(() => mockApiFetch.mockReset());

  test('posts the registration and reads the session back', async () => {
    mockApiFetch.mockResolvedValue(respond(200, { sessionId: 'remote', terminalCompleted: true }));

    await expect(registerBundledSessionRemote(request)).resolves.toEqual({
      kind: 'registered',
      sessionId: 'remote',
      terminalCompleted: true,
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/v1/sessions/bundled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });

  test.each([
    [404, { code: 'starter_not_seeded' }, 'deferred'],
    [409, {}, 'deferred'],
    [404, { code: 'not_a_bundled_starter' }, 'notABundledStarter'],
    [404, { statusCode: 404, message: 'Cannot POST' }, 'deferred'],
    [405, null, 'deferred'],
  ])('reads a %i with body %j as %s', async (status, body, kind) => {
    mockApiFetch.mockResolvedValue(respond(status, body));

    await expect(registerBundledSessionRemote(request)).resolves.toEqual({ kind });
  });

  test.each([
    [500, {}],
    [400, { code: 'packed_bitmap_required' }],
    [404, { code: 'some_other_reason' }],
  ])('throws a %i with body %j', async (status, body) => {
    mockApiFetch.mockResolvedValue(respond(status, body));

    await expect(registerBundledSessionRemote(request)).rejects.toThrow(`status ${status}`);
  });
});
