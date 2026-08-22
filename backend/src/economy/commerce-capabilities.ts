export interface CommerceCapabilities {
  readonly guestCommerceAvailable: boolean;
}

export function getCommerceCapabilities(
  guestCommerceAvailable: boolean,
): CommerceCapabilities {
  return { guestCommerceAvailable };
}

/** User-Agent is client-controlled; this is only a client-shape hint. */
export function assertIosGuestCommerceClientHint(userAgent: string | undefined): void {
  if (userAgent !== 'StitchWish/iOS') {
    throw new Error('Guest Stitch Coin purchases are available from the iOS app only');
  }
}
