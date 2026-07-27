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
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';

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
  const th = useTheme();

  // Belt and braces with app/index.tsx: a deep link straight into a tab must not render the
  // shell for a signed-out user.
  if (!user) return <Redirect href="/login" />;
  const staff = user.kind === 'staff';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: th.color.brand,
        tabBarInactiveTintColor: th.color.textMuted,
        tabBarStyle: {
          backgroundColor: th.color.surfaceCard,
          borderTopColor: th.color.borderSubtle,
          // The bar itself sits above the gesture bar; safe-area padding is handled by
          // react-navigation, but the height needs to clear a 48dp touch target.
          height: 60,
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarLabelStyle: { fontFamily: th.font.bodyBold, fontSize: 11 },
      }}
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
      <Tabs.Screen name="homework" options={{ href: null }} />
      <Tabs.Screen name="materials" options={{ href: null }} />
      <Tabs.Screen name="assessments" options={{ href: null }} />
      <Tabs.Screen name="feedback" options={{ href: null }} />
      <Tabs.Screen name="config" options={{ href: null }} />
      <Tabs.Screen name="language" options={{ href: null }} />
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
