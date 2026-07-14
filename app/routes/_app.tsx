import React from 'react';
import { NavLink, Outlet, useLoaderData, useFetcher } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { DS } from '../../src/ds/index.js';
import { MIcon } from '../../src/icons.jsx';
import { iso, TODAY } from '../../src/lib/core.js';
import { FeedbackModal, newFeedbackDraft } from '../../src/feedback.jsx';
import { InstructionsModal, SEEN_INTRO_KEY } from '../../src/instructions.jsx';
import { useLang, LanguageToggle } from '../../src/lib/i18n.jsx';
import { AuthScreen } from '../../src/auth.jsx';
import { createDb } from '../../server/db/index';
import * as feedbackSvc from '../../server/services/feedback';
import * as homeworkSvc from '../../server/services/homework';
import * as invitesSvc from '../../server/services/invites';
import '../../app/load-context';

const { Avatar: ShAv, Badge: ShBadge, IconButton: ShIB } = DS;

const SESSION_KEY = 'mochi_session_v1';

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
      { id: 'dashboard', path: '/dashboard', tk: 'nav_dashboard', icon: 'home' },
      { id: 'calendar', path: '/calendar', tk: 'nav_calendar', icon: 'calendar' },
    ],
  },
  {
    tk: 'nav_manage',
    items: [
      { id: 'classes', path: '/classes', tk: 'nav_classes', icon: 'book' },
      { id: 'people', path: '/people', tk: 'nav_people', icon: 'users' },
      { id: 'materials', path: '/materials', tk: 'nav_materials', icon: 'folder' },
      { id: 'homework', path: '/homework', tk: 'nav_homework', icon: 'clipboard' },
      { id: 'feedback', path: '/feedback', tk: 'nav_feedback', icon: 'message' },
    ],
  },
];

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const today = iso(TODAY);
  const [homeworkDueCount, unusedInviteCount, newFeedbackCount, invites] = await Promise.all([
    homeworkSvc.countDue(db, today),
    invitesSvc.countUnused(db),
    feedbackSvc.countNew(db),
    invitesSvc.list(db),
  ]);
  return { homeworkDueCount, unusedInviteCount, newFeedbackCount, invites };
}

export type AppLoaderData = Awaited<ReturnType<typeof loader>>;

interface SessionUser {
  id: string;
  name: string;
  role: string;
  color: string;
  email?: string;
  phone?: string;
  avatar?: string;
}

function Sidebar({
  user,
  onFeedback,
  onHelp,
}: {
  user: SessionUser | null;
  onFeedback: () => void;
  onHelp: () => void;
}) {
  const { homeworkDueCount, unusedInviteCount, newFeedbackCount } = useLoaderData<typeof loader>();
  const { t } = useLang();
  const counts: Record<string, number> = {
    homework: homeworkDueCount,
    people: unusedInviteCount,
    feedback: newFeedbackCount,
  };

  return (
    <aside className="sb">
      <div className="sb__brand">
        <span className="sb__brand-mark">
          <MIcon name="paw" size={20} />
        </span>
        Mochi
        <span className="sb__help">
          <ShIB label={t('help_label')} size="sm" onClick={onHelp}>
            <MIcon name="help" size={18} />
          </ShIB>
        </span>
      </div>
      {NAV.map((sec) => (
        <div key={sec.tk}>
          <div className="sb__section">{t(sec.tk)}</div>
          {sec.items.map((n) => (
            <NavLink
              key={n.id}
              to={n.path}
              className={({ isActive }) => 'sb__item' + (isActive ? ' is-active' : '')}
            >
              <MIcon name={n.icon} size={20} />
              <span>{t(n.tk)}</span>
              {counts[n.id] > 0 && (
                <span className="count">
                  <ShBadge color="brand">{counts[n.id]}</ShBadge>
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="sb__langbar">
        <LanguageToggle />
      </div>
      <button className="sb__cta" onClick={onFeedback} title={t('cta_feedback')}>
        <MIcon name="message" size={18} />
        <span>{t('cta_feedback')}</span>
      </button>
      {user && (
        <NavLink
          to="/profile"
          className={({ isActive }) => 'sb__foot' + (isActive ? ' is-active' : '')}
          title="Manage your profile"
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                objectFit: 'cover',
                flexShrink: 0,
              }}
            />
          ) : (
            <ShAv name={user.name} color={user.color} size="md" />
          )}
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
      )}
    </aside>
  );
}

export type AppContext = {
  user: SessionUser;
  onUpdateUser: (patch: Partial<SessionUser>) => void;
  onLogout: () => void;
};

export default function AppLayout() {
  const { invites } = useLoaderData<typeof loader>();
  const feedbackFetcher = useFetcher();
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const [feedbackDraft, setFeedbackDraft] = React.useState<ReturnType<
    typeof newFeedbackDraft
  > | null>(null);
  const [introOpen, setIntroOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      const r = localStorage.getItem(SESSION_KEY);
      setUser(r ? (JSON.parse(r) as SessionUser) : null);
    } catch {
      setUser(null);
    }
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted || !user) return;
    try {
      if (!localStorage.getItem(SEEN_INTRO_KEY)) setIntroOpen(true);
    } catch {
      /* storage unavailable */
    }
  }, [mounted, user]);

  const login = (u: SessionUser, remember: boolean) => {
    setUser(u);
    if (remember) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(u));
      } catch {
        /* storage unavailable */
      }
    }
  };

  const logout = () => {
    setUser(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  const updateUser = (patch: Partial<SessionUser>) =>
    setUser((u) => {
      if (!u) return u;
      const nu = { ...u, ...patch };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(nu));
      } catch {
        /* storage unavailable */
      }
      return nu;
    });

  const closeIntro = () => {
    setIntroOpen(false);
    try {
      localStorage.setItem(SEEN_INTRO_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };

  const openFeedback = () => {
    if (user) setFeedbackDraft(newFeedbackDraft(user));
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
      <Sidebar user={user} onFeedback={openFeedback} onHelp={() => setIntroOpen(true)} />
      <div className="main">
        {mounted &&
          (user ? (
            <Outlet
              context={{ user, onUpdateUser: updateUser, onLogout: logout } satisfies AppContext}
            />
          ) : (
            <AuthScreen onLogin={login} invites={invites} />
          ))}
      </div>
      {feedbackDraft && (
        <FeedbackModal
          draft={feedbackDraft}
          setDraft={setFeedbackDraft}
          onClose={() => setFeedbackDraft(null)}
          onSave={saveFeedback}
        />
      )}
      {introOpen && <InstructionsModal onClose={closeIntro} />}
    </div>
  );
}
