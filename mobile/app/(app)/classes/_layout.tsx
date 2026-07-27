import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/** A stack inside the Classes tab: list → detail → roster picker, keeping the tab bar. */
export default function ClassesLayout() {
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
