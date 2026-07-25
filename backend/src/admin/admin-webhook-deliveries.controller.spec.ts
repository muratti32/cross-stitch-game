import 'reflect-metadata';

import { OPERATOR_PERMISSIONS_KEY } from './require-operator-permissions.decorator';
import { AdminWebhookDeliveriesController } from './admin-webhook-deliveries.controller';

describe('AdminWebhookDeliveriesController', () => {
  it('requires the explicit replay permission', () => {
    expect(
      Reflect.getMetadata(
        OPERATOR_PERMISSIONS_KEY,
        AdminWebhookDeliveriesController.prototype.replay,
      ),
    ).toEqual(['webhook.delivery.replay']);
  });
});
