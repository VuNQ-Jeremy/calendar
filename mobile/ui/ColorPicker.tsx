import { Pressable, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '~/theme';
import { Body } from './Type';
import type { ColorIdValue } from '~/lib/types';

/**
 * The six-swatch category colour picker — the RN counterpart of `ColorPicker` in src/ui.tsx.
 *
 * The six values are a DATA contract, not a styling choice: they are stored in the database on
 * staff, students, classes, events and flashcard topics. Adding a seventh here without adding it
 * to `ColorId` in shared/schemas.ts would fail validation server-side.
 */
export const COLOR_IDS: ColorIdValue[] = ['violet', 'green', 'blue', 'orange', 'cocoa', 'rose'];

export function ColorPicker({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: ColorIdValue;
  onChange: (v: ColorIdValue) => void;
}) {
  const th = useTheme();

  return (
    <View style={{ gap: th.spacing[2] }}>
      {label ? (
        <Body style={{ fontFamily: th.font.bodyBold, fontSize: th.text.sm.fontSize }}>{label}</Body>
      ) : null}
      <View style={{ flexDirection: 'row', gap: th.spacing[3], flexWrap: 'wrap' }}>
        {COLOR_IDS.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === c }}
            accessibilityLabel={c}
            onPress={() => onChange(c)}
            // The swatch is 40dp; hitSlop takes the touch target to the 48dp floor.
            hitSlop={4}
            style={{
              width: 40,
              height: 40,
              borderRadius: th.radius.pill,
              backgroundColor: th.category[c].base,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 3,
              borderColor: value === c ? th.color.textStrong : 'transparent',
            }}
          >
            {value === c ? <Check size={20} color="#fff" strokeWidth={3} /> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
