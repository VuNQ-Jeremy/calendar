import { Pressable, Switch as RNSwitch, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme, TOUCH } from '~/theme';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Wraps the platform Switch rather than reimplementing the web's 46x28 track. On Android the
 * native control carries the correct accessibility semantics and the user's own animation
 * preferences; the only thing worth overriding is the color, which comes from the tokens.
 */
export function Switch({ checked, onChange, label, disabled, style }: SwitchProps) {
  const th = useTheme();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: !!checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: th.spacing[3],
          minHeight: TOUCH,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {label ? (
        <Text
          style={{
            flex: 1,
            fontFamily: th.font.body,
            fontSize: th.text.base.fontSize,
            color: th.color.textBody,
          }}
        >
          {label}
        </Text>
      ) : null}
      <RNSwitch
        value={!!checked}
        onValueChange={(v) => onChange?.(v)}
        disabled={disabled}
        trackColor={{ false: th.ramp.sand[400], true: th.color.brand }}
        thumbColor="#FFFFFF"
      />
    </Pressable>
  );
}
