import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/**
 * A stack for the event detail, pushed over whichever tab opened it.
 *
 * The web renders this as a `.m-dialog--full` at `min(1100px, 100vw-32px)` × `88vh` with a 300px
 * left pane (`src/calendar/event-modal.tsx`). There is no mobile fallback for that and it cannot be
 * shrunk — so on the phone it is a full-screen route with its own back stack, not a modal.
 */
export default function EventLayout() {
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
