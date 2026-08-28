jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(() => 'submission-error-event'),
  withScope: jest.fn((callback) => callback({ setContext: jest.fn(), setLevel: jest.fn(), setTag: jest.fn() })),
}));

import {
  CatalogSubmissionApiError,
  createCatalogSubmission,
  listCatalogSubmissions,
} from '../catalogSubmissions';
import { isServerApiError, localizeServerError } from '../localizeServerError';

jest.mock('../apiFetch', () => ({ apiFetch: jest.fn() }));

const { apiFetch } = require('../apiFetch');

function jsonResponse(status: number, body: unknown): Response {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe('catalog submissions client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads submissions for the signed-in account', async () => {
    const submissions = [{ id: 'sub-1', title: 'Cozy Fox' }];
    apiFetch.mockResolvedValue(jsonResponse(200, submissions));

    await expect(listCatalogSubmissions()).resolves.toEqual(submissions);
  });

  test('surfaces a validation failure as a status/reason error, not the raw message', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(422, { message: ['title must not be empty'] }),
    );

    const error = await createCatalogSubmission('pattern-1', {
      categoryCode: 'nature',
      description: 'A fox in the snow',
      licenseVersion: 'v1',
      rightsDeclared: true,
      sourceLanguage: 'en',
      tagCodes: [],
      title: '',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CatalogSubmissionApiError);
    expect(error).toMatchObject<Partial<CatalogSubmissionApiError>>({ status: 422, reason: null });

    // #159/#165: the backend's English validation message never reaches
    // the player - it only localizes to the generic failure plus a
    // Support Reference, since this backend has no reason-code contract
    // for catalog submission validation.
    expect(isServerApiError(error)).toBe(true);
    const presented = localizeServerError(error as Error & { status: number; reason: string | null });
    expect(presented).not.toContain('title must not be empty');
    expect(presented).toContain('Support Reference');
  });
});
