import React from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useFetcher,
  useNavigation,
  useRevalidator,
  useLocation,
  isRouteErrorResponse,
  useRouteError,
} from 'react-router';
import { redirect } from 'react-router';
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from 'react-router';
import { cacheGet, subscribe } from '../../src/lib/cache.js';
import { cacheKeyForPath } from '../../src/lib/route-cache.js';
import { startLive, isLiveLayoutRefreshPending } from '../../src/lib/live.js';
import { DS } from '../../src/ds/index.js';
import { MIcon } from '../../src/icons.jsx';
import {
  NAV,
  visibleItems,
  activeSectionFor,
  rollupCount,
  useCollapsedSections,
} from '../../src/lib/sidebar-nav.jsx';
import { FeedbackModal, newFeedbackDraft } from '../../src/feedback.jsx';
import { DevInspector } from '../../src/dev-inspector.jsx';
import { useLang, LanguageToggle } from '../../src/lib/i18n.jsx';
import { VersionStamp } from '../../src/components/version-stamp.jsx';
import { BUILD_ID } from '../../src/lib/build-id.js';
import { useTrackNavigation } from '../../src/lib/track.js';
import { tenantDbFor } from '../../server/db/index';
import * as feedbackSvc from '../../server/services/feedback';
import * as invitesSvc from '../../server/services/invites';
import * as uiPrefsSvc from '../../server/services/ui-prefs';
import * as testsSvc from '../../server/services/tests';
import * as flashcardsSvc from '../../server/services/flashcards';
import { ictDateOf } from '../../shared/logic/tests';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import { getParentPortal } from '../../server/services/parent-portal';
import { getCheckinSettings } from '../../server/services/checkin';

const { Avatar: ShAv, Badge: ShBadge } = DS;

const DEV_ACCOUNT_EMAIL = 'dev@mochi.edu';

const TWEAKS = {
  accent: '#F79A4E',
  sidebar: 'regular',
  rounding: 'soft',
  density: 'regular',
};

/**
 * The pages inside this layout a parent may open. Everything else here is either a
 * staff tool or a student's own learning surface; the child loaders that guard themselves
 * do it with `kind === 'staff' ? … : …`, which would silently serve a parent the student
 * view. One rule at the layout, rather than a parent branch in fourteen loaders.
 *
 * `PARENT_BASE` is unconditional — a parent always has their own profile. The portal
 * prefixes open only while an admin has the toggle on, which is what makes the switch a
 * real gate rather than a way to hide a nav link.
 */
const PARENT_BASE = ['/profile'];
const PARENT_PORTAL_PREFIXES = ['/children'];

function parentMayOpen(path: string, portalOn: boolean): boolean {
  if (PARENT_BASE.includes(path)) return true;
  if (!portalOn) return false;
  return PARENT_PORTAL_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const session = await requireUser(request, env);
  const { user, kind, account } = session;
  const db = tenantDbFor(env, session);
  // Only parents pay for this read; for everyone else the portal flag is not part of the answer.
  const parentPortal = kind === 'parent' ? (await getParentPortal(db)).enabled : false;
  if (kind === 'parent') {
    // Single-fetch asks for "<path>.data"; compare on the page path either way.
    const path = new URL(request.url).pathname.replace(/\.data$/, '');
    if (!parentMayOpen(path, parentPortal)) throw redirect('/profile');
  }
  // Anyone who is not staff gets the light payload: the badge counts are a staff view of
  // the school, and the queries behind them read the whole roster.
  if (kind !== 'staff') {
    const uiPrefs = await uiPrefsSvc.getUiPrefs(db, account.id);
    // The one badge a student has: how many vocabulary words have come round for review today.
    // Wrapped because a deploy can land before its migration and the app shell must not 500 over
    // a badge — same contract as the garden's reads on /vocabulary.
    let dueReviewCount = 0;
    if (kind === 'student') {
      try {
        dueReviewCount = await flashcardsSvc.countDueForStudent(
          db,
          user.id,
          ictDateOf(new Date().toISOString()),
        );
      } catch (err) {
        console.error('review badge unavailable', err);
      }
    }
    return {
      unusedInviteCount: 0,
      unresolvedFeedbackCount: 0,
      needsGradingCount: 0,
      dueReviewCount,
      uiPrefs,
      parentPortal,
      // Nav visibility only, not enforced for non-staff — the route itself re-checks.
      showTuiMuBoard: false,
      // `isPlatformAdmin` and the two school ids ride along on the sidebar's user object: the nav
      // needs the first to show /platform at all, and the banner needs the pair to tell "I am in
      // my own school" from "I have entered someone else's".
      user: {
        ...user,
        kind,
        isPlatformAdmin: session.isPlatformAdmin,
        tenantId: session.tenantId,
        homeTenantId: session.homeTenantId,
      },
    };
  }
  const [unusedInviteCount, unresolvedFeedbackCount, uiPrefs, summary, checkinSettings] =
    await Promise.all([
      invitesSvc.countUnused(db),
      feedbackSvc.countUnresolved(db),
      uiPrefsSvc.getUiPrefs(db, account.id),
      testsSvc.attemptsSummary(db),
      getCheckinSettings(db),
    ]);
  const needsGradingCount = Object.values(summary).reduce((n, s) => n + s.needsGrading, 0);
  return {
    unusedInviteCount,
    unresolvedFeedbackCount,
    needsGradingCount,
    // Staff have no mastery rows, so nothing is ever due for them.
    dueReviewCount: 0,
    uiPrefs,
    // Staff nav has no parent rows to gate; the field exists so the payload shape is uniform.
    parentPortal,
    showTuiMuBoard: checkinSettings.showClassBoard,
    // `isPlatformAdmin` and the two school ids ride along on the sidebar's user object: the nav
    // needs the first to show /platform at all, and the banner needs the pair to tell "I am in
    // my own school" from "I have entered someone else's".
    user: {
      ...user,
      kind,
      isPlatformAdmin: session.isPlatformAdmin,
      tenantId: session.tenantId,
      homeTenantId: session.homeTenantId,
    },
  };
}

// The layout loader feeds the sidebar badge counts (unused invites, unresolved
// feedback, attempts needing grading), uiPrefs, and the session user. Only
// mutations under these paths can change that data — skip the layout .data
// round-trip for everything else: plain GET navigations (incl. clicking the
// current page's nav link), revalidator.revalidate() calls from
// useStaleRouteRefresh, and unrelated mutations (calendar/classes/materials/
// assessments/flashcards — and /calendar's theme write targets a different
// settings row key than uiPrefs).
const APP_DATA_MUTATION_PATHS = ['/people', '/feedback', '/config', '/profile', '/tests'];

export function shouldRevalidate({
  formAction,
  formMethod,
  formData,
}: ShouldRevalidateFunctionArgs) {
  // A live update announced a change to invites / feedback / grading somewhere
  // else, so the badge counts really are out of date. The flag is owned by
  // src/lib/live.ts and stays set for the duration of that one revalidation —
  // React Router asks this question several times per revalidation and acts on
  // the last answer, so it cannot be a read-once flag.
  if (isLiveLayoutRefreshPending()) return true;
  if (!formAction || !formMethod || formMethod.toUpperCase() === 'GET') return false;
  const path = formAction.split('?')[0];
  // A finished vocabulary round reschedules the words it covered, so the student's review badge
  // really is out of date. Only that one intent: a teacher editing words posts to the same path
  // several times a minute and can never change a count that is nobody's but the student's.
  if (path.startsWith('/vocabulary') && formData?.get('intent') === 'record-result') return true;
  if (!APP_DATA_MUTATION_PATHS.some((p) => path === p || path.startsWith(p + '/'))) return false;
  // Paper score entry autosaves to /tests/:id on every keystroke, but a paper
  // attempt is stored already graded, so it can never move needsGradingCount.
  if (formData?.get('intent') === 'save-paper-scores') return false;
  return true;
}

export type AppLoaderData = Awaited<ReturnType<typeof loader>>;

export type SessionUser = AppLoaderData['user'];

function Sidebar({ user, onFeedback }: { user: SessionUser; onFeedback: () => void }) {
  const {
    unusedInviteCount,
    unresolvedFeedbackCount,
    needsGradingCount,
    dueReviewCount,
    parentPortal,
    showTuiMuBoard,
  } = useLoaderData<typeof loader>();
  const { t } = useLang();
  const counts: Record<string, number> = {
    people: unusedInviteCount,
    feedback: unresolvedFeedbackCount,
    tests: needsGradingCount,
    vocabulary: dueReviewCount,
  };
  const { pathname } = useLocation();
  const { collapsed, toggle } = useCollapsedSections(activeSectionFor(pathname));

  return (
    <aside className="sb">
      {/* Students never reach /dashboard — requireStaff bounces them to /vocabulary, and a
          parent to /profile — so send each straight home rather than through a redirect. A
          parent's home is their children once the portal is open, and /profile before that. */}
      <Link
        to={
          user.kind === 'staff'
            ? '/dashboard'
            : user.kind === 'parent'
              ? parentPortal
                ? '/children'
                : '/profile'
              : '/vocabulary'
        }
        prefetch="intent"
        className="sb__brand"
      >
        <span className="sb__brand-mark">
          <MIcon name="paw" size={20} />
        </span>
        Mochi
      </Link>
      {NAV.map((sec) => {
        const items = visibleItems(sec, user, { parentPortal, tuiMuBoard: showTuiMuBoard });
        if (items.length === 0) return null;
        const open = !collapsed.has(sec.id);
        // Collapsed rows still render — the ≤720px icon rail shows every item and
        // ignores collapse, so they are hidden with CSS rather than unmounted.
        const rollup = open ? 0 : rollupCount(items, counts);
        return (
          <div key={sec.id} className={'sb__group' + (open ? '' : ' is-collapsed')}>
            <button
              type="button"
              className="sb__section"
              aria-expanded={open}
              aria-controls={`sb-group-${sec.id}`}
              onClick={() => toggle(sec.id)}
            >
              <MIcon name={sec.icon} size={18} className="sb__section-icon" />
              <span className="sb__section-label">{t(sec.tk)}</span>
              {rollup > 0 && (
                <span className="count">
                  <ShBadge color="brand">{rollup}</ShBadge>
                </span>
              )}
              <MIcon name="chevronDown" size={14} className="sb__section-chevron" />
            </button>
            <div id={`sb-group-${sec.id}`} className="sb__group-items">
              {items.map((n) =>
                // An `external` item points outside the `_app` layout — a NavLink would try to
                // client-side navigate to a route with no component. See NavItem.external.
                n.external ? (
                  <a key={n.id} href={n.path} target="_blank" rel="noreferrer" className="sb__item">
                    <MIcon name={n.icon} size={20} />
                    <span>{t(n.tk)}</span>
                  </a>
                ) : (
                  <NavLink
                    key={n.id}
                    to={n.path}
                    prefetch="intent"
                    className={({ isActive, isPending }) =>
                      'sb__item' + (isActive ? ' is-active' : '') + (isPending ? ' is-pending' : '')
                    }
                  >
                    <MIcon name={n.icon} size={20} />
                    <span>{t(n.tk)}</span>
                    {counts[n.id] > 0 && (
                      <span className="count">
                        <ShBadge color="brand">{counts[n.id]}</ShBadge>
                      </span>
                    )}
                  </NavLink>
                ),
              )}
            </div>
          </div>
        );
      })}
      <div className="sb__langbar">
        <LanguageToggle />
      </div>
      <VersionStamp />
      {user.kind === 'staff' && (
        <button className="sb__cta" onClick={onFeedback} title={t('cta_feedback')}>
          <MIcon name="message" size={18} />
          <span>{t('cta_feedback')}</span>
        </button>
      )}
      <NavLink
        to="/profile"
        prefetch="intent"
        className={({ isActive, isPending }) =>
          'sb__foot' + (isActive ? ' is-active' : '') + (isPending ? ' is-pending' : '')
        }
        title="Manage your profile"
      >
        <ShAv name={user.name} color={user.color} size="md" />
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <div className="nm">{user.name}</div>
          <div className="sub">{user.role}</div>
        </div>
        <MIcon
          name="chevronRight"
          size={18}
          style={{ marginLeft: 'auto', color: 'var(--taupe-400)' }}
        />
      </NavLink>
    </aside>
  );
}

function NavProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    // Only show for navigations that take noticeable time; cache-hit
    // navigations settle before the delay elapses and never flash the bar.
    const id = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(id);
  }, [busy]);
  if (!visible) return null;
  return <div className="nav-progress" aria-hidden="true" />;
}

/**
 * When the currently displayed route's cache entry changes underneath it
 * (a stale-while-revalidate refresh landing, or another screen's mutation
 * marking it stale), revalidate so useLoaderData picks up the new data.
 * Nearly free: shouldRevalidate above skips the layout loader and the child
 * clientLoader is a cache hit (or stale hit that kicks its own refresh).
 * Skips when the key was hard-deleted (cacheGet undefined) — React Router's
 * automatic post-action revalidation already covers that case.
 */
function useStaleRouteRefresh() {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const location = useLocation();
  const key = cacheKeyForPath(location.pathname);
  const ref = React.useRef({ revalidator, navigation });
  ref.current = { revalidator, navigation };
  React.useEffect(() => {
    if (!key) return;
    return subscribe(key, () => {
      const cur = ref.current;
      if (
        cacheGet(key) !== undefined &&
        cur.navigation.state === 'idle' &&
        cur.revalidator.state === 'idle'
      ) {
        cur.revalidator.revalidate();
      }
    });
  }, [key]);
}

/**
 * Hold the live-update socket for as long as the app shell is mounted. Login,
 * logout and the print view live outside this layout, so the socket exists only
 * while signed in and closes on logout.
 *
 * The callback runs only for changes that move a sidebar badge; ordinary route
 * data refreshes itself through the cache subscription above.
 */
function useLiveUpdates() {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const ref = React.useRef({ revalidator, navigation });
  ref.current = { revalidator, navigation };
  React.useEffect(
    () =>
      startLive(() => {
        const cur = ref.current;
        // Returning null says "busy, not now": the caller keeps its flag set so
        // the revalidation already under way still re-runs this loader.
        if (cur.navigation.state !== 'idle' || cur.revalidator.state !== 'idle') return null;
        return cur.revalidator.revalidate();
      }),
    [],
  );
}

export type AppContext = {
  user: SessionUser;
};

export default function AppLayout() {
  useStaleRouteRefresh();
  useLiveUpdates();
  useTrackNavigation();
  const { t } = useLang();
  const { user, uiPrefs } = useLoaderData<typeof loader>();
  const feedbackFetcher = useFetcher();
  const [feedbackDraft, setFeedbackDraft] = React.useState<ReturnType<
    typeof newFeedbackDraft
  > | null>(null);

  React.useEffect(() => {
    document.documentElement.dataset.scrollbar = uiPrefs.scrollbar;
    // Same trick as the scrollbar, and for the same reason: /vocabulary then needs no loader of
    // its own for this — the deck card publishes its colour as a custom property and the
    // `html[data-vocab-card]` rules decide what to do with it.
    document.documentElement.dataset.vocabCard = uiPrefs.vocabCard;
  }, [uiPrefs.scrollbar, uiPrefs.vocabCard]);

  const openFeedback = () => {
    setFeedbackDraft(newFeedbackDraft(user));
  };

  const saveFeedback = (f: ReturnType<typeof newFeedbackDraft>) => {
    if (!f.message.trim()) {
      setFeedbackDraft(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'create');
    fd.set('message', f.message);
    fd.set('category', f.category);
    fd.set('author', f.author || '');
    fd.set('status', f.status);
    fd.set('appVersion', BUILD_ID);
    feedbackFetcher.submit(fd, { action: '/feedback', method: 'post' });
    setFeedbackDraft(null);
  };

  const shellStyle = {
    '--sidebar-w':
      TWEAKS.sidebar === 'wide' ? '280px' : TWEAKS.sidebar === 'compact' ? '220px' : '260px',
    '--brand': TWEAKS.accent,
    '--brand-soft': `color-mix(in srgb, ${TWEAKS.accent} 16%, white)`,
    '--brand-soft-ink': `color-mix(in srgb, ${TWEAKS.accent} 70%, black)`,
    '--radius-lg':
      TWEAKS.rounding === 'sharp' ? '12px' : TWEAKS.rounding === 'round' ? '24px' : '20px',
    '--radius-md':
      TWEAKS.rounding === 'sharp' ? '8px' : TWEAKS.rounding === 'round' ? '18px' : '14px',
    fontFamily: 'var(--font-body)',
  } as React.CSSProperties;

  return (
    <div className="app" style={shellStyle} data-density={TWEAKS.density}>
      <NavProgress />
      {/*
        A platform admin reading another school's data must never be able to forget they are.
        Entering is already audited; this is the half the person doing it can see.
      */}
      {user.isPlatformAdmin && user.tenantId !== user.homeTenantId && (
        <div className="app__tenant-banner" role="status">
          <span>{t('platform_banner')}</span>
          <a href="/platform">{t('platform_exit')}</a>
        </div>
      )}
      <Sidebar user={user} onFeedback={openFeedback} />
      <div className="main">
        <Outlet context={{ user } satisfies AppContext} />
      </div>
      {feedbackDraft && (
        <FeedbackModal
          draft={feedbackDraft}
          setDraft={setFeedbackDraft}
          onClose={() => setFeedbackDraft(null)}
          onSave={saveFeedback}
        />
      )}
      {user.email === DEV_ACCOUNT_EMAIL && <DevInspector />}
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const { t } = useLang();

  let status = 500;
  let title = t('err_generic_title');
  let message = t('err_generic_msg');

  if (isRouteErrorResponse(error)) {
    status = error.status;
    if (status === 404) {
      title = t('err_not_found_title');
      message = t('err_not_found_msg');
    } else if (status === 400) {
      title = t('err_bad_request_title');
      message = t('err_bad_request_msg');
    } else if (status === 403) {
      title = t('err_forbidden_title');
      message = t('err_forbidden_msg');
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: 12,
        padding: '40px 24px',
        fontFamily: 'var(--font-body)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--text-muted)', lineHeight: 1 }}>
        {status}
      </div>
      <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700 }}>{title}</h2>
      <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: 360 }}>{message}</p>
      <a href="/dashboard" style={{ marginTop: 8, color: 'var(--text-link)', fontWeight: 600 }}>
        {t('err_go_home')}
      </a>
    </div>
  );
}
