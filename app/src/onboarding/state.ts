import {
  getDeviceConfigValue,
  findActiveSessionForPattern,
  hasPlayHistory,
  setDeviceConfigValue,
  setDeviceConfigValues,
} from '../local-db';

export type OnboardingPosition =
  | 'absent'
  | 'welcome'
  | 'in_tutorial'
  | 'deferred'
  | 'complete';

export type TutorialRunState = 'running' | 'paused' | 'complete';

export interface OnboardingState {
  position: OnboardingPosition;
  tutorialRunState: TutorialRunState;
  tutorialSessionId: string | null;
  nextBeat: number;
  completedBeats: readonly string[];
}

const KEYS = {
  position: 'onboarding.v1.status',
  tutorialRunState: 'tutorial.v1.status',
  tutorialSessionId: 'tutorial.v1.session_id',
  nextBeat: 'tutorial.v1.next_beat',
  completedBeats: 'tutorial.v1.completed_beats',
} as const;
export const ONBOARDING_STARTER_PATTERN_ID = 'starter_heart';

let startupState: OnboardingState | null = null;

function parseOnboardingPosition(value: string | null): OnboardingPosition | null {
  return value === 'welcome' || value === 'in_tutorial' || value === 'deferred' || value === 'complete'
    ? value
    : null;
}

export async function loadOnboardingState(): Promise<OnboardingState> {
  let persistedPosition = parseOnboardingPosition(await getDeviceConfigValue(KEYS.position));
  if (persistedPosition === null && await hasPlayHistory()) {
    persistedPosition = 'complete';
    await setDeviceConfigValue(KEYS.position, persistedPosition);
  } else if (persistedPosition === null) {
    persistedPosition = 'welcome';
    await setDeviceConfigValue(KEYS.position, persistedPosition);
  }

  // Session creation commits before the onboarding keys. Recover the narrow
  // kill window by adopting the idempotently-created canonical session.
  let recoveredTutorialSessionId: string | null = null;
  if (persistedPosition === 'welcome') {
    const starterSession = await findActiveSessionForPattern(ONBOARDING_STARTER_PATTERN_ID, 'bundled');
    if (starterSession) {
      recoveredTutorialSessionId = starterSession.id;
      await persistTutorialStart(tutorialStartState(starterSession.id));
      persistedPosition = 'in_tutorial';
    }
  }

  const [runState, tutorialSessionId, nextBeatValue, completedBeatsValue] = await Promise.all([
    getDeviceConfigValue(KEYS.tutorialRunState),
    getDeviceConfigValue(KEYS.tutorialSessionId),
    getDeviceConfigValue(KEYS.nextBeat),
    getDeviceConfigValue(KEYS.completedBeats),
  ]);
  let completedBeats: string[] = [];
  try {
    const parsed = JSON.parse(completedBeatsValue ?? '[]');
    if (Array.isArray(parsed) && parsed.every((beat) => typeof beat === 'string')) completedBeats = parsed;
  } catch {
    // Corrupt optional tutorial state safely restarts the tutorial cursor.
  }
  startupState = {
    position: persistedPosition,
    tutorialRunState: runState === 'paused' || runState === 'complete' ? runState : 'running',
    tutorialSessionId: recoveredTutorialSessionId ?? tutorialSessionId,
    nextBeat: Math.max(1, Number.parseInt(nextBeatValue ?? '1', 10) || 1),
    completedBeats,
  };
  return startupState;
}

export function getStartupOnboardingState(): OnboardingState {
  return startupState ?? {
    position: 'absent', tutorialRunState: 'running', tutorialSessionId: null,
    nextBeat: 1, completedBeats: [],
  };
}

export async function saveOnboardingPosition(value: Exclude<OnboardingPosition, 'absent'>): Promise<void> {
  await setDeviceConfigValue(KEYS.position, value);
  if (startupState) startupState = { ...startupState, position: value };
}

export async function startTutorial(sessionId: string): Promise<void> {
  const nextState = tutorialStartState(sessionId);
  await persistTutorialStart(nextState);
  if (startupState) {
    startupState = nextState;
  }
}

function tutorialStartState(sessionId: string): OnboardingState {
  return {
    position: 'in_tutorial',
    tutorialRunState: 'running',
    tutorialSessionId: sessionId,
    nextBeat: 1,
    completedBeats: [],
  };
}

async function persistTutorialStart(state: OnboardingState): Promise<void> {
  await setDeviceConfigValues([
    [KEYS.position, state.position],
    [KEYS.tutorialRunState, state.tutorialRunState],
    [KEYS.tutorialSessionId, state.tutorialSessionId ?? ''],
    [KEYS.nextBeat, String(state.nextBeat)],
    [KEYS.completedBeats, JSON.stringify(state.completedBeats)],
  ]);
}
