import { Stack } from 'expo-router';
import { useTheme } from '~/theme';

/**
 * The Materials stack: the library list and its editor.
 *
 * Note the two similar route trees, both deliberate and both from the plan:
 *
 *   `/materials`, `/materials/:id`  — the library and the add/edit form (this stack)
 *   `/material/:id`                 — the VIEWER, built in phase 4 and reached from an event's
 *                                     Materials tab, a class detail, or a row here
 *
 * They are separate because the viewer is a leaf that a teacher lands on from three different
 * places, and folding it into this stack would put a library list behind its back button that the
 * user never came from.
 */
export default function MaterialsLayout() {
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
