import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';
import type { ColorIdKey } from '@mochi/shared/tokens';

export interface TagProps {
  /** One of the six ColorId values. Anything else falls back to the neutral sunken pill. */
  color?: string | null;
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Tag({ color, dot, style, children }: TagProps) {
  const th = useTheme();
  const cat = color && color in th.category ? th.category[color as ColorIdKey] : null;

  return (
    <View
      style={[
        styles.base,
        {
          gap: th.spacing[2],
          borderRadius: th.radius.pill,
          backgroundColor: cat ? cat.soft : th.color.surfaceSunken,
        },
        style,
      ]}
    >
      {dot ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: cat ? cat.base : th.ramp.taupe[400],
          }}
        />
      ) : null}
      <Text
        style={{
          color: cat ? cat.ink : th.color.textBody,
          fontFamily: th.font.bodyMedium,
          fontSize: th.text.xs.fontSize,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 12,
  },
});
