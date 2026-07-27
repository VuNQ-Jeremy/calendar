import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';

export interface ScreenProps {
  /** Wraps children in a ScrollView. Off for screens that own a FlashList. */
  scroll?: boolean;
  /** Pads the left/right/bottom safe-area insets. The header owns the top inset. */
  edges?: { top?: boolean; bottom?: boolean };
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Page frame: the cream page background plus safe-area padding.
 *
 * Android gesture-navigation bars and camera cutouts overlap content otherwise — this app is
 * edge-to-edge (app.config.ts), which means insets are not optional anywhere.
 */
export function Screen({ scroll, edges, style, children }: ScreenProps) {
  const th = useTheme();
  const insets = useSafeAreaInsets();

  const pad: ViewStyle = {
    paddingLeft: insets.left,
    paddingRight: insets.right,
    paddingTop: edges?.top ? insets.top : 0,
    paddingBottom: edges?.bottom === false ? 0 : insets.bottom,
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
