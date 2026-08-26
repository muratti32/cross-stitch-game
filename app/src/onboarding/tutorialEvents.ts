import type { TutorialDomainEvent } from './tutorialEngine';

type Listener = (event: TutorialDomainEvent) => void | Promise<void>;
const listeners = new Set<Listener>();
let pendingDelivery: Promise<void> = Promise.resolve();

export async function emitTutorialEvent(event: TutorialDomainEvent): Promise<void> {
  const delivery = pendingDelivery.then(async () => {
    await Promise.all([...listeners].map((listener) => listener(event)));
  });
  pendingDelivery = delivery.catch(() => undefined);
  await delivery;
}

export function subscribeToTutorialEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
