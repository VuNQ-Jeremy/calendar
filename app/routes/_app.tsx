import React from 'react';
import {
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
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from 'react-router';
import { cacheGet, subscribe } from '../../src/lib/cache.js';
import { cacheKeyForPath } from '../../src/lib/route-cache.js';
import { DS } from '../../src/ds/index.js';
import { MIcon } from '../../src/icons.jsx';
import type { IconName } from '../../src/icons.jsx';
import { FeedbackModal, newFeedbackDraft } from '../../src/feedback.jsx';
import { DevInspector } from '../../src/dev-inspector.jsx';
import { useLang, LanguageToggle } from '../../src/lib/i18n.jsx';
import { VersionStamp } from '../../src/components/version-stamp.jsx';
import { BUILD_ID } from '../../src/lib/build-id.js';
import { createDb } from '../../server/db/index';
import * as feedbackSvc from '../../server/services/feedback';
import * as invitesSvc from '../../server/services/invites';
import * as uiPrefsSvc from '../../server/services/ui-prefs';
import * as testsSvc from '../../server/services/tests';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';

const { Avatar: ShAv, Badge: ShBadge } = DS;

const DEV_ACCOUNT_EMAIL = 'dev@mochi.edu';

const TWEAKS = {
  accent: '#F79A4E',
  sidebar: 'regular',
  rounding: 'soft',
  density: 'regular',
};

const NAV = [
  {
    tk: 'nav_overview',
    items: [
      { id: 'dashboard', path: '/dashboard', tk: 'nav_dashboard', icon: 'home', staffOnly: true },
      { id: 'calendar', path: '/calendar', tk: 'nav_calendar', icon: 'calendar', staffOnly: true },
    ],
  },
  {
    tk: 'nav_manage',
    items: [
      { id: 'classes', path: '/classes', tk: 'nav_classes', icon: 'book', staffOnly: true },
      { id: 'people', path: '/people', tk: 'nav_people', icon: 'users', staffOnly: true },
      { id: 'materials', path: '/materials', tk: 'nav_materials', icon: 'folder', staffOnly: true },
      { id: 'tests', path: '/tests', tk: 'nav_tests', icon: 'clipboard', staffOnly: true },
      { id: 'questions', path: '/questions', tk: 'nav_questions', icon: 'edit', staffOnly: true },
      {
        id: 'assessments',
        path: '/assessments',
        tk: 'nav_assessments',
        icon: 'chart',
        staffOnly: true,
      },
      { id: 'vocabulary', path: '/vocabulary', tk: 'nav_flashcards', icon: 'cards' },
      // Students only — staff manage tests from /tests instead.
      {
        id: 'my-tests',
        path: '/my-tests',
        tk: 'nav_my_tests',
        icon: 'clipboard',
        studentOnly: true,
      },
      {
        id: 'config',
        path: '/config',
        tk: 'nav_config',
        icon: 'settings',
        adminOnly: true,
        staffOnly: true,
      },
      { id: 'feedback', path: '/feedback', tk: 'nav_feedback', icon: 'message', staffOnly: true },
    ],
  },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  const db = createDb(env);
  if (kind === 'student') {
    const uiPrefs = await uiPrefsSvc.getUiPrefs(db);
    return {
      unusedInviteCount: 0,
      unresolvedFeedbackCount: 0,
      needsGradingCount: 0,
      uiPrefs,
      user: { ...user, kind },
    };
  }
  const [unusedInviteCount, unresolvedFeedbackCount, uiPrefs, summary] = await Promise.all([
    invitesSvc.countUnused(db),
    feedbackSvc.countUnresolved(db),
    uiPrefsSvc.getUiPrefs(db),
    testsSvc.attemptsSummary(db),
  ]);
  const needsGradingCount = Object.values(summary).reduce((n, s) => n + s.needsGrading, 0);
  return {
    unusedInviteCount,
    unresolvedFeedbackCount,
    needsGradingCount,
    uiPrefs,
    user: { ...user, kind },
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
  if (!formAction || !formMethod || formMethod.toUpperCase() === 'GET') return false;
  const path = formAction.split('?')[0];
  if (!APP_DATA_MUTATION_PATHS.some((p) => path === p || path.startsWith(p + '/'))) return false;
  // Paper score entry autosaves to /tests/:id on every keystroke, but a paper
  // attempt is stored already graded, so it can never move needsGradingCount.
  if (formData?.get('intent') === 'save-paper-scores') return false;
  return true;
}

export type AppLoaderData = Awaited<ReturnType<typeof loader>>;

export type SessionUser = AppLoaderData['user'];

function Sidebar({ user, onFeedback }: { user: SessionUser; onFeedback: () => void }) {
  const { unusedInviteCount, unresolvedFeedbackCount, needsGradingCount } =
    useLoaderData<typeof loader>();
  const { t } = useLang();
  const counts: Record<string, number> = {
    people: unusedInviteCount,
    feedback: unresolvedFeedbackCount,
    tests: needsGradingCount,
  };

  return (
    <aside className="sb">
      <div className="sb__brand">
        <span className="sb__brand-mark">
          <MIcon name="paw" size={20} />
        </span>
        Mochi
      </div>
      {NAV.map((sec) => {
        const items = sec.items.filter(
          (n) =>
            (!('staffOnly' in n) || !n.staffOnly || user.kind === 'staff') &&
            (!('studentOnly' in n) || !n.studentOnly || user.kind === 'student') &&
            (!('adminOnly' in n) || !n.adminOnly || user.role === 'Admin'),
        );
        if (items.length === 0) return null;
        return (
          <div key={sec.tk}>
            <div className="sb__section">{t(sec.tk)}</div>
            {items.map((n) => (
              <NavLink
                key={n.id}
                to={n.path}
                prefetch="intent"
                className={({ isActive, isPending }) =>
                  'sb__item' + (isActive ? ' is-active' : '') + (isPending ? ' is-pending' : '')
                }
              >
                <MIcon name={n.icon as IconName} size={20} />
                <span>{t(n.tk)}</span>
                {counts[n.id] > 0 && (
                  <span className="count">
                    <ShBadge color="brand">{counts[n.id]}</ShBadge>
                  </span>
                )}
              </NavLink>
            ))}
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

export type AppContext = {
  user: SessionUser;
};

export default function AppLayout() {
  useStaleRouteRefresh();
  const { user, uiPrefs } = useLoaderData<typeof loader>();
  const feedbackFetcher = useFetcher();
  const [feedbackDraft, setFeedbackDraft] = React.useState<ReturnType<
    typeof newFeedbackDraft
  > | null>(null);

  React.useEffect(() => {
    document.documentElement.dataset.scrollbar = uiPrefs.scrollbar;
  }, [uiPrefs.scrollbar]);

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
    fd.set('createdAt', f.createdAt || '');
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
