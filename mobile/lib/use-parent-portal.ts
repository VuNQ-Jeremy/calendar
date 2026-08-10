import { useQuery } from '@tanstack/react-query';
import * as api from './endpoints';
import { qk } from './query';
import { useAuth } from './auth';

/**
 * Whether the school has opened the parent portal.
 *
 * Its own module rather than a hook in `staff-data.ts` for the same reason as use-ui-prefs.ts:
 * that file is the staff screens' reads, and this is read by the signed-in shell — which decides
 * whether a parent gets a Children tab. `/api/settings/parent-portal` is `any`-level on GET
 * precisely so a parent may ask.
 *
 * Long `staleTime`, like the UI prefs: the presence of a tab is chrome, not data. An admin's flip
 * lands on other devices within five minutes or on the next cold start, which is the right
 * cadence for a setting that changes once.
 */
export function useParentPortal() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.parentPortal,
    queryFn: api.settings.getParentPortal,
    staleTime: 5 * 60_000,
    // Nobody but a parent renders anything from this, and a signed-out shell has no token.
    enabled: user?.kind === 'parent',
  });
}

/**
 * The flag, defaulting to CLOSED.
 *
 * Three cases collapse to the same answer: the query has not resolved yet (first launch, before
 * the AsyncStorage cache exists), the request failed offline, or the caller is not a parent. All
 * three hide the portal rather than showing a tab whose every endpoint would 403.
 */
export function useParentPortalEnabled(): boolean {
  const { data } = useParentPortal();
  return data?.enabled === true;
}
