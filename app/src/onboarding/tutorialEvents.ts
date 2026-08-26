import type { TutorialDomainEvent } from './tutorialEngine';

type Listener = (event: TutorialDomainEvent) => void;
const listeners = new Set<Listener>();

export function emitTutorialEvent(event: TutorialDomainEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeToTutorialEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
