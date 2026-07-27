import { forwardRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { useTheme, TOUCH } from '~/theme';

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  /** Rendered inside the field, before the text — e.g. a lucide mail icon. */
  iconLeft?: React.ReactNode;
  /** Rendered inside the field, after the text — e.g. a show-password IconButton. */
  iconRight?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, hint, error, iconLeft, iconRight, containerStyle, style, ...rest },
  ref,
) {
  const th = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? th.status.danger
    : focused
      ? th.color.borderFocus
      : th.color.borderStrong;

  return (
    <View style={[{ gap: th.spacing[2] }, containerStyle]}>
      {label ? (
        <Text
          style={{
            fontFamily: th.font.bodyBold,
            fontSize: th.text.sm.fontSize,
            color: th.color.textStrong,
          }}
        >
          {label}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: th.spacing[2],
          minHeight: TOUCH,
          paddingHorizontal: th.spacing[4],
          backgroundColor: rest.editable === false ? th.color.surfaceSunken : th.color.surfaceCard,
          borderWidth: 1.5,
          borderColor,
          borderRadius: th.radius.md,
        }}
      >
        {iconLeft}
        <TextInput
          ref={ref}
          placeholderTextColor={th.color.textDisabled}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              // Android centers text oddly without an explicit height + zero padding.
              height: TOUCH - 3,
              paddingVertical: 0,
              fontFamily: th.font.body,
              fontSize: th.text.base.fontSize,
              color: th.color.textStrong,
            },
            style,
          ]}
          {...rest}
        />
        {iconRight}
      </View>

      {error ? (
        <Text
          style={{
            fontFamily: th.font.bodyMedium,
            fontSize: th.text.xs.fontSize,
            color: th.status.danger,
          }}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text
          style={{
            fontFamily: th.font.body,
            fontSize: th.text.xs.fontSize,
            color: th.color.textMuted,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
