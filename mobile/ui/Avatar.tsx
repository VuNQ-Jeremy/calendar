import { Image, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';
import type { ColorIdKey } from '@mochi/shared/tokens';

const SIZES = { sm: 28, md: 40, lg: 56, xl: 88 } as const;

export interface AvatarProps {
  src?: string | null;
  name?: string;
  /** One of the six ColorId values; falls back to the cocoa neutral, as on the web. */
  color?: string | null;
  size?: keyof typeof SIZES;
  style?: StyleProp<ViewStyle>;
}

/** First letter of each of the first two words — same rule as the web Avatar. */
function initials(name?: string): string {
  if (!name) return '?';
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function Avatar({ src, name, color, size = 'md', style }: AvatarProps) {
  const th = useTheme();
  const dim = SIZES[size];
  const cat = color && color in th.category ? th.category[color as ColorIdKey] : null;

  return (
    <View
      style={[
        {
          width: dim,
          height: dim,
          borderRadius: th.radius.pill,
          backgroundColor: cat ? cat.soft : th.ramp.cocoa[100],
          borderWidth: 2,
          borderColor: th.color.surfaceCard,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        th.shadow.xs,
        style,
      ]}
    >
      {src ? (
        <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Text
          style={{
            color: cat ? cat.ink : th.ramp.cocoa[700],
            fontFamily: th.font.displayBold,
            fontSize: Math.round(dim * 0.4),
          }}
        >
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
