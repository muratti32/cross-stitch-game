import { CommerceCapabilitiesController } from './commerce-capabilities.controller';
import { AppConfigService } from '../config/app-config.service';

describe('CommerceCapabilitiesController', () => {
  it('returns the commerce capabilities', () => {
    const controller = new CommerceCapabilitiesController({
      iosGuestCommerceEnabled: true,
    } as AppConfigService);

    expect(controller.getCapabilities()).toEqual({
      guestCommerceAvailable: true,
    });
  });
});
