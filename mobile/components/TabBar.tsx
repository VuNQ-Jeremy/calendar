import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TabBarStyle } from '@mochi/shared/schemas';
// Type-only, and it has to be this deep path: expo-router VENDORS react-navigation (there is no
// `@react-navigation/bottom-tabs` in node_modules to import from, and installing one would give
// us a second copy at a different version). `import type` is erased at compile time, so Metro
// never resolves this — only tsc reads it. If an expo-router upgrade moves the file, typecheck
// fails loudly and the fix is this one line.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { useTheme, TOUCH } from '~/theme';

/**
 * The bottom tab bar. Replaces react-navigation's default one.
 *
 * ## Why a custom bar at all
 *
 * Two reasons, and the second is a bug fix.
 *
 * 1. Branding. The default bar can be tinted but not shaped: no outlined-pill active state, no
 *    floating dock, no top indicator. Those are the three variants an admin picks between in
 *    System Config (`uiPrefs.mobileTabBar`).
 * 2. Safe area. The old `screenOptions.tabBarStyle` set `height: 60`, and a NUMERIC height makes
 *    the vendored bar skip its own inset math entirely —
 *    `expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar.js:100-113` returns the
 *    custom height verbatim instead of adding `insets.bottom`, and the user's `tabBarStyle` is
 *    merged LAST (:250-257), so it also overwrote the library's `paddingBottom: insets.bottom`.
 *    The result was icons and labels drawn underneath Android's navigation bar — badly under a
 *    48dp three-button row, marginally under a gesture pill. Nothing here sets a height: every
 *    variant's height is intrinsic, so the inset can only ever be added to it.
 *
 * ## How the bar knows about the phone's home buttons
 *
 * It does not need to ask. `insets.bottom` IS the answer — the system reports ~48dp for a
 * three-button navigation row, ~16-24dp for a gesture pill, and 0 when neither is present (or the
 * bar is hidden). Reading it covers every mode, including a user switching modes while the app is
 * running, which any hardcoded constant or "is it a gesture phone" heuristic would not.
 *
 * The insets arrive as a prop: `BottomTabView` already reads them from
 * `SafeAreaInsetsContext` and passes them in, honouring the navigator's `safeAreaInsets` override
 * if one is ever set. Calling `useSafeAreaInsets()` here would work but would ignore that
 * override.
 *
 * ## Layout
 *
 * All three variants stay in NORMAL layout flow. `BottomTabView` is a flex column — scenes
 * `flex: 1`, then the bar — so an intrinsically-sized bar reserves its own space and scene
 * content can never end up underneath it. The dock variant "floats" by sitting inside a
 * page-coloured strip, not by `position: 'absolute'`, which is what keeps every screen free of
 * bottom-padding bookkeeping. (Corollary: `useBottomTabBarHeight()` is NOT reliable with a custom
 * bar — the height callback is never invoked, so it keeps the library's estimate. Nothing reads
 * it today; nothing should start.)
 */

export type { TabBarStyle };

export interface TabBarProps extends BottomTabBarProps {
  variant?: TabBarStyle;
}

/** Icon edge, in dp. Matches the 24 the default bar passes to `tabBarIcon`. */
const ICON = 24;

export function TabBar({ state, descriptors, navigation, insets, variant = 'pill' }: TabBarProps) {
  const th = useTheme();

  /**
   * Only the routes that are actually tabs.
   *
   * This navigator registers ~12 pushed detail screens (`people`, `event`, `config`, …) plus the
   * per-role `href: null` hiding of Dashboard/Calendar/Classes/More/Profile. expo-router encodes
   * `href: null` as `tabBarItemStyle: { display: 'none' }`
   * (`expo-router/build/layouts/TabsClient.js:24`), which is the only signal it leaves behind — so
   * that is what gets filtered on. Getting this wrong is loud rather than subtle: seventeen tabs
   * appear.
   */
  const tabs = state.routes.filter((route) => {
    const descriptor = descriptors[route.key];
    if (!descriptor) return false;
    const itemStyle = StyleSheet.flatten(descriptor.options.tabBarItemStyle);
    return itemStyle?.display !== 'none';
  });

  // Matched by key, NOT by index into `tabs` — `state.index` counts the hidden routes, so the two
  // numbering schemes disagree the moment anything is filtered out. While a pushed screen is
  // focused no tab is active, which is exactly what the default bar did.
  const focusedKey = state.routes[state.index]?.key;

  const items = tabs.map((route) => {
    const { options } = descriptors[route.key];
    const focused = route.key === focusedKey;

    return (
      <TabItem
        key={route.key}
        variant={variant}
        focused={focused}
        label={options.title ?? route.name}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? options.title ?? route.name}
        testID={options.tabBarButtonTestID}
        icon={options.tabBarIcon}
        onPress={() => {
          // No haptic here by design: a tab press is a navigation, and the screen change is its own
          // feedback. (Haptics stay where the gesture has no other confirmation — drag-reorder and
          // the flashcard games.)
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          // `navigation.navigate`, not a CommonActions dispatch: react-navigation is vendored
          // inside expo-router, so its action creators are not importable. The helper does the
          // same thing.
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
      />
    );
  });

  /**
   * dock — a rounded card inside a page-coloured strip.
   *
   * The one variant whose bottom padding ADDS the inset instead of maxing against it: a dock that
   * floats has to have visible space beneath it, and on a three-button phone that space is below
   * the system row, not shared with it.
   */
  if (variant === 'dock') {
    return (
      <View
        style={{
          backgroundColor: th.color.bgPage,
          paddingHorizontal: th.spacing[4],
          paddingTop: th.spacing[2],
          paddingBottom: insets.bottom + th.spacing[2],
        }}
      >
        <View
          style={[
            styles.row,
            th.shadow.md,
            {
              justifyContent: 'center',
              backgroundColor: th.color.surfaceCard,
              borderRadius: th.radius.xl,
              borderWidth: 1,
              borderColor: th.color.borderSubtle,
              paddingVertical: th.spacing[1],
              paddingHorizontal: th.spacing[2],
            },
          ]}
        >
          {items}
        </View>
      </View>
    );
  }

  const pill = variant === 'pill';

  return (
    <View
      style={[
        styles.row,
        {
          // pill sits on white and declares its edge with a hairline; indicator blends into the
          // page and lets the active tab's 3dp line be the only thing marking the boundary.
          backgroundColor: pill ? th.color.surfaceCard : th.color.bgPage,
          borderTopWidth: pill ? StyleSheet.hairlineWidth : 0,
          borderTopColor: th.color.borderSubtle,
          paddingTop: pill ? th.spacing[2] : 0,
          // Max, not sum: where the system draws a gesture pill, that inset IS the breathing room
          // and stacking another 8dp on top only makes the bar tall for no reason.
          paddingBottom: Math.max(insets.bottom, th.spacing[2]),
        },
      ]}
    >
      {items}
    </View>
  );
}

/**
 * One tab. Module scope, so its identity is stable across renders of the bar.
 *
 * `icon` is the screen's own `tabBarIcon` option — the module-scope `TabIcon*` components in
 * `app/(app)/_layout.tsx`, called exactly as the default bar calls them.
 */
function TabItem({
  variant,
  focused,
  label,
  accessibilityLabel,
  testID,
  icon,
  onPress,
  onLongPress,
}: {
  variant: TabBarStyle;
  focused: boolean;
  label: string;
  accessibilityLabel: string;
  testID?: string;
  icon: BottomTabBarProps['descriptors'][string]['options']['tabBarIcon'];
  onPress: () => void;
  onLongPress: () => void;
}) {
  const th = useTheme();
  const color = focused ? th.color.brand : th.color.textMuted;
  const glyph = icon?.({ focused, color, size: ICON });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.item,
        variant === 'dock' && styles.dockItem,
        pressed && styles.pressed,
      ]}
    >
      {/* indicator: a 3dp brand line above the active tab, and the bar's top edge for all of them */}
      {variant === 'indicator' ? (
        <View
          style={{
            height: 3,
            width: th.spacing[8],
            borderRadius: th.radius.pill,
            backgroundColor: focused ? th.color.brand : 'transparent',
          }}
        />
      ) : null}

      {/* pill: an outlined lozenge around the active icon — no fill, and the ring takes the icon's
          own colour, so the active state reads as one brand-coloured unit against the bar. RN puts
          the border INSIDE the box, so the 56x32 footprint is identical focused or not. */}
      {variant === 'pill' ? (
        <View
          style={{
            width: 56,
            height: 32,
            borderRadius: th.radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: focused ? color : 'transparent',
          }}
        >
          {glyph}
        </View>
      ) : (
        glyph
      )}

      <Text
        numberOfLines={1}
        // The bar grows with the system font scale (every height here is a minHeight), but a 2x
        // accessibility setting would otherwise hand a third of the screen to navigation.
        maxFontSizeMultiplier={1.3}
        style={{
          fontFamily: th.font.bodyBold,
          fontSize: 11,
          color,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  item: {
    flex: 1,
    // Required for the label's ellipsis: without it a long translation makes the flex child wider
    // than its share instead of truncating.
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    // minHeight, never height — see maxFontSizeMultiplier above. Clears the 48dp Material floor.
    minHeight: TOUCH + 4,
  },
  /**
   * A student sees two tabs, not five. Stretched across a full-width dock they read as two vast
   * empty halves, so cap the width and let the row centre them; five staff tabs on any normal
   * phone are narrower than the cap and unaffected.
   */
  dockItem: { maxWidth: 168 },
  pressed: { transform: [{ scale: 0.96 }] },
});
