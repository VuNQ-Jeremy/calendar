import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import { useTheme, TOUCH } from '~/theme';

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger';
export type BtnSize = 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  variant?: BtnVariant;
  /**
   * No `sm`. The web DS has a 36px `is-sm` variant; 36dp is below the Android touch floor and
   * is deliberately not ported. If you need something visually smaller, use IconButton with
   * hitSlop.
   */
  size?: BtnSize;
  block?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  disabled,
  iconLeft,
  iconRight,
  style,
  children,
  ...rest
}: ButtonProps) {
  const th = useTheme();
  const off = disabled || loading;

  const bg: Record<BtnVariant, string> = {
    primary: th.color.brand,
    secondary: th.color.surfaceCard,
    ghost: 'transparent',
    soft: th.color.brandSoft,
    danger: th.status.danger,
  };
  const press: Record<BtnVariant, string> = {
    primary: th.color.brandPress,
    secondary: th.color.surfaceHover,
    ghost: th.color.surfaceSunken,
    soft: th.ramp.orange[200],
    danger: th.status.danger,
  };
  const fg: Record<BtnVariant, string> = {
    primary: th.color.textOnBrand,
    secondary: th.color.textStrong,
    ghost: th.color.textBody,
    soft: th.color.brandSoftInk,
    danger: '#FFFFFF',
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      style={({ pressed }) => [
        styles.base,
        {
          height: size === 'lg' ? 52 : TOUCH, // 48, not the web's 44 — Android's floor
          paddingHorizontal: size === 'lg' ? th.spacing[8] : th.spacing[5],
          borderRadius: th.radius.pill,
          backgroundColor: pressed && !off ? press[variant] : bg[variant],
          borderColor: variant === 'secondary' ? th.color.borderStrong : 'transparent',
          gap: th.spacing[2],
        },
        variant === 'primary' || variant === 'danger' ? th.shadow.sm : null,
        block ? styles.block : null,
        off ? styles.off : null,
        // The web scales to 0.96 on :active; same gesture feedback here.
        pressed && !off ? styles.pressed : null,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg[variant]} />
      ) : (
        <>
          {iconLeft ? <View>{iconLeft}</View> : null}
          <Text
            numberOfLines={1}
            style={{
              color: fg[variant],
              fontFamily: th.font.bodyBold,
              fontSize: size === 'lg' ? th.text.base.fontSize : th.text.sm.fontSize,
            }}
          >
            {children}
          </Text>
          {iconRight ? <View>{iconRight}</View> : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    alignSelf: 'flex-start',
  },
  block: { alignSelf: 'stretch', width: '100%' },
  off: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.96 }] },
});
