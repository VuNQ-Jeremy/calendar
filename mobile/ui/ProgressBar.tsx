import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';

export interface ProgressBarProps {
  /** 0-100. Clamped, so a caller dividing by zero cannot draw outside the track. */
  value?: number;
  color?: 'brand' | 'violet' | 'green' | 'blue';
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ value = 0, color = 'brand', style }: ProgressBarProps) {
  const th = useTheme();
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const fill = color === 'brand' ? th.color.brand : th.category[color].base;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(pct), min: 0, max: 100 }}
      style={[
        {
          height: 10,
          width: '100%',
          borderRadius: th.radius.pill,
          backgroundColor: th.color.surfaceSunken,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View
        style={{ height: '100%', width: `${pct}%`, borderRadius: th.radius.pill, backgroundColor: fill }}
      />
    </View>
  );
}
