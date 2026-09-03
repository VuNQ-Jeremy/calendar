import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/**
 * A stack INSIDE the Practice tab, so opening a task keeps the tab bar and the back gesture —
 * the same arrangement as the Vocabulary tab.
 */
export default function PracticeLayout() {
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
