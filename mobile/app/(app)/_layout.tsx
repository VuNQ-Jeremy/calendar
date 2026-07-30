import React from 'react';
import { Redirect, Tabs, usePathname } from 'expo-router';
import { Alert, BackHandler, type ColorValue } from 'react-native';
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
 * The tab bar's own screens, by URL. A tab is a ROOT: back on one leaves the app.
 *
 * Note what is NOT here. `/profile` is a root for a student (it is one of their two tabs) but a
 * pushed screen for staff (they reach it through More), which is exactly the split in the
 * `<Tabs.Screen name="profile">` options below — so the two lists have to stay in step with the
 * `href` values, not with the file tree.
 */
const STAFF_TAB_ROOTS = ['/dashboard', '/calendar', '/classes', '/flashcards', '/more'];
const STUDENT_TAB_ROOTS = ['/flashcards', '/profile'];

/**
 * Back on a tab is a dead end, not a hop to the tab you were on before — so it asks first.
 *
 * The tab router below runs `backBehavior="fullHistory"` so that the eleven detail screens — which
 * are hidden TABS rather than stack screens, see the note on the navigator — can find the screen
 * that opened them: More → People → back → More. The cost of that history is that it also records
 * plain tab switches, so Dashboard → Calendar → back would return to Dashboard. Tabs are roots;
 * that is wrong.
 *
 * So we intercept the press only while a tab's own URL is focused, confirm, and then hand it to
 * Android. Every other screen falls through to react-navigation untouched, which is what keeps the
 * nested stacks (`/classes/:id`, `/flashcards/:slug/...`) popping normally — their URLs are not in
 * the lists above, so this hook is inert there and back never asks anything.
 *
 * `Alert.alert` rather than a themed sheet: it is what every destructive confirm in this app already
 * uses (`classes/[id]/index.tsx`, `event/[id].tsx`, the three `people` editors), so it inherits the
 * platform's dialog, its dark mode and its accessibility for free. Exit is NOT marked `destructive`
 * — leaving loses no data, and that style is reserved for deletes here.
 *
 * `exitApp()` is a misleading name: it calls `invokeDefaultBackPressHandler`, i.e. MainActivity's
 * `invokeDefaultOnBackPressed` → `moveTaskToBack`. It backgrounds the task exactly as back on
 * Dashboard already did; it is NOT `finish()`, so the app stays warm in recents. That is also why
 * the dialog says "Exit" and not "Close without saving" — nothing is being thrown away.
 *
 * Registering later than the NavigationContainer is what gives this priority — RN calls
 * hardwareBackPress subscribers in reverse order of registration.
 */
function useTabRootsEndTheBackStack(kind: 'staff' | 'student' | undefined) {
  const pathname = usePathname();
  const { t } = useLang();
  const roots = kind === 'staff' ? STAFF_TAB_ROOTS : kind === 'student' ? STUDENT_TAB_ROOTS : [];
  const onTabRoot = roots.includes(pathname);
  /*
    One dialog at a time. A hardware button is easy to press twice, and Alert.alert queues rather
    than de-duplicates, so without this a double press stacks two identical dialogs and the user
    has to dismiss both. Every path out of the dialog — both buttons AND onDismiss — has to clear
    it, or the flag latches and back goes dead for the rest of the session.
  */
  const asking = React.useRef(false);

  React.useEffect(() => {
    if (!onTabRoot) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!asking.current) {
        asking.current = true;
        Alert.alert(
          t('m_exit_q'),
          undefined,
          [
            { text: t('cancel'), style: 'cancel', onPress: () => void (asking.current = false) },
            {
              text: t('m_exit'),
              onPress: () => {
                asking.current = false;
                BackHandler.exitApp();
              },
            },
          ],
          // cancelable so a tap outside or a second back press dismisses it, which is what the
          // rest of Android does. onDismiss covers exactly those two, which fire no button.
          { cancelable: true, onDismiss: () => void (asking.current = false) },
        );
      }
      return true;
    });
    return () => {
      sub.remove();
      // Belt and braces on the latch. If this effect is torn down while the dialog is still up —
      // a push-notification route change is the realistic way — nothing would ever fire its
      // handlers, so the flag would stay set and swallow every later press on a tab root.
      asking.current = false;
    };
  }, [onTabRoot, t]);
}

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

  // Above the early return, like the three hooks before it: hook order cannot depend on `user`.
  // Passing undefined while signed out leaves it inert.
  useTabRootsEndTheBackStack(user?.kind);

  // Belt and braces with app/index.tsx: a deep link straight into a tab must not render the
  // shell for a signed-out user.
  if (!user) return <Redirect href="/login" />;
  const staff = user.kind === 'staff';

  return (
    <Tabs
      /*
        This history exists for the DETAIL screens, not for the tab bar.

        The eleven `href: null` screens at the bottom of this file are SIBLING TABS, not stack
        screens. `router.push` to a sibling tab is downgraded to a tab NAVIGATE
        (expo-router/build/global-state/getNavigationAction.js:51-53), so those pushes never build
        a stack for back to pop — More → People goes through the TAB history or nowhere at all.

        The default `backBehavior: 'firstRoute'` does NOT keep a history: on every navigation
        TabRouter.changeIndex rewrites it as [routes[0], current] (TabRouter.js:34-41, :86).
        routes[0] is `dashboard`, declared first below, so back went to Dashboard from
        everywhere — from every More row, from Calendar → event, from event → grade homework —
        and the screen you came from was unreachable.

        `fullHistory` rather than `history` because `history` de-duplicates, keeping each route at
        most once (TabRouter.js:63-66); revisiting a screen then drops the earlier visit and back
        stops retracing what happened. `fullHistory` appends every visit (:67-83).

        It also closes a role leak: `firstRoute` unshifted routes[0] into a STUDENT's history too
        (`dashboard` is hidden for them via `href: null`, not removed), so back from Flashcards
        opened the staff Dashboard — a screen of staff-only queries. `fullHistory` never unshifts
        routes[0]. dashboard.tsx guards itself as well; both are wanted.

        Because this history also records plain tab switches, and a tab is a root rather than a
        step, useTabRootsEndTheBackStack above stops the press before it reaches this router
        whenever a tab's own URL is focused. `backBehavior="none"` would be the declarative way to
        say that, but it would apply to the eleven detail screens too and strand them.

        Back inside the nested Stack layouts (classes, people, homework, materials, flashcards,
        event, material) is unaffected — a nested stack consumes GO_BACK before it reaches here.
      */
      backBehavior="fullHistory"
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
