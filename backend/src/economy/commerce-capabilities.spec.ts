import { getCommerceCapabilities } from './commerce-capabilities';

describe('CommerceCapabilities', () => {
  it('reports that the iOS guest commerce path is available', () => {
    expect(getCommerceCapabilities(true)).toEqual({
      guestCommerceAvailable: true,
    });
  });
});
