import { Pressable, ScrollView, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '~/theme';

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value?: string;
  onChange?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * In-page segmented control (the web's `.mochi-tabs` pill), NOT the bottom tab bar — that is
 * expo-router's, in app/(staff)/_layout.tsx.
 *
 * Horizontally scrollable: four Vietnamese tab labels do not fit on a 360dp screen, and a
 * clipped tab is an unreachable tab.
 */
export function Tabs({ tabs, value, onChange, style }: TabsProps) {
  const th = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
      style={style}
    >
      <View
        style={{
          flexDirection: 'row',
          gap: th.spacing[1],
          padding: th.spacing[1],
          backgroundColor: th.color.surfaceSunken,
          borderRadius: th.radius.pill,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange?.(tab.id)}
              style={[
                {
                  minHeight: 40,
                  paddingHorizontal: th.spacing[4],
                  justifyContent: 'center',
                  borderRadius: th.radius.pill,
                  backgroundColor: active ? th.color.surfaceCard : 'transparent',
                },
                active ? th.shadow.xs : null,
              ]}
            >
              <Text
                style={{
                  fontFamily: th.font.bodyBold,
                  fontSize: th.text.sm.fontSize,
                  color: active ? th.color.textStrong : th.color.textMuted,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
