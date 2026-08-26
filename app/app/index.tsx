import { Redirect } from 'expo-router';
import { getStartupOnboardingState } from '../src/onboarding/state';

export default function Index() {
  const { position, tutorialSessionId } = getStartupOnboardingState();
  if (position === 'absent' || position === 'welcome') {
    return <Redirect href="/onboarding/welcome" />;
  }
  if (position === 'in_tutorial' && tutorialSessionId) {
    return <Redirect href={{ pathname: '/(tabs)/(play)/[sessionId]', params: { sessionId: tutorialSessionId } }} />;
  }
  return <Redirect href="/(tabs)/(catalog)" />;
}
