// src/feedback.jsx — Feedback: a log of submitted feedback + the shared submit modal.
import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.jsx';
import { Modal, MSelect, PageHeader, Empty } from './ui.jsx';
import { colorOf, iso, TODAY } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';

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
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={draft.id ? t('fb_edit') : t('fb_share')}
      width={520}
      footer={
        <>
          <FBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </FBtn>
          <FBtn variant="primary" onClick={() => onSave(draft)}>
            {draft.id ? t('save') : t('fb_send')}
          </FBtn>
        </>
      }
    >
      <MSelect
        label={t('fb_type')}
        value={draft.category}
        onChange={(v) => set('category', v)}
        options={Object.entries(FEEDBACK_CATEGORIES).map(([k, v]) => ({
          value: k,
          label: t(v.tk),
        }))}
      />
      <div className="mochi-field">
        <label className="mochi-field__label">{t('fb_message')}</label>
        <textarea
          className="mochi-input"
          rows={4}
          autoFocus={true}
          style={{ resize: 'vertical', minHeight: 96, paddingTop: 10 }}
          placeholder={t('fb_message_ph')}
          value={draft.message}
          onChange={(e) => set('message', e.target.value)}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('fb_from')}</label>
          <input
            className="mochi-input"
            placeholder={t('auth_your_name')}
            value={draft.author || ''}
            onChange={(e) => set('author', e.target.value)}
          />
        </div>
        {draft.id && (
          <MSelect
            label={t('fb_status')}
            value={draft.status}
            onChange={(v) => set('status', v)}
            options={Object.entries(STATUS).map(([k, v]) => ({ value: k, label: t(v.tk) }))}
          />
        )}
      </div>
    </Modal>
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

  return (
    <div className="content">
      <PageHeader
        title={t('fb_title')}
        subtitle={t('fb_sub')}
        actions={
          <FBtn variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openNew}>
            {t('fb_log')}
          </FBtn>
        }
      />
      <DS.Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: t('fb_tab_all', { n: counts.all }) },
          { id: 'new', label: t('fb_tab_new', { n: counts.new }) },
          { id: 'reviewed', label: t('fb_tab_reviewed', { n: counts.reviewed }) },
          { id: 'done', label: t('fb_tab_done', { n: counts.done }) },
        ]}
      />
      {shown.length ? (
        <div className="m-stack">
          {shown.map((f) => {
            const cat = FEEDBACK_CATEGORIES[f.category] || FEEDBACK_CATEGORIES.other;
            const st = STATUS[f.status] || STATUS.new;
            return (
              <div key={f.id} className="lrow" style={{ alignItems: 'flex-start' }}>
                <div
                  className="iconwrap"
                  style={{ width: 40, height: 40, ...ICON_TINT(cat.color) }}
                >
                  <MIcon name={cat.icon} size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color: 'var(--text-strong)',
                      fontSize: 'var(--text-md)',
                      textWrap: 'pretty',
                    }}
                  >
                    {f.message}
                  </div>
                  <div className="lrow__meta">
                    <FTag color={cat.color}>{t(cat.tk)}</FTag>
                    {f.author && (
                      <span className="m-row" style={{ gap: 5 }}>
                        <MIcon name="users" size={13} />
                        {f.author}
                      </span>
                    )}
                    {f.createdAt && (
                      <span className="m-row" style={{ gap: 5 }}>
                        <MIcon name="clock" size={13} />
                        {new Date(f.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <FBadge color={st.badge}>{t(st.tk)}</FBadge>
                <div className="lrow__actions">
                  <FIB
                    label={f.status === 'done' ? t('fb_reopen') : t('fb_resolve')}
                    size="sm"
                    onClick={() => toggleDone(f)}
                  >
                    <MIcon name="check" size={16} />
                  </FIB>
                  <FIB label={t('edit')} size="sm" onClick={() => setModal({ ...f })}>
                    <MIcon name="edit" size={16} />
                  </FIB>
                  <FIB label={t('delete')} size="sm" onClick={() => remove('feedback', f.id)}>
                    <MIcon name="trash" size={16} />
                  </FIB>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <FC>
          <Empty icon="message" title={t('fb_none_title')} sub={t('fb_none_sub')} />
        </FC>
      )}

      {modal && (
        <FeedbackModal
          draft={modal}
          setDraft={setModal}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
