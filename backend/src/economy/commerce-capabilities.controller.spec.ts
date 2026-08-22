import { CommerceCapabilitiesController } from './commerce-capabilities.controller';

describe('CommerceCapabilitiesController', () => {
  it('returns the commerce capabilities', () => {
    const controller = new CommerceCapabilitiesController();

    expect(controller.getCapabilities()).toEqual({
      guestCommerceAvailable: true,
    });
  });
});
