/** The catalog detail screen is where the Pattern Unlock happens. */
export function catalogDetailRoute(patternId: string) {
  return { pathname: '/(tabs)/(catalog)/[id]' as const, params: { id: patternId } };
}
