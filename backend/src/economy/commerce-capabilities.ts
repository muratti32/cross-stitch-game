export interface CommerceCapabilities {
  readonly guestCommerceAvailable: boolean;
}

// Guest commerce stays false until a later, iOS-first Issue #105 ticket deliberately enables it (see ADR-0044).
export function getCommerceCapabilities(): CommerceCapabilities {
  return { guestCommerceAvailable: false };
}
