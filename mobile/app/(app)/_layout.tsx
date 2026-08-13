import React from 'react';
import { Redirect, Tabs, usePathname } from 'expo-router';
import { BackHandler, type ColorValue } from 'react-native';
import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  Home,
  Layers,
  MoreHorizontal,
  UserRound,
  Users,
} from 'lucide-react-native';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { ExitConfirmDialog } from '~/components/ExitConfirmDialog';
import { killApp } from '~/modules/app-exit';
import { TabBar } from '~/components/TabBar';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { usePushRegistration, useNotificationRouting } from '~/lib/push';
import { useSync } from '~/lib/use-sync';
import { useTabBarStyle } from '~/lib/use-ui-prefs';
import { useParentPortalEnabled } from '~/lib/use-parent-portal';

/**
 * The tab bar's own screens, by URL. A tab is a ROOT: back on one leaves the app.
 *
 * Note what is NOT here. `/profile` is a root for a student (it is one of their two tabs) but a
 * pushed screen for staff (they reach it through More), which is exactly the split in the
 * `<Tabs.Screen name="profile">` options below — so the two lists have to stay in step with the
 * `href` values, not with the file tree.
 */
const STAFF_TAB_ROOTS = ['/dashboard', '/calendar', '/classes', '/vocabulary', '/more'];
const STUDENT_TAB_ROOTS = ['/vocabulary', '/schedule', '/profile'];
/**
 * A parent has one tab, or two once an admin opens the portal — so the list is computed from the
 * flag rather than fixed. Getting this wrong strands back on a tab that is no longer a root.
 */
const parentTabRoots = (portalOn: boolean) => (portalOn ? ['/children', '/profile'] : ['/profile']);

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
 * nested stacks (`/classes/:id`, `/vocabulary/:slug/...`) popping normally — their URLs are not in
 * the lists above, so this hook is inert there and back never asks anything.
 *
 * The dialog is ExitConfirmDialog (components/ExitConfirmDialog.tsx) — the design-system card, not
 * the native Alert this started as. That swap also deleted a whole class of bookkeeping:
 * `Alert.alert` QUEUES duplicate dialogs, so the old code carried a ref latch that every exit path
 * had to clear or back went dead for the session. `setAsking(true)` is idempotent, so a double
 * press just shows the one dialog. And while the Modal is visible, Android hands the back press to
 * the Modal natively (arriving as `onRequestClose` → cancel), so this subscription cannot re-fire.
 *
 * Exit KILLS the app — `killApp()` (modules/app-exit) is `finishAndRemoveTask` plus a process
 * kill, so the task leaves recents and nothing stays warm. It used to be `BackHandler.exitApp()`,
 * which despite the name only `moveTaskToBack`s (backgrounds); the user asked for Exit to mean
 * exit, and on binaries too old to carry the native module killApp() still falls back to that
 * backgrounding. Killing still discards nothing durable — the offline outbox and query cache are
 * persisted — which is why the button stays `primary` rather than `danger`.
 *
 * Registering later than the NavigationContainer is what gives this priority — RN calls
 * hardwareBackPress subscribers in reverse order of registration.
 */
function useTabRootsEndTheBackStack(
  kind: 'staff' | 'student' | 'parent' | undefined,
  parentPortalOn: boolean,
) {
  const pathname = usePathname();
  const roots =
    kind === 'staff'
      ? STAFF_TAB_ROOTS
      : kind === 'student'
        ? STUDENT_TAB_ROOTS
        : kind === 'parent'
          ? parentTabRoots(parentPortalOn)
          : [];
  const onTabRoot = roots.includes(pathname);
  const [asking, setAsking] = React.useState(false);

  React.useEffect(() => {
    if (!onTabRoot) {
      // The route can change under an open dialog — a tapped push notification navigates to
      // /event/:id from anywhere. "Leave from this tab?" no longer applies, so withdraw the
      // question rather than leaving a stale dialog floating over the new screen.
      setAsking(false);
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setAsking(true);
      return true;
    });
    return () => sub.remove();
  }, [onTabRoot]);

  return {
    askingExit: asking,
    cancelExit: () => setAsking(false),
    confirmExit: () => {
      // Hide first, then kill. On the old-binary fallback (which only backgrounds) the task is
      // resumed later exactly as it was left, and it should come back showing the tab — not a
      // dialog still asking whether to leave it.
      setAsking(false);
      killApp();
    },
  };
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
 *             students to /vocabulary, so those are the only two places they can be.
 *   Parent  — 1 tab: Profile. Plus Children once an admin opens the parent portal in System
 *             Config, which is the only tab in here gated on a setting rather than a role.
 *
 * ONE tab group, with per-role hiding via `href: null`, rather than a (staff) and a (student)
 * group. Two groups would both want to own `/vocabulary`, and expo-router resolves group
 * routes to the same URL — a genuine collision, not a style preference.
 */
export default function AppLayout() {
  const { user } = useAuth();
  const { t } = useLang();
  // Chosen by an admin in System Config, school-wide. Falls back to 'pill' until the value has
  // been fetched once — after that the query cache is persisted to AsyncStorage, so a cold start
  // renders the right variant immediately, offline included.
  const tabBarVariant = useTabBarStyle();
  // Whether this parent gets a Children tab. Inert for staff and students (the query is disabled
  // for them), and false until resolved — a tab whose endpoints would 403 must not appear.
  const parentPortalOn = useParentPortalEnabled();

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
  const { askingExit, cancelExit, confirmExit } = useTabRootsEndTheBackStack(
    user?.kind,
    parentPortalOn,
  );

  // Belt and braces with app/index.tsx: a deep link straight into a tab must not render the
  // shell for a signed-out user.
  if (!user) return <Redirect href="/login" />;
  const staff = user.kind === 'staff';
  // A parent has neither the staff tabs nor the student's learning ones — Profile is the
  // whole app, and the endpoints behind Vocabulary and Schedule return 403 for them.
  const parent = user.kind === 'parent';

  return (
    <>
      <Tabs
        /*
          This history exists for the DETAIL screens, not for the tab bar.

          The ten `href: null` screens at the bottom of this file are SIBLING TABS, not stack
          screens. `router.push` to a sibling tab is downgraded to a tab NAVIGATE
          (expo-router/build/global-state/getNavigationAction.js:51-53), so those pushes never build
          a stack for back to pop — More → People goes through the TAB history or nowhere at all.

          The default `backBehavior: 'firstRoute'` does NOT keep a history: on every navigation
          TabRouter.changeIndex rewrites it as [routes[0], current] (TabRouter.js:34-41, :86).
          routes[0] is `dashboard`, declared first below, so back went to Dashboard from
          everywhere — from every More row, from Calendar → event, from event → material —
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
          say that, but it would apply to the ten detail screens too and strand them.

          Back inside the nested Stack layouts (classes, people, materials, vocabulary,
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
          (expo-router/build/react-navigation/bottom-tabs/views/BottomTabView.js:154), so this
          inline arrow is not the remount hazard that an inline `tabBarIcon` would be — the
          component whose identity React reconciles is the module-scope TabBar.
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
          name="vocabulary"
          options={{
            title: t('nav_flashcards'),
            href: parent ? null : undefined,
            tabBarIcon: TabIconCards,
          }}
        />
        <Tabs.Screen
          name="schedule"
          options={{
            title: t('sched_title'),
            // The mirror of `profile` below: a tab for students, nothing for staff, who reach the
            // same sessions through the calendar, and nothing for parents.
            href: staff || parent ? null : undefined,
            tabBarIcon: TabIconSchedule,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{ title: t('m_more'), href: staff ? undefined : null, tabBarIcon: TabIconMore }}
        />
        <Tabs.Screen
          name="children"
          options={{
            title: t('nav_children'),
            // The only parent-ONLY tab, and the only one gated on a setting rather than a role:
            // hidden until an admin opens the portal, at which point every endpoint behind it
            // starts answering. Declared before `profile` so it is the parent's first tab.
            href: parent && parentPortalOn ? undefined : null,
            tabBarIcon: TabIconChildren,
          }}
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
        <Tabs.Screen name="materials" options={{ href: null }} />
        <Tabs.Screen name="assessments" options={{ href: null }} />
        <Tabs.Screen name="feedback" options={{ href: null }} />
        <Tabs.Screen name="config" options={{ href: null }} />
        <Tabs.Screen name="language" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
        {/* The parent portal's pushed detail: one child, one month. */}
        <Tabs.Screen name="child" options={{ href: null }} />
      </Tabs>
      {/*
        A sibling of the navigator, not a screen in it. An RN Modal renders into its own native
        window, so where it sits in the tree does not affect what it covers — keeping it outside
        the Tabs means it is not a route and cannot be navigated to.
      */}
      <ExitConfirmDialog visible={askingExit} onCancel={cancelExit} onExit={confirmExit} />
    </>
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
// A clock, not the plain calendar staff get: this list is "what is coming up", not a month grid.
const TabIconSchedule = ({ color, size }: IconArgs) => (
  <CalendarClock color={hex(color)} size={size} />
);
// Plural, unlike Profile's single figure: a parent's tab is about the children, not themselves.
const TabIconChildren = ({ color, size }: IconArgs) => <Users color={hex(color)} size={size} />;
