import { hydrateStoredIdentity } from '../identity/guestIdentity';
import { getHandedness, initDatabase } from '../local-db';
import { loadOnboardingState } from './state';

/** Resolves all durable startup gates before root navigation is allowed. */
export async function prepareOnboardingStartup() {
  await hydrateStoredIdentity();
  await initDatabase();
  const handedness = await getHandedness();
  const onboarding = await loadOnboardingState();
  return { handedness, onboarding };
}
