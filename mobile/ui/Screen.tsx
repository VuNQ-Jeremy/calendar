import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';

export interface ScreenProps {
  /** Wraps children in a ScrollView. Off for screens that own a FlashList. */
  scroll?: boolean;
  /**
   * Which vertical insets this screen pads. Left and right are always padded.
   *
   * Both default to OFF, because most screens have chrome above and below them that owns the
   * inset: pass `top` when there is no ScreenHeader above the content, and `bottom` only on the
   * handful of screens rendered OUTSIDE the tab group (login, the not-found page, the flashcard
   * player) — a screen inside `app/(app)/` sits on top of the tab bar, which pads the bottom
   * inset itself. Padding it here as well is a band of dead cream above the bar.
   */
  edges?: { top?: boolean; bottom?: boolean };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Page frame: the cream page background plus safe-area padding.
 *
 * Android gesture-navigation bars and camera cutouts overlap content otherwise — this app is
 * edge-to-edge (app.config.ts), which means insets are not optional anywhere. What IS optional is
 * which layer applies them, hence `edges`.
 */
export function Screen({ scroll, edges, style, children }: ScreenProps) {
  const th = useTheme();
  const insets = useSafeAreaInsets();

  const pad: ViewStyle = {
    paddingLeft: insets.left,
    paddingRight: insets.right,
    paddingTop: edges?.top ? insets.top : 0,
    paddingBottom: edges?.bottom ? insets.bottom : 0,
  };

  if (scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: th.color.bgPage }, pad]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[{ padding: th.spacing[5], gap: th.spacing[4] }, style]}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[{ flex: 1, backgroundColor: th.color.bgPage }, pad, style]}>{children}</View>
  );
}
