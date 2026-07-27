import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/** A stack for the material viewer, pushed from an event's Materials tab or a class detail. */
export default function MaterialLayout() {
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
