import {
  getDeviceConfigValue,
  hasPlayHistory,
  setDeviceConfigValue,
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

let startupState: OnboardingState | null = null;

function position(value: string | null): OnboardingPosition | null {
  return value === 'welcome' || value === 'in_tutorial' || value === 'deferred' || value === 'complete'
    ? value
    : null;
}

export async function loadOnboardingState(): Promise<OnboardingState> {
  let persistedPosition = position(await getDeviceConfigValue(KEYS.position));
  if (persistedPosition === null && await hasPlayHistory()) {
    persistedPosition = 'complete';
    await setDeviceConfigValue(KEYS.position, persistedPosition);
  } else if (persistedPosition === null) {
    persistedPosition = 'welcome';
    await setDeviceConfigValue(KEYS.position, persistedPosition);
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
    tutorialSessionId,
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
  await Promise.all([
    setDeviceConfigValue(KEYS.position, 'in_tutorial'),
    setDeviceConfigValue(KEYS.tutorialRunState, 'running'),
    setDeviceConfigValue(KEYS.tutorialSessionId, sessionId),
    setDeviceConfigValue(KEYS.nextBeat, '1'),
    setDeviceConfigValue(KEYS.completedBeats, '[]'),
  ]);
  if (startupState) {
    startupState = {
      ...startupState,
      position: 'in_tutorial',
      tutorialRunState: 'running',
      tutorialSessionId: sessionId,
      nextBeat: 1,
      completedBeats: [],
    };
  }
}
