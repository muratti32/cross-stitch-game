import { GUEST_PURCHASABLE_PRODUCT_IDS } from './guest-purchase-attempt.dto';

type GuestProductId = (typeof GUEST_PURCHASABLE_PRODUCT_IDS)[number];

// @ts-expect-error Unknown store products must remain rejected at compile time.
export const invalidGuestProductId: GuestProductId = 'com.avk.stitchwish.definitely_not_a_product';
