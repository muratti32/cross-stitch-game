const mockCalls: string[] = [];

jest.mock('../../identity/guestIdentity', () => ({
  hydrateStoredIdentity: jest.fn(async () => { mockCalls.push('identity'); }),
}));
jest.mock('../../local-db', () => ({
  initDatabase: jest.fn(async () => { mockCalls.push('database'); }),
  getHandedness: jest.fn(async () => { mockCalls.push('handedness'); return 'left'; }),
}));
jest.mock('../state', () => ({
  loadOnboardingState: jest.fn(async () => { mockCalls.push('onboarding'); return { position: 'complete' }; }),
}));

import { prepareOnboardingStartup } from '../startup';

it('opens the durable identity namespace before database-backed onboarding reads', async () => {
  await expect(prepareOnboardingStartup()).resolves.toEqual({
    handedness: 'left',
    onboarding: { position: 'complete' },
  });
  expect(mockCalls).toEqual(['identity', 'database', 'handedness', 'onboarding']);
});
