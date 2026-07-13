import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.jsx';
import { iso, TODAY } from './lib/core.js';
import { DashboardScreen, HomeworkScreen } from './screens-core.jsx';
import { CalendarScreen } from './calendar/index.jsx';
import { ClassesScreen, StudentsScreen } from './screens-manage/index.jsx';
import { MaterialsScreen, ProfileScreen } from './screens-extra.jsx';
import { FeedbackScreen, FeedbackModal, newFeedbackDraft } from './feedback.jsx';
import { InstructionsModal, SEEN_INTRO_KEY } from './instructions.jsx';
import { useLang, LanguageToggle } from './lib/i18n.jsx';

// app/shell.jsx — app shell: sidebar nav, topbar, routing, profile entry
const { Avatar: ShAv, Badge: ShBadge, IconButton: ShIB } = DS;

// `tk` is the i18n key used to translate the label at render time.
const NAV = [
  {
    tk: 'nav_overview',
    items: [
      { id: 'dashboard', tk: 'nav_dashboard', icon: 'home' },
      { id: 'calendar', tk: 'nav_calendar', icon: 'calendar' },
    ],
  },
  {
    tk: 'nav_manage',
    items: [
      { id: 'classes', tk: 'nav_classes', icon: 'book' },
      { id: 'students', tk: 'nav_people', icon: 'users' },
      { id: 'materials', tk: 'nav_materials', icon: 'folder' },
      { id: 'homework', tk: 'nav_homework', icon: 'clipboard' },
      { id: 'feedback', tk: 'nav_feedback', icon: 'message' },
    ],
  },
];

function Sidebar({ active, onNav, user, onFeedback, onHelp }) {
  const { data } = useStore();
  const { t } = useLang();
  const today = iso(TODAY);
  const dueCount = data.homework.filter((h) => !h.done && h.due <= today).length;
  const newFeedback = (data.feedback || []).filter((f) => f.status === 'new').length;
  const counts = {
    homework: dueCount,
    students: data.invites.filter((i) => !i.used).length,
    feedback: newFeedback,
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
            <button
              key={n.id}
              className={'sb__item' + (active === n.id ? ' is-active' : '')}
              onClick={() => onNav(n.id)}
            >
              <MIcon name={n.icon} size={20} />
              <span>{t(n.tk)}</span>
              {counts[n.id] > 0 && (
                <span className="count">
                  <ShBadge color="brand">{counts[n.id]}</ShBadge>
                </span>
              )}
            </button>
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
      <button
        className={'sb__foot' + (active === 'profile' ? ' is-active' : '')}
        onClick={() => onNav('profile')}
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
      </button>
    </aside>
  );
}

function AppShell({ user, onLogout, onUpdateUser, tweaks }) {
  const { add } = useStore();
  const [active, setActive] = React.useState('dashboard');
  const [feedbackDraft, setFeedbackDraft] = React.useState(null);
  const [introOpen, setIntroOpen] = React.useState(false);

  // Show the welcome guide automatically the first time, once per browser.
  React.useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_INTRO_KEY)) setIntroOpen(true);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const closeIntro = () => {
    setIntroOpen(false);
    try {
      localStorage.setItem(SEEN_INTRO_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };

  const openFeedback = () => setFeedbackDraft(newFeedbackDraft(user));
  const saveFeedback = (f) => {
    if (!f.message.trim()) {
      setFeedbackDraft(null);
      return;
    }
    add('feedback', f);
    setFeedbackDraft(null);
    setActive('feedback');
  };

  // Build the active screen as a React *element* (not a freshly-created
  // component type). Creating a new function per render and passing it to
  // React.createElement would remount the screen on every AppShell re-render
  // (e.g. when the store updates), wiping local screen state like open drawers.
  const screen = {
    dashboard: () => <DashboardScreen user={user} onNav={setActive} />,
    calendar: () => <CalendarScreen />,
    classes: () => <ClassesScreen />,
    students: () => <StudentsScreen />,
    materials: () => <MaterialsScreen />,
    homework: () => <HomeworkScreen />,
    feedback: () => <FeedbackScreen user={user} />,
    profile: () => <ProfileScreen user={user} onSave={onUpdateUser} onLogout={onLogout} />,
  }[active];

  const shellStyle = {
    '--sidebar-w':
      tweaks.sidebar === 'wide' ? '280px' : tweaks.sidebar === 'compact' ? '220px' : '260px',
    '--brand': tweaks.accent,
    '--brand-soft': `color-mix(in srgb, ${tweaks.accent} 16%, white)`,
    '--brand-soft-ink': `color-mix(in srgb, ${tweaks.accent} 70%, black)`,
    '--radius-lg':
      tweaks.rounding === 'sharp' ? '12px' : tweaks.rounding === 'round' ? '24px' : '20px',
    '--radius-md':
      tweaks.rounding === 'sharp' ? '8px' : tweaks.rounding === 'round' ? '18px' : '14px',
    fontFamily: 'var(--font-body)',
  };

  return (
    <div className="app" style={shellStyle} data-density={tweaks.density}>
      <Sidebar
        active={active}
        onNav={setActive}
        user={user}
        onFeedback={openFeedback}
        onHelp={() => setIntroOpen(true)}
      />
      <div className="main">{screen()}</div>
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

export { AppShell };
