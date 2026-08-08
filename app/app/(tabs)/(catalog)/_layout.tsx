import { Stack } from 'expo-router';

// Every tab group's `index` collapses to the same "/" path, so the cold-start
// URL is ambiguous and expo-router resolves it to whichever group is an entry
// point. The `(play)` anchor added for #91 made Stitch win that race, opening
// the app on the session list. Anchoring Catalog too puts it back in the running,
// and the tabs navigator's own `(catalog)` anchor breaks the tie in its favour.
export const unstable_settings = { anchor: 'index' };

export default function CatalogLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
