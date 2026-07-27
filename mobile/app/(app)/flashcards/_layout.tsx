import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/**
 * A stack INSIDE the Flashcards tab, so pushing a topic keeps the tab bar and the back gesture.
 *
 * The games are deliberately NOT in here — they live at `app/play/[slug]/[mode].tsx`, outside the
 * tab group, which is how they get the full screen with no tab bar. That is the mobile answer to
 * the web's `GameOverlay` (`position: fixed; inset: 0; z-index: 200`).
 */
export default function FlashcardsLayout() {
  const th = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: th.color.bgPage },
        animation: 'slide_from_right',
      }}
    />
  );
}
