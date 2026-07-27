import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/**
 * The People stack.
 *
 * The web keeps four entity families, their four editors and the invite generator in ONE
 * 1049-line screen with one modal per family. That works with a 540px modal floating over a
 * desktop table; it does not survive a 360dp phone, where a modal covering the whole screen is
 * indistinguishable from a pushed screen except that it cannot be reached by a back gesture.
 *
 * So: the list is a screen, and each editor is a screen. Same data, same endpoints, one file per
 * thing rather than one file for everything.
 */
export default function PeopleLayout() {
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
