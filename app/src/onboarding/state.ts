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
  activeDmcCode: string | null;
  undoneCellIndex?: number;
}

const KEYS = {
  position: 'onboarding.v1.status',
  tutorialRunState: 'tutorial.v1.status',
  tutorialSessionId: 'tutorial.v1.session_id',
  nextBeat: 'tutorial.v1.next_beat',
  completedBeats: 'tutorial.v1.completed_beats',
  activeDmcCode: 'tutorial.v1.active_dmc_code',
  undoneCellIndex: 'tutorial.v1.undone_cell_index',
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

  const [runState, tutorialSessionId, nextBeatValue, completedBeatsValue, activeDmcCode, undoneCellIndexValue] = await Promise.all([
    getDeviceConfigValue(KEYS.tutorialRunState),
    getDeviceConfigValue(KEYS.tutorialSessionId),
    getDeviceConfigValue(KEYS.nextBeat),
    getDeviceConfigValue(KEYS.completedBeats),
    getDeviceConfigValue(KEYS.activeDmcCode),
    getDeviceConfigValue(KEYS.undoneCellIndex),
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
    activeDmcCode,
    undoneCellIndex: undoneCellIndexValue !== null && Number.isInteger(Number(undoneCellIndexValue))
      ? Number(undoneCellIndexValue)
      : undefined,
  };
  return startupState;
}

export function getStartupOnboardingState(): OnboardingState {
  return startupState ?? {
    position: 'absent', tutorialRunState: 'running', tutorialSessionId: null,
    nextBeat: 1, completedBeats: [], activeDmcCode: null,
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

export async function persistTutorialTransition(
  tutorial: Pick<OnboardingState, 'tutorialRunState' | 'nextBeat' | 'completedBeats' | 'undoneCellIndex'>,
  observedActiveDmcCode?: string,
): Promise<void> {
  const entries: (readonly [string, string])[] = [
    [KEYS.position, 'in_tutorial'],
    [KEYS.tutorialRunState, tutorial.tutorialRunState],
    [KEYS.nextBeat, String(tutorial.nextBeat)],
    [KEYS.completedBeats, JSON.stringify(tutorial.completedBeats)],
    [KEYS.undoneCellIndex, tutorial.undoneCellIndex === undefined ? '' : String(tutorial.undoneCellIndex)],
  ];
  if (observedActiveDmcCode) {
    entries.push([KEYS.activeDmcCode, observedActiveDmcCode]);
  }
  await setDeviceConfigValues(entries);
  if (startupState) {
    startupState = {
      ...startupState,
      position: 'in_tutorial',
      tutorialRunState: tutorial.tutorialRunState,
      nextBeat: tutorial.nextBeat,
      completedBeats: tutorial.completedBeats,
      activeDmcCode: observedActiveDmcCode ?? startupState.activeDmcCode,
      undoneCellIndex: tutorial.undoneCellIndex,
    };
  }
}

function tutorialStartState(sessionId: string): OnboardingState {
  return {
    position: 'in_tutorial',
    tutorialRunState: 'running',
    tutorialSessionId: sessionId,
    nextBeat: 1,
    completedBeats: [],
    activeDmcCode: null,
  };
}

async function persistTutorialStart(state: OnboardingState): Promise<void> {
  await setDeviceConfigValues([
    [KEYS.position, state.position],
    [KEYS.tutorialRunState, state.tutorialRunState],
    [KEYS.tutorialSessionId, state.tutorialSessionId ?? ''],
    [KEYS.nextBeat, String(state.nextBeat)],
    [KEYS.completedBeats, JSON.stringify(state.completedBeats)],
    [KEYS.undoneCellIndex, ''],
  ]);
}
