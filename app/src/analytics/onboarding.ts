import { captureOnboardingEvent } from './gameplayEvents';

export const ONBOARDING_VERSION = '1' as const;

export function onboardingStarted(isResume: boolean): void {
  void captureOnboardingEvent('onboarding_started', { is_resume: isResume }, 'onboarding_started');
}
export function onboardingStepViewed(step: 'welcome' | 'tutorial' | 'recap', isResume: boolean): void {
  void captureOnboardingEvent('onboarding_step_viewed', { step, is_resume: isResume });
}
export function onboardingHandednessSelected(handedness: 'left' | 'right', wasDefault: boolean): void {
  void captureOnboardingEvent('onboarding_handedness_selected', { handedness, was_default: wasDefault });
}
export function onboardingStartChoice(choice: 'start_stitching' | 'browse_starters' | 'sign_in'): void {
  void captureOnboardingEvent('onboarding_start_choice', { choice });
}
export function stitchingSessionStarted(sessionId: string, patternId: string): void {
  void captureOnboardingEvent('stitching_session_started', { session_id: sessionId, pattern_id: patternId, pattern_source: 'bundled', source: 'onboarding' });
}
export function tutorialBeatStarted(beatId: string, beatNumber: number): void {
  void captureOnboardingEvent('tutorial_beat_started', { beat_id: beatId, beat_number: beatNumber });
}
export function tutorialBeatCompleted(beatId: string, elapsedMs: number, attemptCount: number, autoSatisfied: boolean): void {
  void captureOnboardingEvent('tutorial_beat_completed', { beat_id: beatId, elapsed_ms: elapsedMs, attempt_count: attemptCount, auto_satisfied: autoSatisfied }, `tutorial_beat_completed:${beatId}`);
}
export function tutorialHintShown(hintId: 'anchored_zoom' | 'pan_vs_sweep' | 'edge_auto_pan' | 'remaining_cell_locator', trigger: string): void {
  void captureOnboardingEvent('tutorial_hint_shown', { hint_id: hintId, trigger }, `tutorial_hint_shown:${hintId}`);
}
export function tutorialPaused(beatId: string, destination: string): void {
  void captureOnboardingEvent('tutorial_paused', { beat_id: beatId, destination });
}
export function tutorialResumed(beatId: string, resumeSource: string): void {
  void captureOnboardingEvent('tutorial_resumed', { beat_id: beatId, resume_source: resumeSource });
}
export function onboardingFinished(outcome: 'completed' | 'deferred', destination: 'stitching' | 'catalog' | 'sign_in', durationMs: number, stitchCount: number): void {
  void captureOnboardingEvent('onboarding_finished', { outcome, destination, duration_ms: durationMs, stitch_count: stitchCount }, 'onboarding_finished');
}
export function accountSoftPromptShown(context: 'welcome' | 'tutorial' | 'recap'): void {
  void captureOnboardingEvent('account_soft_prompt_shown', { context });
}
export function accountSoftPromptAction(context: 'welcome' | 'tutorial' | 'recap', action: 'sign_in' | 'dismissed'): void {
  void captureOnboardingEvent('account_soft_prompt_action', { context, action });
}
