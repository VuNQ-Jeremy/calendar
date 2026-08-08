import { Stack } from 'expo-router';

/** Pushed from Profile, not a tab — see the sibling screens and app/(app)/_layout.tsx. */
export default function TuitionLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
