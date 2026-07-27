import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/** A stack for Homework: list → edit → grading. Reached from More, or from an event's tabs. */
export default function HomeworkLayout() {
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
