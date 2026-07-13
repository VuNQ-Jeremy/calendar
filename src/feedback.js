// src/feedback.js — Feedback: a log of submitted feedback + the shared submit modal.
import { React, DS } from './lib/globals.js';
import { MIcon } from './icons.js';
import { useStore } from './store.js';
import { Modal, MSelect, PageHeader, Empty } from './ui.js';
import { colorOf, iso, TODAY } from './lib/core.js';
import { useLang } from './lib/i18n.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Tag: FTag, Badge: FBadge } = DS;

// Category + status metadata; labels are translated at render via t().
export const FEEDBACK_CATEGORIES = {
  idea: { tk: 'cat_idea', icon: 'sparkle', color: 'blue' },
  bug: { tk: 'cat_bug', icon: 'flag', color: 'rose' },
  praise: { tk: 'cat_praise', icon: 'star', color: 'green' },
  other: { tk: 'cat_other', icon: 'message', color: 'cocoa' },
};

const STATUS = {
  new: { tk: 'st_new', badge: 'brand' },
  reviewed: { tk: 'st_reviewed', badge: 'blue' },
  done: { tk: 'st_done', badge: 'green' },
};

const ICON_TINT = (color) => {
  const c = colorOf(color);
  return { background: c.soft, color: c.ink };
};

export const newFeedbackDraft = (user) => ({
  message: '',
  category: 'idea',
  author: (user && user.name) || '',
  status: 'new',
  createdAt: iso(TODAY),
});

export function FeedbackModal({ draft, setDraft, onClose, onSave }) {
  const { t } = useLang();
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return React.createElement(
    Modal,
    {
      open: true,
      onClose,
      title: draft.id ? t('fb_edit') : t('fb_share'),
      width: 520,
      footer: React.createElement(
        React.Fragment,
        null,
        React.createElement(FBtn, { variant: 'secondary', onClick: onClose }, t('cancel')),
        React.createElement(
          FBtn,
          { variant: 'primary', onClick: () => onSave(draft) },
          draft.id ? t('save') : t('fb_send'),
        ),
      ),
    },
    React.createElement(MSelect, {
      label: t('fb_type'),
      value: draft.category,
      onChange: (v) => set('category', v),
      options: Object.entries(FEEDBACK_CATEGORIES).map(([k, v]) => ({ value: k, label: t(v.tk) })),
    }),
    React.createElement(
      'div',
      { className: 'mochi-field' },
      React.createElement('label', { className: 'mochi-field__label' }, t('fb_message')),
      React.createElement('textarea', {
        className: 'mochi-input',
        rows: 4,
        autoFocus: true,
        style: { resize: 'vertical', minHeight: 96, paddingTop: 10 },
        placeholder: t('fb_message_ph'),
        value: draft.message,
        onChange: (e) => set('message', e.target.value),
      }),
    ),
    React.createElement(
      'div',
      { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement(
        'div',
        { className: 'mochi-field' },
        React.createElement('label', { className: 'mochi-field__label' }, t('fb_from')),
        React.createElement('input', {
          className: 'mochi-input',
          placeholder: t('auth_your_name'),
          value: draft.author || '',
          onChange: (e) => set('author', e.target.value),
        }),
      ),
      draft.id &&
        React.createElement(MSelect, {
          label: t('fb_status'),
          value: draft.status,
          onChange: (v) => set('status', v),
          options: Object.entries(STATUS).map(([k, v]) => ({ value: k, label: t(v.tk) })),
        }),
    ),
  );
}

export function FeedbackScreen({ user }) {
  const { data, add, update, remove } = useStore();
  const { t } = useLang();
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
  const save = (f) => {
    if (!f.message.trim()) return;
    if (f.id) update('feedback', f.id, f);
    else add('feedback', f);
    setModal(null);
  };
  const toggleDone = (f) =>
    update('feedback', f.id, { status: f.status === 'done' ? 'new' : 'done' });

  return React.createElement(
    'div',
    { className: 'content' },
    React.createElement(PageHeader, {
      title: t('fb_title'),
      subtitle: t('fb_sub'),
      actions: React.createElement(
        FBtn,
        {
          variant: 'primary',
          iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }),
          onClick: openNew,
        },
        t('fb_log'),
      ),
    }),
    React.createElement(DS.Tabs, {
      value: filter,
      onChange: setFilter,
      tabs: [
        { id: 'all', label: t('fb_tab_all', { n: counts.all }) },
        { id: 'new', label: t('fb_tab_new', { n: counts.new }) },
        { id: 'reviewed', label: t('fb_tab_reviewed', { n: counts.reviewed }) },
        { id: 'done', label: t('fb_tab_done', { n: counts.done }) },
      ],
    }),
    shown.length
      ? React.createElement(
          'div',
          { className: 'm-stack' },
          shown.map((f) => {
            const cat = FEEDBACK_CATEGORIES[f.category] || FEEDBACK_CATEGORIES.other;
            const st = STATUS[f.status] || STATUS.new;
            return React.createElement(
              'div',
              { key: f.id, className: 'lrow', style: { alignItems: 'flex-start' } },
              React.createElement(
                'div',
                {
                  className: 'iconwrap',
                  style: { width: 40, height: 40, ...ICON_TINT(cat.color) },
                },
                React.createElement(MIcon, { name: cat.icon, size: 18 }),
              ),
              React.createElement(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                React.createElement(
                  'div',
                  {
                    style: {
                      fontWeight: 700,
                      color: 'var(--text-strong)',
                      fontSize: 'var(--text-md)',
                      textWrap: 'pretty',
                    },
                  },
                  f.message,
                ),
                React.createElement(
                  'div',
                  { className: 'lrow__meta' },
                  React.createElement(FTag, { color: cat.color }, t(cat.tk)),
                  f.author &&
                    React.createElement(
                      'span',
                      { className: 'm-row', style: { gap: 5 } },
                      React.createElement(MIcon, { name: 'users', size: 13 }),
                      f.author,
                    ),
                  f.createdAt &&
                    React.createElement(
                      'span',
                      { className: 'm-row', style: { gap: 5 } },
                      React.createElement(MIcon, { name: 'clock', size: 13 }),
                      new Date(f.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      }),
                    ),
                ),
              ),
              React.createElement(FBadge, { color: st.badge }, t(st.tk)),
              React.createElement(
                'div',
                { className: 'lrow__actions' },
                React.createElement(
                  FIB,
                  {
                    label: f.status === 'done' ? t('fb_reopen') : t('fb_resolve'),
                    size: 'sm',
                    onClick: () => toggleDone(f),
                  },
                  React.createElement(MIcon, { name: 'check', size: 16 }),
                ),
                React.createElement(
                  FIB,
                  { label: t('edit'), size: 'sm', onClick: () => setModal({ ...f }) },
                  React.createElement(MIcon, { name: 'edit', size: 16 }),
                ),
                React.createElement(
                  FIB,
                  { label: t('delete'), size: 'sm', onClick: () => remove('feedback', f.id) },
                  React.createElement(MIcon, { name: 'trash', size: 16 }),
                ),
              ),
            );
          }),
        )
      : React.createElement(
          FC,
          null,
          React.createElement(Empty, {
            icon: 'message',
            title: t('fb_none_title'),
            sub: t('fb_none_sub'),
          }),
        ),

    modal &&
      React.createElement(FeedbackModal, {
        draft: modal,
        setDraft: setModal,
        onClose: () => setModal(null),
        onSave: save,
      }),
  );
}
