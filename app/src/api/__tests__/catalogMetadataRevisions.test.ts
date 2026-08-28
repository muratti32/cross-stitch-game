jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));

import {
  CatalogMetadataRevisionApiError,
  createCatalogMetadataRevision,
  listMyPublishedPatterns,
} from '../catalogMetadataRevisions';
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

describe('catalog metadata revisions client', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads the caller\'s published patterns', async () => {
    const patterns = [{ id: 'pattern-1', title: 'Cozy Fox' }];
    apiFetch.mockResolvedValue(jsonResponse(200, patterns));

    await expect(listMyPublishedPatterns()).resolves.toEqual(patterns);
  });

  test('surfaces a validation failure as a status/reason error, not the raw message', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(422, { message: ['description must not be empty'] }),
    );

    const error = await createCatalogMetadataRevision('pattern-1', {
      categoryCode: 'nature',
      description: '',
      sourceLanguage: 'en',
      tagCodes: [],
      title: 'Cozy Fox',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CatalogMetadataRevisionApiError);
    expect(error).toMatchObject<Partial<CatalogMetadataRevisionApiError>>({ status: 422, reason: null });

    expect(isServerApiError(error)).toBe(true);
    const presented = localizeServerError(error as Error & { status: number; reason: string | null });
    expect(presented).not.toContain('description must not be empty');
    expect(presented).toContain('Support Reference');
  });
});
