import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.js';
import { PageHeader, Empty, Modal, MSelect } from './ui.js';
import { colorOf, iso, TODAY, ICON_TINT } from './lib/core.js';
import { expandEvents, fmtTime, toMin } from './calendar.js';
import { useLang, locale } from './lib/i18n.js';

// app/screens-core.jsx — Dashboard (Today) + Homework
const {
  Card: SC,
  Button: SBtn,
  IconButton: SIB,
  Tag: STag,
  Badge: SBadge,
  Checkbox: SCheck,
  ProgressBar: SProg,
} = DS;

// ---- StatCard ----
function StatCard({ icon, color, num, label }) {
  return React.createElement(
    SC,
    { interactive: true, style: { padding: 0 } },
    React.createElement(
      'div',
      { className: 'statcard' },
      React.createElement(
        'div',
        { className: 'statcard__icon', style: ICON_TINT(color) },
        React.createElement(MIcon, { name: icon, size: 24 }),
      ),
      React.createElement(
        'div',
        null,
        React.createElement('div', { className: 'statcard__num' }, num),
        React.createElement('div', { className: 'statcard__label' }, label),
      ),
    ),
  );
}

// ---- Dashboard / Today ----
function DashboardScreen({ user, onNav }) {
  const { data, update } = useStore();
  const { t, lang } = useLang();
  const today = iso(TODAY);
  const todays = expandEvents(data.events, TODAY, TODAY).sort(
    (a, b) => toMin(a.start) - toMin(b.start),
  );
  const dueToday = data.homework.filter((h) => h.due === today && !h.done);
  const pending = data.homework.filter((h) => !h.done);
  const className = (id) => (data.classes.find((c) => c.id === id) || {}).name;
  const todayStr = new Date(TODAY).toLocaleDateString(locale(lang), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return React.createElement(
    'div',
    { className: 'content' },
    React.createElement(PageHeader, {
      title: t('dash_greeting', { name: user.name.split(' ')[0] }),
      subtitle: t('dash_sub', { date: todayStr, count: todays.length }),
    }),
    React.createElement(
      'div',
      { className: 'm-grid cols-4' },
      React.createElement(StatCard, {
        icon: 'book',
        color: 'green',
        num: data.classes.length,
        label: t('stat_classes'),
      }),
      React.createElement(StatCard, {
        icon: 'users',
        color: 'blue',
        num: data.students.length,
        label: t('stat_students'),
      }),
      React.createElement(StatCard, {
        icon: 'clipboard',
        color: 'orange',
        num: pending.length,
        label: t('stat_homework'),
      }),
      React.createElement(StatCard, {
        icon: 'folder',
        color: 'violet',
        num: data.materials.length,
        label: t('stat_materials'),
      }),
    ),
    React.createElement(
      'div',
      { className: 'm-grid', style: { gridTemplateColumns: '1.4fr 1fr' } },
      // Today's schedule
      React.createElement(
        SC,
        null,
        React.createElement(
          'div',
          { className: 'm-spread', style: { marginBottom: 16 } },
          React.createElement(
            'h2',
            { style: { margin: 0, fontSize: 'var(--text-xl)' } },
            t('dash_today_schedule'),
          ),
          React.createElement(
            SBtn,
            {
              variant: 'ghost',
              size: 'sm',
              iconRight: React.createElement(MIcon, { name: 'chevronRight', size: 16 }),
              onClick: () => onNav('calendar'),
            },
            t('nav_calendar'),
          ),
        ),
        todays.length
          ? React.createElement(
              'div',
              { className: 'm-stack' },
              todays.map((e, i) => {
                const c = colorOf(e.color);
                return React.createElement(
                  'div',
                  { key: i, className: 'lrow', style: { padding: 12 } },
                  React.createElement('div', {
                    className: 'lrow__bar',
                    style: { background: c.base },
                  }),
                  React.createElement(
                    'div',
                    {
                      className: 'm-mono',
                      style: {
                        minWidth: 70,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-body)',
                      },
                    },
                    fmtTime(e.start),
                  ),
                  React.createElement(
                    'div',
                    { style: { flex: 1 } },
                    React.createElement(
                      'div',
                      { className: 'lrow__title', style: { fontSize: 'var(--text-md)' } },
                      e.title,
                    ),
                    e.location &&
                      React.createElement(
                        'div',
                        { className: 'm-muted', style: { fontSize: 'var(--text-xs)' } },
                        e.location,
                      ),
                  ),
                  e.classId &&
                    React.createElement(
                      STag,
                      { color: c.tagColor || e.color },
                      className(e.classId) || t('class'),
                    ),
                );
              }),
            )
          : React.createElement(Empty, {
              icon: 'calendar',
              title: t('dash_nothing_scheduled'),
              sub: t('dash_enjoy_quiet'),
            }),
      ),
      // Due today
      React.createElement(
        SC,
        null,
        React.createElement(
          'div',
          { className: 'm-spread', style: { marginBottom: 16 } },
          React.createElement(
            'h2',
            { style: { margin: 0, fontSize: 'var(--text-xl)' } },
            t('dash_due_today'),
          ),
          dueToday.length > 0 && React.createElement(SBadge, { color: 'brand' }, dueToday.length),
        ),
        dueToday.length
          ? React.createElement(
              'div',
              { className: 'm-stack' },
              dueToday.map((h) => {
                const c = colorOf(h.color);
                return React.createElement(
                  'div',
                  { key: h.id, className: 'm-row', style: { gap: 12 } },
                  React.createElement(SCheck, {
                    checked: h.done,
                    done: true,
                    onChange: () => update('homework', h.id, { done: !h.done }),
                  }),
                  React.createElement(
                    'div',
                    { style: { flex: 1 } },
                    React.createElement(
                      'div',
                      {
                        style: {
                          fontWeight: 700,
                          color: 'var(--text-strong)',
                          fontSize: 'var(--text-sm)',
                        },
                      },
                      h.title,
                    ),
                    React.createElement(
                      'div',
                      { className: 'm-muted', style: { fontSize: 'var(--text-xs)' } },
                      className(h.classId),
                    ),
                  ),
                  React.createElement('span', {
                    style: { width: 10, height: 10, borderRadius: 9, background: c.base },
                  }),
                );
              }),
            )
          : React.createElement(Empty, {
              icon: 'check',
              title: t('dash_all_caught'),
              sub: t('dash_no_hw_today'),
            }),
      ),
    ),
  );
}

// ---- Homework ----
function HomeworkScreen() {
  const { data, add, update, remove } = useStore();
  const { t, lang } = useLang();
  const [filter, setFilter] = React.useState('all');
  const [modal, setModal] = React.useState(null);
  const className = (id) => (data.classes.find((c) => c.id === id) || {}).name || '—';

  const list = data.homework.filter((h) =>
    filter === 'all' ? true : filter === 'open' ? !h.done : h.done,
  );
  const done = data.homework.filter((h) => h.done).length;
  const pct = data.homework.length ? Math.round((done / data.homework.length) * 100) : 0;
  const today = iso(TODAY);

  const openNew = () =>
    setModal({
      title: '',
      classId: data.classes[0]?.id || '',
      due: today,
      color: data.classes[0]?.color || 'orange',
      done: false,
      points: 10,
      notes: '',
    });
  const save = (f) => {
    if (!f.title.trim()) f.title = t('hw_untitled');
    if (f.id) update('homework', f.id, f);
    else add('homework', f);
    setModal(null);
  };

  return React.createElement(
    'div',
    { className: 'content' },
    React.createElement(PageHeader, {
      title: t('hw_title'),
      subtitle: t('hw_sub'),
      actions: React.createElement(
        SBtn,
        {
          variant: 'primary',
          iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }),
          onClick: openNew,
        },
        t('hw_add'),
      ),
    }),
    React.createElement(
      SC,
      { style: { padding: 18 } },
      React.createElement(
        'div',
        { className: 'm-spread', style: { marginBottom: 10 } },
        React.createElement(
          'div',
          { style: { fontWeight: 800, color: 'var(--text-strong)' } },
          t('hw_complete', { done, total: data.homework.length }),
        ),
        React.createElement('div', { className: 'm-mono m-muted' }, `${pct}%`),
      ),
      React.createElement(SProg, { value: pct, color: 'green' }),
    ),
    React.createElement(DS.Tabs, {
      value: filter,
      onChange: setFilter,
      tabs: [
        { id: 'all', label: t('all') },
        { id: 'open', label: t('hw_tab_open') },
        { id: 'done', label: t('hw_tab_done') },
      ],
    }),
    React.createElement(
      'div',
      { className: 'm-stack' },
      list.length
        ? list.map((h) => {
            const c = colorOf(h.color);
            const overdue = !h.done && h.due < today;
            return React.createElement(
              'div',
              { key: h.id, className: 'lrow' },
              React.createElement(SCheck, {
                checked: h.done,
                done: true,
                onChange: () => update('homework', h.id, { done: !h.done }),
              }),
              React.createElement('div', { className: 'lrow__bar', style: { background: c.base } }),
              React.createElement(
                'div',
                { style: { flex: 1 } },
                React.createElement(
                  'div',
                  {
                    className: 'lrow__title',
                    style: {
                      textDecoration: h.done ? 'line-through' : 'none',
                      opacity: h.done ? 0.55 : 1,
                    },
                  },
                  h.title,
                ),
                React.createElement(
                  'div',
                  { className: 'lrow__meta' },
                  React.createElement(STag, { color: h.color }, className(h.classId)),
                  React.createElement(
                    'span',
                    { className: 'm-row', style: { gap: 5 } },
                    React.createElement(MIcon, { name: 'clock', size: 14 }),
                    overdue
                      ? React.createElement(
                          'strong',
                          { style: { color: 'var(--danger)' } },
                          t('hw_overdue'),
                        )
                      : new Date(h.due).toLocaleDateString(locale(lang), {
                          month: 'short',
                          day: 'numeric',
                        }),
                  ),
                  h.points != null &&
                    h.points !== '' &&
                    React.createElement(
                      'span',
                      {
                        className: 'mchip',
                        style: { background: 'var(--cream-200)', color: 'var(--text-body)' },
                      },
                      React.createElement(MIcon, { name: 'flag', size: 12 }),
                      t('hw_pts', { n: h.points }),
                    ),
                ),
                h.notes &&
                  React.createElement(
                    'div',
                    {
                      className: 'm-muted',
                      style: { fontSize: 'var(--text-sm)', marginTop: 6, textWrap: 'pretty' },
                    },
                    h.notes,
                  ),
              ),
              React.createElement(
                'div',
                { className: 'lrow__actions' },
                React.createElement(
                  SIB,
                  { label: t('edit'), size: 'sm', onClick: () => setModal({ ...h }) },
                  React.createElement(MIcon, { name: 'edit', size: 16 }),
                ),
                React.createElement(
                  SIB,
                  { label: t('delete'), size: 'sm', onClick: () => remove('homework', h.id) },
                  React.createElement(MIcon, { name: 'trash', size: 16 }),
                ),
              ),
            );
          })
        : React.createElement(
            SC,
            null,
            React.createElement(Empty, {
              icon: 'clipboard',
              title: t('hw_no_tasks'),
              sub: t('hw_add_start'),
            }),
          ),
    ),
    modal &&
      React.createElement(
        Modal,
        {
          open: true,
          onClose: () => setModal(null),
          title: modal.id ? t('hw_edit_task') : t('hw_new_task'),
          width: 480,
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(
              SBtn,
              { variant: 'secondary', onClick: () => setModal(null) },
              t('cancel'),
            ),
            React.createElement(
              SBtn,
              { variant: 'primary', onClick: () => save(modal) },
              t('save'),
            ),
          ),
        },
        React.createElement(
          'div',
          { className: 'mochi-field' },
          React.createElement('label', { className: 'mochi-field__label' }, t('hw_task')),
          React.createElement('input', {
            className: 'mochi-input',
            autoFocus: true,
            value: modal.title,
            onChange: (e) => setModal((m) => ({ ...m, title: e.target.value })),
          }),
        ),
        React.createElement(
          'div',
          { className: 'm-grid cols-2', style: { gap: 14 } },
          React.createElement(MSelect, {
            label: t('class'),
            value: modal.classId,
            onChange: (v) => {
              const c = data.classes.find((x) => x.id === v);
              setModal((m) => ({ ...m, classId: v, color: c ? c.color : m.color }));
            },
            options: data.classes.map((c) => ({ value: c.id, label: c.name })),
          }),
          React.createElement(
            'div',
            { className: 'mochi-field' },
            React.createElement('label', { className: 'mochi-field__label' }, t('hw_due')),
            React.createElement('input', {
              type: 'date',
              className: 'mochi-input',
              value: modal.due,
              onChange: (e) => setModal((m) => ({ ...m, due: e.target.value })),
            }),
          ),
        ),
        React.createElement(
          'div',
          { className: 'mochi-field', style: { maxWidth: 160 } },
          React.createElement('label', { className: 'mochi-field__label' }, t('hw_points')),
          React.createElement('input', {
            type: 'number',
            min: 0,
            className: 'mochi-input',
            value: modal.points ?? '',
            onChange: (e) =>
              setModal((m) => ({
                ...m,
                points: e.target.value === '' ? '' : Number(e.target.value),
              })),
          }),
        ),
        React.createElement(
          'div',
          { className: 'mochi-field' },
          React.createElement('label', { className: 'mochi-field__label' }, t('hw_notes')),
          React.createElement('textarea', {
            className: 'mochi-input',
            rows: 3,
            style: { resize: 'vertical', minHeight: 72, paddingTop: 10 },
            placeholder: t('hw_notes_ph'),
            value: modal.notes || '',
            onChange: (e) => setModal((m) => ({ ...m, notes: e.target.value })),
          }),
        ),
      ),
  );
}

export { DashboardScreen, HomeworkScreen };
