import { Stack } from 'expo-router';

// Sessions are opened from Catalog, Profile and the Create flows, which land on
// `[sessionId]` directly. Without an anchor those entries leave a single-screen
// stack, so popping it on exit is a no-op and the abandoned session screen is
// still there — visibly sliding away — the next time Stitch is pressed (#91).
export const unstable_settings = { anchor: 'index' };

export default function PlayLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
