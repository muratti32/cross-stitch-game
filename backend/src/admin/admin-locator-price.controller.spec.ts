import 'reflect-metadata';

import { AdminLocatorPriceController } from './admin-locator-price.controller';
import { OPERATOR_ROLE_PERMISSIONS } from './operator-permission';
import { OperatorRole } from './entities';
import { OPERATOR_PERMISSIONS_KEY } from './require-operator-permissions.decorator';

describe('AdminLocatorPriceController', () => {
  it('guards reading and changing the Locator Price with the economy permission', () => {
    expect(Reflect.getMetadata(OPERATOR_PERMISSIONS_KEY, AdminLocatorPriceController.prototype.get))
      .toEqual(['economy.locator_price.manage']);
    expect(Reflect.getMetadata(OPERATOR_PERMISSIONS_KEY, AdminLocatorPriceController.prototype.update))
      .toEqual(['economy.locator_price.manage']);
  });

  it('grants the economy permission to the owner role', () => {
    expect(OPERATOR_ROLE_PERMISSIONS[OperatorRole.Owner].has('economy.locator_price.manage')).toBe(true);
  });
});
