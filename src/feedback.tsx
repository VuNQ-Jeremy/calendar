import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { Modal, MSelect, PageHeader, Empty } from './ui.jsx';
import { colorOf, iso, TODAY } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { BUILD_ID } from './lib/build-id.js';
import type { FeedbackRow } from '../server/services/feedback.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Tag: FTag, Badge: FBadge } = DS;

interface FeedbackCategory {
  tk: string;
  icon: import('./icons.jsx').IconName;
  color: string;
}

export const FEEDBACK_CATEGORIES: Record<string, FeedbackCategory> = {
  idea: { tk: 'cat_idea', icon: 'sparkle', color: 'blue' },
  bug: { tk: 'cat_bug', icon: 'flag', color: 'rose' },
  praise: { tk: 'cat_praise', icon: 'star', color: 'green' },
  other: { tk: 'cat_other', icon: 'message', color: 'cocoa' },
};

const STATUS: Record<string, { tk: string; badge: string }> = {
  new: { tk: 'st_new', badge: 'brand' },
  reviewed: { tk: 'st_reviewed', badge: 'blue' },
  done: { tk: 'st_done', badge: 'green' },
};

const ICON_TINT = (color: string) => {
  const c = colorOf(color);
  return { background: c.soft, color: c.ink };
};

export interface FeedbackDraft {
  id?: string;
  message: string;
  category: string;
  author: string | null;
  status: string;
  createdAt?: string | null;
}

export const newFeedbackDraft = (user: { name?: string } | null | undefined): FeedbackDraft => ({
  message: '',
  category: 'idea',
  author: (user && user.name) || '',
  status: 'new',
  createdAt: iso(TODAY),
});

interface FeedbackModalProps {
  draft: FeedbackDraft;
  setDraft: React.Dispatch<React.SetStateAction<FeedbackDraft | null>>;
  onClose: () => void;
  onSave: (f: FeedbackDraft) => void;
}

export function FeedbackModal({ draft, setDraft, onClose, onSave }: FeedbackModalProps) {
  const { t } = useLang();
  const set = <K extends keyof FeedbackDraft>(k: K, v: FeedbackDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
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

interface FeedbackScreenProps {
  user: { name?: string } | null;
}

export function FeedbackScreen({ user }: FeedbackScreenProps) {
  const { feedback: list } = useLoaderData() as { feedback: FeedbackRow[] };
  const fetcher = useFetcher();
  const { t } = useLang();
  const [filter, setFilter] = React.useState('all');
  const [modal, setModal] = React.useState<FeedbackDraft | null>(null);

  const shown = list.filter((f) => (filter === 'all' ? true : f.status === filter));
  const counts = {
    all: list.length,
    new: list.filter((f) => f.status === 'new').length,
    reviewed: list.filter((f) => f.status === 'reviewed').length,
    done: list.filter((f) => f.status === 'done').length,
  };

  const openNew = () => setModal(newFeedbackDraft(user));

  const save = (f: FeedbackDraft) => {
    if (!f.message.trim()) return;
    const fd = new FormData();
    if (f.id) {
      fd.set('intent', 'update');
      fd.set('id', f.id);
      fd.set('message', f.message);
      fd.set('category', f.category);
      fd.set('author', f.author || '');
      fd.set('status', f.status);
    } else {
      fd.set('intent', 'create');
      fd.set('message', f.message);
      fd.set('category', f.category);
      fd.set('author', f.author || '');
      fd.set('status', f.status);
      fd.set('createdAt', f.createdAt || '');
      fd.set('appVersion', BUILD_ID);
    }
    fetcher.submit(fd, { action: '/feedback', method: 'post' });
    setModal(null);
  };

  const toggleDone = (f: FeedbackRow) => {
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('id', f.id);
    fd.set('status', f.status === 'done' ? 'new' : 'done');
    fetcher.submit(fd, { action: '/feedback', method: 'post' });
  };

  const removeFeedback = (id: string) => {
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/feedback', method: 'post' });
  };

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
            const cat = FEEDBACK_CATEGORIES[f.category] ?? FEEDBACK_CATEGORIES.other;
            const st = STATUS[f.status] ?? STATUS.new;
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
                      textWrap: 'pretty' as React.CSSProperties['textWrap'],
                    }}
                  >
                    {f.message}
                  </div>
                  <div className="lrow__meta">
                    <FTag color={cat.color as 'blue'}>{t(cat.tk)}</FTag>
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
                    {f.appVersion && (
                      <span
                        className="m-row"
                        style={{ gap: 5, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                        title="Build the report came from"
                      >
                        {f.appVersion}
                      </span>
                    )}
                  </div>
                </div>
                <FBadge color={st.badge as 'brand'}>{t(st.tk)}</FBadge>
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
                  <FIB label={t('delete')} size="sm" onClick={() => removeFeedback(f.id)}>
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
          setDraft={setModal as React.Dispatch<React.SetStateAction<FeedbackDraft | null>>}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
