import { emitTutorialEvent, subscribeToTutorialEvents } from '../tutorialEvents';

it('delivers back-to-back tutorial events in order', async () => {
  const received: string[] = [];
  const unsubscribe = subscribeToTutorialEvents(async (event) => {
    await Promise.resolve();
    received.push(event.type);
  });

  await Promise.all([
    emitTutorialEvent({ type: 'completed_stitch_recorded', cellIndex: 4, targeted: true }),
    emitTutorialEvent({ type: 'progress_operation_recorded', desiredState: 'completed', cellIndex: 4 }),
  ]);

  unsubscribe();
  expect(received).toEqual(['completed_stitch_recorded', 'progress_operation_recorded']);
});
