import type { TutorialDomainEvent } from './tutorialEngine';

type Listener = (event: TutorialDomainEvent) => void | Promise<void>;
const listeners = new Set<Listener>();

export async function emitTutorialEvent(event: TutorialDomainEvent): Promise<void> {
  await Promise.all([...listeners].map((listener) => listener(event)));
}

export function subscribeToTutorialEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
