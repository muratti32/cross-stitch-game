import {
  getDeviceConfigValue,
  findActiveSessionForPattern,
  hasPlayHistory,
  setDeviceConfigValue,
  setDeviceConfigValues,
} from '../local-db';
import { HINT_IDS, type HintId } from './justInTimeHints';

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
  lastCompletedCellIndex?: number;
  threadColorCompletionObserved?: boolean;
  shownHints: readonly HintId[];
}

const KEYS = {
  position: 'onboarding.v1.status',
  tutorialRunState: 'tutorial.v1.status',
  tutorialSessionId: 'tutorial.v1.session_id',
  nextBeat: 'tutorial.v1.next_beat',
  completedBeats: 'tutorial.v1.completed_beats',
  activeDmcCode: 'tutorial.v1.active_dmc_code',
  undoneCellIndex: 'tutorial.v1.undone_cell_index',
  lastCompletedCellIndex: 'tutorial.v1.last_completed_cell_index',
  threadColorCompletionObserved: 'tutorial.v1.thread_color_completion_observed',
  completedAt: 'onboarding.v1.completed_at',
  shownHints: 'tutorial.v1.shown_hints',
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

  const [runState, tutorialSessionId, nextBeatValue, completedBeatsValue, activeDmcCode, undoneCellIndexValue, lastCompletedCellIndexValue, threadColorCompletionObservedValue, shownHintsValue] = await Promise.all([
    getDeviceConfigValue(KEYS.tutorialRunState),
    getDeviceConfigValue(KEYS.tutorialSessionId),
    getDeviceConfigValue(KEYS.nextBeat),
    getDeviceConfigValue(KEYS.completedBeats),
    getDeviceConfigValue(KEYS.activeDmcCode),
    getDeviceConfigValue(KEYS.undoneCellIndex),
    getDeviceConfigValue(KEYS.lastCompletedCellIndex),
    getDeviceConfigValue(KEYS.threadColorCompletionObserved),
    getDeviceConfigValue(KEYS.shownHints),
  ]);
  let completedBeats: string[] = [];
  try {
    const parsed = JSON.parse(completedBeatsValue ?? '[]');
    if (Array.isArray(parsed) && parsed.every((beat) => typeof beat === 'string')) completedBeats = parsed;
  } catch {
    // Corrupt optional tutorial state safely restarts the tutorial cursor.
  }
  let shownHints: HintId[] = [];
  try {
    const parsed = JSON.parse(shownHintsValue ?? '[]');
    if (Array.isArray(parsed)) {
      shownHints = parsed.filter((hint): hint is HintId => typeof hint === 'string' && HINT_IDS.includes(hint as HintId));
    }
  } catch {
    // Corrupt optional hint state safely allows each hint to be shown once.
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
    lastCompletedCellIndex: lastCompletedCellIndexValue !== null && Number.isInteger(Number(lastCompletedCellIndexValue))
      ? Number(lastCompletedCellIndexValue)
      : undefined,
    threadColorCompletionObserved: threadColorCompletionObservedValue === '1',
    shownHints,
  };
  return startupState;
}

export function getStartupOnboardingState(): OnboardingState {
  return startupState ?? {
    position: 'absent', tutorialRunState: 'running', tutorialSessionId: null,
    nextBeat: 1, completedBeats: [], activeDmcCode: null,
    shownHints: [],
  };
}

export async function saveOnboardingPosition(value: Exclude<OnboardingPosition, 'absent'>): Promise<void> {
  await setDeviceConfigValue(KEYS.position, value);
  if (startupState) startupState = { ...startupState, position: value };
}

export async function startTutorial(sessionId: string): Promise<void> {
  const nextState = { ...tutorialStartState(sessionId), shownHints: startupState?.shownHints ?? [] };
  await persistTutorialStart(nextState);
  if (startupState) {
    startupState = nextState;
  }
}

export async function resumeTutorial(sessionId: string): Promise<void> {
  const state = startupState;
  if (
    !state
    || state.position !== 'in_tutorial'
    || state.tutorialRunState !== 'paused'
    || state.tutorialSessionId !== sessionId
  ) {
    throw new Error('No paused tutorial exists for this session');
  }
  await persistTutorialTransition({
    tutorialRunState: 'running',
    nextBeat: state.nextBeat,
    completedBeats: state.completedBeats,
  });
}

export async function resetOnboarding(): Promise<void> {
  await setDeviceConfigValues([
    [KEYS.position, 'welcome'],
    [KEYS.tutorialRunState, 'running'],
    [KEYS.tutorialSessionId, ''],
    [KEYS.nextBeat, '1'],
    [KEYS.completedBeats, '[]'],
    [KEYS.activeDmcCode, ''],
    [KEYS.threadColorCompletionObserved, ''],
    [KEYS.shownHints, '[]'],
  ]);
  startupState = {
    position: 'welcome',
    tutorialRunState: 'running',
    tutorialSessionId: null,
    nextBeat: 1,
    completedBeats: [],
    activeDmcCode: null,
    threadColorCompletionObserved: false,
    shownHints: [],
  };
}

export async function persistTutorialTransition(
  tutorial: Pick<OnboardingState, 'tutorialRunState' | 'nextBeat' | 'completedBeats' | 'undoneCellIndex' | 'lastCompletedCellIndex' | 'threadColorCompletionObserved'>,
  observedActiveDmcCode?: string,
): Promise<void> {
  const entries: (readonly [string, string])[] = [
    [KEYS.position, tutorial.tutorialRunState === 'complete' ? 'complete' : 'in_tutorial'],
    [KEYS.tutorialRunState, tutorial.tutorialRunState],
    [KEYS.nextBeat, String(tutorial.nextBeat)],
    [KEYS.completedBeats, JSON.stringify(tutorial.completedBeats)],
    [KEYS.undoneCellIndex, tutorial.undoneCellIndex === undefined ? '' : String(tutorial.undoneCellIndex)],
    [KEYS.lastCompletedCellIndex, tutorial.lastCompletedCellIndex === undefined ? '' : String(tutorial.lastCompletedCellIndex)],
    [KEYS.threadColorCompletionObserved, tutorial.threadColorCompletionObserved ? '1' : ''],
  ];
  if (tutorial.tutorialRunState === 'complete') entries.push([KEYS.completedAt, new Date().toISOString()]);
  if (observedActiveDmcCode) {
    entries.push([KEYS.activeDmcCode, observedActiveDmcCode]);
  }
  await setDeviceConfigValues(entries);
  if (startupState) {
    startupState = {
      ...startupState,
      position: tutorial.tutorialRunState === 'complete' ? 'complete' : 'in_tutorial',
      tutorialRunState: tutorial.tutorialRunState,
      nextBeat: tutorial.nextBeat,
      completedBeats: tutorial.completedBeats,
      activeDmcCode: observedActiveDmcCode ?? startupState.activeDmcCode,
      undoneCellIndex: tutorial.undoneCellIndex,
      lastCompletedCellIndex: tutorial.lastCompletedCellIndex,
      threadColorCompletionObserved: tutorial.threadColorCompletionObserved,
    };
  }
}

export async function persistShownHints(shownHints: readonly HintId[]): Promise<void> {
  await setDeviceConfigValue(KEYS.shownHints, JSON.stringify(shownHints));
  if (startupState) startupState = { ...startupState, shownHints };
}

function tutorialStartState(sessionId: string): OnboardingState {
  return {
    position: 'in_tutorial',
    tutorialRunState: 'running',
    tutorialSessionId: sessionId,
    nextBeat: 1,
    completedBeats: [],
    activeDmcCode: null,
    shownHints: startupState?.shownHints ?? [],
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
    [KEYS.lastCompletedCellIndex, ''],
    [KEYS.threadColorCompletionObserved, ''],
  ]);
}
