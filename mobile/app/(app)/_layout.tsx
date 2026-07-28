import { Redirect, Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import {
  BookOpen,
  CalendarDays,
  Home,
  Layers,
  MoreHorizontal,
  UserRound,
} from 'lucide-react-native';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { TabBar } from '~/components/TabBar';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { usePushRegistration, useNotificationRouting } from '~/lib/push';
import { useSync } from '~/lib/use-sync';
import { useTabBarStyle } from '~/lib/use-ui-prefs';

/**
 * The signed-in shell.
 *
 * This is the mobile answer to the drawer the web app deferred (`src/styles/app.css:423`:
 * "Full mobile nav/drawer is future work."). The 260px sidebar and the 64px icon rail are NOT
 * ported — a phone gets bottom tabs.
 *
 *   Staff   — 5 tabs: Dashboard, Calendar, Classes, Flashcards, More. Five is the practical
 *             maximum; everything else lives behind More.
 *   Student — 2 tabs: Flashcards, Profile. Mirrors the server exactly: `requireStaff` bounces
 *             students to /flashcards, so those are the only two places they can be.
 *
 * ONE tab group, with per-role hiding via `href: null`, rather than a (staff) and a (student)
 * group. Two groups would both want to own `/flashcards`, and expo-router resolves group
 * routes to the same URL — a genuine collision, not a style preference.
 */
export default function AppLayout() {
  const { user } = useAuth();
  const { t } = useLang();
  // Chosen by an admin in System Config, school-wide. Falls back to 'pill' until the value has
  // been fetched once — after that the query cache is persisted to AsyncStorage, so a cold start
  // renders the right variant immediately, offline included.
  const tabBarVariant = useTabBarStyle();

  // Flushes the offline outbox and refreshes downloaded topics on foreground and on reconnect.
  // Mounted here rather than in the root layout so it only runs for a signed-in user — a flush
  // with no token would 401 and burn an attempt on every queued result.
  useSync(!!user);

  // Phase 6. Re-registers the Expo token on every sign-in (tokens rotate, and one handset can
  // serve several accounts) — but only if permission was already granted. It never prompts:
  // the ask belongs somewhere the user has context for it, not at launch.
  usePushRegistration(!!user);
  // A tapped notification opens the event, assignment or topic it is about. Mounted here, inside
  // the signed-in shell, so a deep link can never push a screen behind a login gate.
  useNotificationRouting(!!user);

  // Belt and braces with app/index.tsx: a deep link straight into a tab must not render the
  // shell for a signed-out user.
  if (!user) return <Redirect href="/login" />;
  const staff = user.kind === 'staff';

  return (
    <Tabs
      /*
        A custom bar — components/TabBar.tsx explains why at length, but the short version is that
        it owns both the branding (three admin-selectable variants) and the safe-area padding that
        the old `tabBarStyle: { height: 60 }` was silently defeating, leaving the tabs underneath
        Android's navigation buttons.

        The bar's own tint/height/label options are gone with it: they configured the default bar,
        which no longer renders. TabBar reads the design tokens directly instead of laundering two
        of them through navigator options.

        `tabBar` is CALLED, not mounted as an element type
        (expo-router/build/react-navigation/bottom-tabs/views/BottomTabView.js:154), so this inline
        arrow is not the remount hazard that an inline `tabBarIcon` would be — the component whose
        identity React reconciles is the module-scope TabBar.
      */
      tabBar={(props: BottomTabBarProps) => <TabBar {...props} variant={tabBarVariant} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('nav_dashboard'),
          href: staff ? undefined : null,
          tabBarIcon: TabIconHome,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('nav_calendar'),
          href: staff ? undefined : null,
          tabBarIcon: TabIconCalendar,
        }}
      />
      <Tabs.Screen
        name="classes"
        options={{
          title: t('nav_classes'),
          href: staff ? undefined : null,
          tabBarIcon: TabIconClasses,
        }}
      />
      <Tabs.Screen
        name="flashcards"
        options={{ title: t('nav_flashcards'), tabBarIcon: TabIconCards }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: t('m_more'), href: staff ? undefined : null, tabBarIcon: TabIconMore }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('prof_title'),
          // Staff reach Profile through More, so it is not one of their five tabs. For a
          // student it IS a tab — they have nowhere else to go.
          href: staff ? null : undefined,
          tabBarIcon: TabIconProfile,
        }}
      />

      {/* Pushed detail screens: reachable from More, never in the tab bar. */}
      <Tabs.Screen name="people" options={{ href: null }} />
      {/*
        Phase 4's pushed routes. `attendance` is a route of its own rather than a screen inside
        the calendar stack because the dashboard deep-links straight into it — that shortcut is
        what makes marking a register two taps from a cold launch.
      */}
      <Tabs.Screen name="attendance" options={{ href: null }} />
      <Tabs.Screen name="event" options={{ href: null }} />
      <Tabs.Screen name="material" options={{ href: null }} />
      <Tabs.Screen name="homework" options={{ href: null }} />
      <Tabs.Screen name="materials" options={{ href: null }} />
      <Tabs.Screen name="assessments" options={{ href: null }} />
      <Tabs.Screen name="feedback" options={{ href: null }} />
      <Tabs.Screen name="config" options={{ href: null }} />
      <Tabs.Screen name="language" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}

/**
 * Tab icons as module-scope components.
 *
 * NOT inline arrows in `options`. An arrow function in options is a new component identity on
 * every render of this layout, and react-navigation remounts the screen behind it — the exact
 * remount trap CLAUDE.md warns about.
 */
// react-navigation types `color` as ColorValue (it may be an opaque platform color). The tint
// values we actually pass come from the tokens and are always hex strings, so narrowing to
// what lucide accepts is safe here.
type IconArgs = { color: ColorValue; size: number };
const hex = (c: ColorValue) => c as string;

const TabIconHome = ({ color, size }: IconArgs) => <Home color={hex(color)} size={size} />;
const TabIconCalendar = ({ color, size }: IconArgs) => (
  <CalendarDays color={hex(color)} size={size} />
);
const TabIconClasses = ({ color, size }: IconArgs) => <BookOpen color={hex(color)} size={size} />;
const TabIconCards = ({ color, size }: IconArgs) => <Layers color={hex(color)} size={size} />;
const TabIconMore = ({ color, size }: IconArgs) => (
  <MoreHorizontal color={hex(color)} size={size} />
);
const TabIconProfile = ({ color, size }: IconArgs) => <UserRound color={hex(color)} size={size} />;
