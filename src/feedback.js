// src/feedback.js — Feedback: a log of submitted feedback + the shared submit modal.
import { React, DS } from './lib/globals.js';
import { MIcon } from './icons.js';
import { useStore } from './store.js';
import { Modal, MSelect, PageHeader, Empty } from './ui.js';
import { colorOf, iso, TODAY } from './lib/core.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Tag: FTag, Badge: FBadge } = DS;

export const FEEDBACK_CATEGORIES = {
  idea:   { label: 'Idea',   icon: 'sparkle', color: 'blue' },
  bug:    { label: 'Bug',    icon: 'flag',    color: 'rose' },
  praise: { label: 'Praise', icon: 'star',    color: 'green' },
  other:  { label: 'Other',  icon: 'message', color: 'cocoa' },
};

const STATUS = {
  new:      { label: 'New',      badge: 'brand' },
  reviewed: { label: 'Reviewed', badge: 'blue' },
  done:     { label: 'Resolved', badge: 'green' },
};

const ICON_TINT = (color) => { const c = colorOf(color); return { background: c.soft, color: c.ink }; };

// A fresh draft for a new piece of feedback (author defaults to the current user).
export const newFeedbackDraft = (user) => ({
  message: '', category: 'idea', author: (user && user.name) || '', status: 'new', createdAt: iso(TODAY),
});

// Shared submit/edit modal — used by the sidebar "Give feedback" button and the page.
export function FeedbackModal({ draft, setDraft, onClose, onSave }) {
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return React.createElement(Modal, {
    open: true, onClose, title: draft.id ? 'Edit feedback' : 'Share feedback', width: 520,
    footer: React.createElement(React.Fragment, null,
      React.createElement(FBtn, { variant: 'secondary', onClick: onClose }, 'Cancel'),
      React.createElement(FBtn, { variant: 'primary', onClick: () => onSave(draft) }, draft.id ? 'Save' : 'Send feedback'),
    ),
  },
    React.createElement(MSelect, {
      label: 'Type', value: draft.category, onChange: (v) => set('category', v),
      options: Object.entries(FEEDBACK_CATEGORIES).map(([k, v]) => ({ value: k, label: v.label })),
    }),
    React.createElement('div', { className: 'mochi-field' },
      React.createElement('label', { className: 'mochi-field__label' }, 'Your feedback'),
      React.createElement('textarea', {
        className: 'mochi-input', rows: 4, autoFocus: true,
        style: { resize: 'vertical', minHeight: 96, paddingTop: 10 },
        placeholder: 'What’s working well, what could be better, or an idea you have…',
        value: draft.message, onChange: (e) => set('message', e.target.value),
      }),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' },
        React.createElement('label', { className: 'mochi-field__label' }, 'From'),
        React.createElement('input', { className: 'mochi-input', placeholder: 'Your name', value: draft.author || '', onChange: (e) => set('author', e.target.value) }),
      ),
      draft.id && React.createElement(MSelect, {
        label: 'Status', value: draft.status, onChange: (v) => set('status', v),
        options: Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.label })),
      }),
    ),
  );
}

export function FeedbackScreen({ user }) {
  const { data, add, update, remove } = useStore();
  const list = data.feedback || [];
  const [filter, setFilter] = React.useState('all');
  const [modal, setModal] = React.useState(null);

  const shown = list.filter((f) => (filter === 'all' ? true : f.status === filter));
  const counts = {
    all: list.length,
    new: list.filter((f) => f.status === 'new').length,
    reviewed: list.filter((f) => f.status === 'reviewed').length,
    done: list.filter((f) => f.status === 'done').length,
  };

  const openNew = () => setModal(newFeedbackDraft(user));
  const save = (f) => { if (!f.message.trim()) return; if (f.id) update('feedback', f.id, f); else add('feedback', f); setModal(null); };
  const toggleDone = (f) => update('feedback', f.id, { status: f.status === 'done' ? 'new' : 'done' });

  return React.createElement('div', { className: 'content' },
    React.createElement(PageHeader, {
      title: 'Feedback', subtitle: 'Ideas, bug reports, and praise from your team',
      actions: React.createElement(FBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNew }, 'Log feedback'),
    }),
    React.createElement(DS.Tabs, {
      value: filter, onChange: setFilter,
      tabs: [
        { id: 'all', label: `All · ${counts.all}` },
        { id: 'new', label: `New · ${counts.new}` },
        { id: 'reviewed', label: `Reviewed · ${counts.reviewed}` },
        { id: 'done', label: `Resolved · ${counts.done}` },
      ],
    }),
    shown.length
      ? React.createElement('div', { className: 'm-stack' },
          shown.map((f) => {
            const cat = FEEDBACK_CATEGORIES[f.category] || FEEDBACK_CATEGORIES.other;
            const st = STATUS[f.status] || STATUS.new;
            return React.createElement('div', { key: f.id, className: 'lrow', style: { alignItems: 'flex-start' } },
              React.createElement('div', { className: 'iconwrap', style: { width: 40, height: 40, ...ICON_TINT(cat.color) } }, React.createElement(MIcon, { name: cat.icon, size: 18 })),
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', { style: { fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--text-md)', textWrap: 'pretty' } }, f.message),
                React.createElement('div', { className: 'lrow__meta' },
                  React.createElement(FTag, { color: cat.color }, cat.label),
                  f.author && React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'users', size: 13 }), f.author),
                  f.createdAt && React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'clock', size: 13 }), new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
                ),
              ),
              React.createElement(FBadge, { color: st.badge }, st.label),
              React.createElement('div', { className: 'lrow__actions' },
                React.createElement(FIB, { label: f.status === 'done' ? 'Reopen' : 'Mark resolved', size: 'sm', onClick: () => toggleDone(f) }, React.createElement(MIcon, { name: 'check', size: 16 })),
                React.createElement(FIB, { label: 'Edit', size: 'sm', onClick: () => setModal({ ...f }) }, React.createElement(MIcon, { name: 'edit', size: 16 })),
                React.createElement(FIB, { label: 'Delete', size: 'sm', onClick: () => remove('feedback', f.id) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
              ),
            );
          }),
        )
      : React.createElement(FC, null, React.createElement(Empty, { icon: 'message', title: 'No feedback yet', sub: 'Use “Give feedback” in the sidebar to log the first one.' })),

    modal && React.createElement(FeedbackModal, { draft: modal, setDraft: setModal, onClose: () => setModal(null), onSave: save }),
  );
}
