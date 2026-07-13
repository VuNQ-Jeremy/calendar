import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.js';
import { iso, TODAY } from './lib/core.js';
import { DashboardScreen, HomeworkScreen } from './screens-core.jsx';
import { CalendarScreen } from './calendar.jsx';
import { ClassesScreen, StudentsScreen } from './screens-manage.jsx';
import { MaterialsScreen, ProfileScreen } from './screens-extra.jsx';
import { FeedbackScreen, FeedbackModal, newFeedbackDraft } from './feedback.jsx';
import { InstructionsModal, SEEN_INTRO_KEY } from './instructions.jsx';
import { useLang, LanguageToggle } from './lib/i18n.js';

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
  return React.createElement(
    'aside',
    { className: 'sb' },
    React.createElement(
      'div',
      { className: 'sb__brand' },
      React.createElement(
        'span',
        { className: 'sb__brand-mark' },
        React.createElement(MIcon, { name: 'paw', size: 20 }),
      ),
      'Mochi',
      React.createElement(
        'span',
        { className: 'sb__help' },
        React.createElement(
          ShIB,
          { label: t('help_label'), size: 'sm', onClick: onHelp },
          React.createElement(MIcon, { name: 'help', size: 18 }),
        ),
      ),
    ),
    NAV.map((sec) =>
      React.createElement(
        'div',
        { key: sec.tk },
        React.createElement('div', { className: 'sb__section' }, t(sec.tk)),
        sec.items.map((n) =>
          React.createElement(
            'button',
            {
              key: n.id,
              className: 'sb__item' + (active === n.id ? ' is-active' : ''),
              onClick: () => onNav(n.id),
            },
            React.createElement(MIcon, { name: n.icon, size: 20 }),
            React.createElement('span', null, t(n.tk)),
            counts[n.id] > 0 &&
              React.createElement(
                'span',
                { className: 'count' },
                React.createElement(ShBadge, { color: 'brand' }, counts[n.id]),
              ),
          ),
        ),
      ),
    ),
    React.createElement(
      'div',
      { className: 'sb__langbar' },
      React.createElement(LanguageToggle, null),
    ),
    React.createElement(
      'button',
      { className: 'sb__cta', onClick: onFeedback, title: t('cta_feedback') },
      React.createElement(MIcon, { name: 'message', size: 18 }),
      React.createElement('span', null, t('cta_feedback')),
    ),
    React.createElement(
      'button',
      {
        className: 'sb__foot' + (active === 'profile' ? ' is-active' : ''),
        onClick: () => onNav('profile'),
        title: 'Manage your profile',
      },
      user.avatar
        ? React.createElement('img', {
            src: user.avatar,
            alt: user.name,
            style: {
              width: 40,
              height: 40,
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
            },
          })
        : React.createElement(ShAv, { name: user.name, color: user.color, size: 'md' }),
      React.createElement(
        'div',
        { style: { minWidth: 0, textAlign: 'left' } },
        React.createElement('div', { className: 'nm' }, user.name),
        React.createElement('div', { className: 'sub' }, user.role),
      ),
      React.createElement(MIcon, {
        name: 'chevronRight',
        size: 18,
        style: { marginLeft: 'auto', color: 'var(--taupe-400)' },
      }),
    ),
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
    dashboard: () => React.createElement(DashboardScreen, { user, onNav: setActive }),
    calendar: () => React.createElement(CalendarScreen, null),
    classes: () => React.createElement(ClassesScreen, null),
    students: () => React.createElement(StudentsScreen, null),
    materials: () => React.createElement(MaterialsScreen, null),
    homework: () => React.createElement(HomeworkScreen, null),
    feedback: () => React.createElement(FeedbackScreen, { user }),
    profile: () => React.createElement(ProfileScreen, { user, onSave: onUpdateUser, onLogout }),
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

  return React.createElement(
    'div',
    { className: 'app', style: shellStyle, 'data-density': tweaks.density },
    React.createElement(Sidebar, {
      active,
      onNav: setActive,
      user,
      onFeedback: openFeedback,
      onHelp: () => setIntroOpen(true),
    }),
    React.createElement('div', { className: 'main' }, screen()),
    feedbackDraft &&
      React.createElement(FeedbackModal, {
        draft: feedbackDraft,
        setDraft: setFeedbackDraft,
        onClose: () => setFeedbackDraft(null),
        onSave: saveFeedback,
      }),
    introOpen && React.createElement(InstructionsModal, { onClose: closeIntro }),
  );
}

export { AppShell };
