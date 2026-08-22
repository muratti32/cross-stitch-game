/** Pure generation coordination for asynchronous identity transitions. */
export interface SessionLifecycle {
  generation: number;
}

export function createSessionLifecycle(): SessionLifecycle {
  return { generation: 0 };
}

export function captureGeneration(lifecycle: SessionLifecycle): number {
  return lifecycle.generation;
}

export function advanceGeneration(lifecycle: SessionLifecycle): number {
  lifecycle.generation += 1;
  return lifecycle.generation;
}

export function isCurrentGeneration(
  lifecycle: SessionLifecycle,
  generation: number,
): boolean {
  return lifecycle.generation === generation;
}
