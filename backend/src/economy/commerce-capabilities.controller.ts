import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth';

import {
  getCommerceCapabilities,
  type CommerceCapabilities,
} from './commerce-capabilities';

@Controller('commerce/capabilities')
@UseGuards(JwtAuthGuard)
export class CommerceCapabilitiesController {
  @Get()
  getCapabilities(): CommerceCapabilities {
    return getCommerceCapabilities();
  }
}
