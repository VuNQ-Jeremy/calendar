import { Pressable, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';

export interface CardProps {
  flat?: boolean;
  raised?: boolean;
  /** Renders as a Pressable. Supply onPress with it. */
  interactive?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Card({ flat, raised, interactive, onPress, style, children }: CardProps) {
  const th = useTheme();
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: th.color.surfaceCard,
      borderWidth: 1.5,
      borderColor: raised ? 'transparent' : th.color.borderSubtle,
      borderRadius: th.radius.lg,
      padding: th.spacing[6],
    },
    flat ? null : raised ? th.shadow.md : th.shadow.sm,
    style,
  ];

  if (interactive || onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [base, pressed ? { opacity: 0.9 } : null]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}
