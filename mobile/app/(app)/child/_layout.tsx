import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/** A stack for the child detail, pushed over the Children tab. Mirrors event/_layout.tsx. */
export default function ChildLayout() {
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
