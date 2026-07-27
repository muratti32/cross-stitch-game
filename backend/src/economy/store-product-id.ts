// Google Play models a subscription as a product plus one or more base plans,
// and RevenueCat identifies such a product as `productId:basePlanId`. The
// catalogs are keyed by the bare product identifier shared with Apple
// (ADR-0043), so the base-plan suffix is stripped before every lookup. Apple
// identifiers never contain a colon, so this is a no-op for them.
export function storeProductKey(storeIdentifier: string): string {
  const separator = storeIdentifier.indexOf(':');
  return separator === -1 ? storeIdentifier : storeIdentifier.slice(0, separator);
}
