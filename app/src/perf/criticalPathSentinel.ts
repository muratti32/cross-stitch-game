/**
 * ADR-0031: Critical Path Sentinel
 * Monitors the interaction-critical path to ensure no non-eligible activities
 * (like networking, decompression, database sync, etc.) occur during a measurement window.
 */

export type CriticalPathViolationKind =
  | "network"
  | "progress-sync"
  | "conversion"
  | "decompression"
  | "db-reconciliation";

export interface CriticalPathViolation {
  kind: CriticalPathViolationKind;
  detail: string;
  atMs: number;
}

let currentClock: () => number = Date.now;
let windowLabel: string | null = null;
let violations: CriticalPathViolation[] = [];

/**
 * Sets an alternative clock source for testing.
 * @param fn Callable that returns a timestamp in milliseconds.
 */
export function setCriticalPathClock(fn: () => number): void {
  currentClock = fn;
}

/**
 * Starts a new critical path measurement window.
 * @param label Unique name for the measurement block.
 * @throws Error if a window is already open (nested windows are forbidden).
 */
export function beginCriticalPathWindow(label: string): void {
  if (windowLabel !== null) {
    throw new Error(
      `Cannot begin critical path window "${label}": window "${windowLabel}" is already open.`
    );
  }
  windowLabel = label;
  violations = [];
}

/**
 * Ends the active critical path measurement window and returns all violations.
 * @returns List of violations recorded since `beginCriticalPathWindow` was called.
 */
export function endCriticalPathWindow(): CriticalPathViolation[] {
  if (windowLabel === null) {
    throw new Error("Cannot end critical path window: no window is currently open.");
  }
  const result = [...violations];
  windowLabel = null;
  violations = [];
  return result;
}

/**
 * Marks critical path activity. It is recorded only if a critical path window is currently open.
 * @param kind Category of the critical path violation.
 * @param detail Description or context of the violation.
 */
export function markCriticalPathActivity(kind: CriticalPathViolationKind, detail: string): void {
  if (windowLabel !== null) {
    violations.push({
      kind,
      detail,
      atMs: currentClock(),
    });
  }
}

/**
 * Checked if a critical path measurement window is currently open.
 */
export function isCriticalPathWindowOpen(): boolean {
  return windowLabel !== null;
}

/**
 * Resets the sentinel back to its clean default state.
 */
export function resetCriticalPathSentinel(): void {
  windowLabel = null;
  violations = [];
  currentClock = Date.now;
}
