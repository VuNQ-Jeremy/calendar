import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '~/theme';
import { Body } from '~/ui';

export interface ChipOption {
  value: string;
  label: string;
}

/**
 * A one-of-many picker as a scrolling row of chips — the mobile stand-in for the web's `MSelect`.
 *
 * A native `<select>` has no React Native equivalent, and a modal picker for three options
 * (repeat: none / daily / weekly) is two taps where one will do. Long option sets — the class list —
 * scroll horizontally rather than wrap, so the field's height never depends on how many classes a
 * school has.
 *
 * Chips are `theme.touch` tall. They were 44dp on the theory that the row was the target, but a
 * dump sweep measured the chip's own bounds at 44dp — the row is not clickable, the chip is.
 */
export function ChipSelect({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: ChipOption[];
  onChange: (value: string) => void;
}) {
  const th = useTheme();

  return (
    <View style={{ gap: th.spacing[2] }}>
      {label ? (
        <Body style={{ fontFamily: th.font.bodyBold, fontSize: th.text.sm.fontSize }}>{label}</Body>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: th.spacing[2], paddingVertical: 2 }}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value || '__none__'}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.label}
              onPress={() => onChange(opt.value)}
              style={{
                minHeight: th.touch,
                justifyContent: 'center',
                paddingHorizontal: th.spacing[4],
                borderRadius: th.radius.pill,
                borderWidth: 1.5,
                borderColor: active ? th.color.brand : th.color.borderSubtle,
                backgroundColor: active ? th.color.brandSoft : th.color.surfaceCard,
              }}
            >
              <Body
                style={{
                  fontFamily: th.font.bodyBold,
                  fontSize: th.text.sm.fontSize,
                  color: active ? th.color.brandSoftInk : th.color.textBody,
                }}
                numberOfLines={1}
              >
                {opt.label}
              </Body>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
