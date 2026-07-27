import { Pressable, StyleSheet } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { useTheme, TOUCH } from '~/theme';

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  variant?: 'ghost' | 'solid';
  /**
   * `sm` shrinks the VISUAL to 36dp but keeps the touch target at 48 via hitSlop — the rule is
   * every tappable thing is at least 48x48dp, not every tappable thing looks 48dp.
   */
  size?: 'sm' | 'md';
  /** Required: an icon-only control with no label is invisible to a screen reader. */
  label: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function IconButton({
  variant = 'ghost',
  size = 'md',
  label,
  style,
  children,
  disabled,
  ...rest
}: IconButtonProps) {
  const th = useTheme();
  const box = size === 'sm' ? 36 : TOUCH;
  const slop = Math.max(0, (TOUCH - box) / 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={slop}
      style={({ pressed }) => [
        styles.base,
        {
          width: box,
          height: box,
          borderRadius: th.radius.pill,
          backgroundColor:
            variant === 'solid'
              ? pressed
                ? th.color.brandPress
                : th.color.brand
              : pressed
                ? th.color.surfaceSunken
                : 'transparent',
        },
        pressed ? styles.pressed : null,
        disabled ? styles.off : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.92 }] },
  off: { opacity: 0.5 },
});
