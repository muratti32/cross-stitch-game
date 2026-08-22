export interface CommerceCapabilities {
  readonly guestCommerceAvailable: boolean;
}

export function getCommerceCapabilities(): CommerceCapabilities {
  return { guestCommerceAvailable: true };
}

export function assertIosGuestCommerce(userAgent: string | undefined): void {
  if (!getCommerceCapabilities().guestCommerceAvailable) {
    throw new Error('Guest commerce is currently unavailable');
  }
  if (userAgent !== 'StitchWish/iOS') {
    throw new Error('Guest Stitch Coin purchases are available from the iOS app only');
  }
}
