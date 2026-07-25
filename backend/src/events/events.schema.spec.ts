import { BadRequestException } from '@nestjs/common';

import { validateGameplayEventPayload } from './events.schema';

describe('Gameplay event schema', () => {
  it('accepts a known kind with its exact valid fields', () => {
    expect(
      validateGameplayEventPayload('session_started', {
        session_id: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({
      kind: 'session_started',
      payload: { session_id: '11111111-1111-4111-8111-111111111111' },
    });
  });

  it('rejects an unknown kind', () => {
    expect(() => validateGameplayEventPayload('analytics_ping', {})).toThrow(
      BadRequestException,
    );
  });

  it('rejects unknown payload fields', () => {
    expect(() =>
      validateGameplayEventPayload('daily_task_completed', {
        task_key: 'cells_100',
        prompt: 'must never be stored',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects missing required payload fields', () => {
    expect(() =>
      validateGameplayEventPayload('purchase_failed', {
        product_kind: 'ai_credit_pack',
      }),
    ).toThrow(BadRequestException);
  });
});
