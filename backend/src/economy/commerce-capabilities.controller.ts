import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth';
import { AppConfigService } from '../config/app-config.service';

import {
  getCommerceCapabilities,
  type CommerceCapabilities,
} from './commerce-capabilities';

@Controller('commerce/capabilities')
@UseGuards(JwtAuthGuard)
export class CommerceCapabilitiesController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  getCapabilities(): CommerceCapabilities {
    return getCommerceCapabilities(this.config.iosGuestCommerceEnabled);
  }
}
