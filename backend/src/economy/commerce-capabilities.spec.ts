import { getCommerceCapabilities } from './commerce-capabilities';

describe('CommerceCapabilities', () => {
  it('reports that guest commerce is unavailable', () => {
    expect(getCommerceCapabilities()).toEqual({
      guestCommerceAvailable: false,
    });
  });
});
