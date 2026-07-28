import { useQuery } from '@tanstack/react-query';
import { TAB_BAR_STYLES, type TabBarStyle } from '@mochi/shared/schemas';
import * as api from './endpoints';
import { qk } from './query';

/**
 * The school's UI preferences.
 *
 * Its own module rather than a hook in `staff-data.ts`, because that file is explicitly the staff
 * screens' reads and writes and this is read by the signed-in shell — which a student mounts too.
 * `/api/settings/ui-prefs` is `user`-level on GET for exactly that reason.
 *
 * A longer `staleTime` than the 30s default: the tab bar's shape is not data, it is chrome, and
 * refetching it every half minute on every screen change buys nothing. A change made in System
 * Config lands immediately on the admin's own device (the mutation writes the cache directly) and
 * within five minutes, or on the next cold start, everywhere else.
 */
export function useUiPrefs() {
  return useQuery({
    queryKey: qk.uiPrefs,
    queryFn: api.settings.getUiPrefs,
    staleTime: 5 * 60_000,
  });
}

/**
 * The tab-bar variant to render, narrowed to something `TabBar` can actually draw.
 *
 * Defends against three cases that all mean the same thing to the shell: the query has not
 * resolved yet (first ever launch, before the AsyncStorage cache exists), the request failed
 * offline, or the stored value is a variant this build does not know — a real possibility, since
 * the server accepts whatever ids ITS copy of `TAB_BAR_STYLES` lists and an installed APK can be
 * older than the Worker. All three fall back to 'pill' rather than rendering nothing.
 */
export function useTabBarStyle(): TabBarStyle {
  const { data } = useUiPrefs();
  const value = data?.mobileTabBar;
  return value && (TAB_BAR_STYLES as readonly string[]).includes(value) ? value : 'pill';
}
