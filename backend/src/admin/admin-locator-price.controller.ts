import { Body, Controller, Get, Headers, Put, UseGuards } from '@nestjs/common';

import { CurrentOperator } from './current-operator.decorator';
import { UpdateLocatorPriceDto } from './dto/update-locator-price.dto';
import { LocatorPriceAdminService } from './locator-price-admin.service';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/economy/locator-price')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminLocatorPriceController {
  constructor(private readonly locatorPrice: LocatorPriceAdminService) {}

  @Get()
  @RequireOperatorPermissions('economy.locator_price.manage')
  get() {
    return this.locatorPrice.get();
  }

  @Put()
  @RequireOperatorPermissions('economy.locator_price.manage')
  update(
    @CurrentOperator() operator: OperatorPrincipal,
    @Body() body: UpdateLocatorPriceDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.locatorPrice.update(operator.id, body.price, requestId ?? null);
  }
}
