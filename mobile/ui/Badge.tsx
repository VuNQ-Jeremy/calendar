import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';
import type { ColorIdKey } from '@mochi/shared/tokens';

/** `brand`, a ColorId, or a status name — mirrors the web's `.mochi-badge.is-*` set. */
export type BadgeColor = 'brand' | ColorIdKey | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  color?: string | null;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Badge({ color, style, children }: BadgeProps) {
  const th = useTheme();

  let bg: string = th.color.surfaceSunken;
  let fg: string = th.color.textBody;
  if (color === 'brand') {
    bg = th.color.brand;
    fg = '#FFFFFF';
  } else if (color === 'success') {
    bg = th.ramp.green[100];
    fg = th.ramp.green[700];
  } else if (color === 'warning') {
    bg = '#FBEFD0';
    fg = '#8a6512';
  } else if (color === 'danger') {
    bg = '#FBE3DD';
    fg = '#a23a25';
  } else if (color && color in th.category) {
    const cat = th.category[color as ColorIdKey];
    bg = cat.soft;
    fg = cat.ink;
  }

  return (
    <View style={[styles.base, { borderRadius: th.radius.pill, backgroundColor: bg }, style]}>
      <Text style={{ color: fg, fontFamily: th.font.bodyBold, fontSize: 11, letterSpacing: 0.4 }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 9,
    minWidth: 20,
    justifyContent: 'center',
  },
});
