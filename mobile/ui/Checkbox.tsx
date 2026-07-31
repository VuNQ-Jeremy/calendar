import { Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme, TOUCH } from '~/theme';

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  /** Strikes the label through, as on the web's `.is-done` completed row. */
  done?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Checkbox({ checked, onChange, label, done, disabled, style }: CheckboxProps) {
  const th = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      // The box is 22dp like the web; hitSlop brings the target up to 48.
      hitSlop={13}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: th.spacing[3],
          minHeight: TOUCH,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          borderWidth: 1.5,
          borderColor: checked ? th.color.brand : th.color.borderStrong,
          backgroundColor: checked ? th.color.brand : th.color.surfaceCard,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Check size={15} color="#fff" strokeWidth={3} /> : null}
      </View>
      {label ? (
        <Text
          style={{
            flex: 1,
            fontFamily: th.font.body,
            fontSize: th.text.base.fontSize,
            color: done ? th.color.textMuted : th.color.textBody,
            textDecorationLine: done ? 'line-through' : 'none',
          }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
