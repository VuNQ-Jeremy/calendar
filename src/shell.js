import { React, DS } from './lib/globals.js';
import { MIcon } from './icons.js';
import { useStore } from './store.js';
import { iso, TODAY } from './lib/core.js';
import { DashboardScreen, HomeworkScreen } from './screens-core.js';
import { CalendarScreen } from './calendar.js';
import { ClassesScreen, StudentsScreen } from './screens-manage.js';
import { MaterialsScreen, ProfileScreen } from './screens-extra.js';

// app/shell.jsx — app shell: sidebar nav, topbar, routing, profile entry
const { Avatar: ShAv, Badge: ShBadge, IconButton: ShIB, Button: ShBtn } = DS;

const NAV = [
  { group: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'home' }, { id: 'calendar', label: 'Calendar', icon: 'calendar' }] },
  { group: 'Manage', items: [{ id: 'classes', label: 'Classes', icon: 'book' }, { id: 'students', label: 'People', icon: 'users' }, { id: 'materials', label: 'Materials', icon: 'folder' }, { id: 'homework', label: 'Homework', icon: 'clipboard' }] },
];

const HEADERS = {
  dashboard: { ph: 'Search anything…' },
  calendar: { ph: 'Search events…' },
  classes: { ph: 'Search classes…' },
  students: { ph: 'Search people…' },
  materials: { ph: 'Search materials…' },
  homework: { ph: 'Search homework…' },
  profile: { ph: 'Search…' },
};

function Sidebar({ active, onNav, user }) {
  const { data } = useStore();
  const today = iso(TODAY);
  const dueCount = data.homework.filter(h => !h.done && h.due <= today).length;
  const counts = { homework: dueCount, students: data.invites.filter(i => !i.used).length };
  return React.createElement('aside', { className: 'sb' },
    React.createElement('div', { className: 'sb__brand' },
      React.createElement('span', { className: 'sb__brand-mark' }, React.createElement(MIcon, { name: 'paw', size: 20 })),
      'Mochi',
    ),
    NAV.map(sec => React.createElement('div', { key: sec.group },
      React.createElement('div', { className: 'sb__section' }, sec.group),
      sec.items.map(n => React.createElement('button', { key: n.id, className: 'sb__item' + (active === n.id ? ' is-active' : ''), onClick: () => onNav(n.id) },
        React.createElement(MIcon, { name: n.icon, size: 20 }),
        React.createElement('span', null, n.label),
        counts[n.id] > 0 && React.createElement('span', { className: 'count' }, React.createElement(ShBadge, { color: 'brand' }, counts[n.id])),
      )),
    )),
    React.createElement('button', { className: 'sb__foot' + (active === 'profile' ? ' is-active' : ''), onClick: () => onNav('profile'), title: 'Manage your profile' },
      React.createElement(ShAv, { name: user.name, color: user.color, size: 'md' }),
      React.createElement('div', { style: { minWidth: 0, textAlign: 'left' } },
        React.createElement('div', { className: 'nm' }, user.name),
        React.createElement('div', { className: 'sub' }, user.role),
      ),
      React.createElement(MIcon, { name: 'chevronRight', size: 18, style: { marginLeft: 'auto', color: 'var(--taupe-400)' } }),
    ),
  );
}

function AppShell({ user, onLogout, onUpdateUser, tweaks }) {
  const [active, setActive] = React.useState('dashboard');
  const Screen = {
    dashboard: () => React.createElement(DashboardScreen, { user, onNav: setActive }),
    calendar: () => React.createElement(CalendarScreen, null),
    classes: () => React.createElement(ClassesScreen, null),
    students: () => React.createElement(StudentsScreen, null),
    materials: () => React.createElement(MaterialsScreen, null),
    homework: () => React.createElement(HomeworkScreen, null),
    profile: () => React.createElement(ProfileScreen, { user, onSave: onUpdateUser, onLogout }),
  }[active];

  const shellStyle = {
    '--sidebar-w': tweaks.sidebar === 'wide' ? '280px' : tweaks.sidebar === 'compact' ? '220px' : '260px',
    '--brand': tweaks.accent,
    '--brand-soft': `color-mix(in srgb, ${tweaks.accent} 16%, white)`,
    '--brand-soft-ink': `color-mix(in srgb, ${tweaks.accent} 70%, black)`,
    '--radius-lg': tweaks.rounding === 'sharp' ? '12px' : tweaks.rounding === 'round' ? '24px' : '20px',
    '--radius-md': tweaks.rounding === 'sharp' ? '8px' : tweaks.rounding === 'round' ? '18px' : '14px',
    fontFamily: 'var(--font-body)',
  };

  return React.createElement('div', { className: 'app', style: shellStyle, 'data-density': tweaks.density },
    React.createElement(Sidebar, { active, onNav: setActive, user }),
    React.createElement('div', { className: 'main' },
      React.createElement(Screen, null),
    ),
  );
}

export { AppShell };
