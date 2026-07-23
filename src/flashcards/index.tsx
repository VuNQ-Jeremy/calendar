import React from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, ColorPicker, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import type { FlashcardTopicRow } from '../../server/services/flashcards.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Input: FInput } = DS;

type LoaderData = { topics: FlashcardTopicRow[]; kind: 'staff' | 'student' };

interface TopicDraft {
  id?: string;
  name: string;
  description: string;
  color: string;
}

export function FlashcardTopicsScreen() {
  const { topics, kind } = useLoaderData() as LoaderData;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { t } = useLang();
  const [modal, setModal] = React.useState<TopicDraft | null>(null);
  const [confirm, confirmNode] = useConfirm();
  const isStaff = kind === 'staff';

  const save = (f: TopicDraft) => {
    if (!f.name.trim()) return;
    const fd = new FormData();
    fd.set('intent', f.id ? 'update' : 'create');
    if (f.id) fd.set('id', f.id);
    fd.set('name', f.name);
    fd.set('description', f.description);
    fd.set('color', f.color);
    fetcher.submit(fd, { method: 'post' });
    setModal(null);
  };

  const del = async (topic: FlashcardTopicRow) => {
    const ok = await confirm({
      title: t('fc_delete_topic'),
      message: t('fc_delete_topic_msg', { name: topic.name }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', topic.id);
    fetcher.submit(fd, { method: 'post' });
  };

  return (
    <div className="content">
      <PageHeader
        title={t('fc_title')}
        subtitle={t('fc_subtitle')}
        actions={
          isStaff && (
            <FBtn
              variant="primary"
              iconLeft={<MIcon name="plus" size={18} />}
              onClick={() => setModal({ name: '', description: '', color: 'violet' })}
            >
              {t('fc_new_topic')}
            </FBtn>
          )
        }
      />
      {topics.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {topics.map((topic) => {
            const c = colorOf(topic.color);
            return (
              <FC
                key={topic.id}
                interactive={true}
                onClick={() => navigate(`/flashcards/${topic.id}`)}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: c.base,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      fontWeight: 700,
                      color: 'var(--text-strong)',
                      fontSize: 'var(--text-md)',
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {topic.name}
                  </div>
                  {isStaff && (
                    <div className="lrow__actions" onClick={(e) => e.stopPropagation()}>
                      <FIB
                        label={t('edit')}
                        size="sm"
                        onClick={() =>
                          setModal({
                            id: topic.id,
                            name: topic.name,
                            description: topic.description ?? '',
                            color: topic.color,
                          })
                        }
                      >
                        <MIcon name="edit" size={16} />
                      </FIB>
                      <FIB label={t('delete')} size="sm" onClick={() => del(topic)}>
                        <MIcon name="trash" size={16} />
                      </FIB>
                    </div>
                  )}
                </div>
                {topic.description && (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-sm)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
                      overflow: 'hidden',
                    }}
                  >
                    {topic.description}
                  </div>
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  {t('fc_word_count', { n: topic.wordCount })}
                </div>
              </FC>
            );
          })}
        </div>
      ) : (
        <FC>
          <Empty
            icon="sparkle"
            title={t('fc_no_topics')}
            sub={isStaff ? t('fc_no_topics_sub') : undefined}
          />
        </FC>
      )}

      {modal && (
        <TopicModal
          draft={modal}
          setDraft={setModal}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {confirmNode}
    </div>
  );
}

interface TopicModalProps {
  draft: TopicDraft;
  setDraft: React.Dispatch<React.SetStateAction<TopicDraft | null>>;
  onClose: () => void;
  onSave: (f: TopicDraft) => void;
}

function TopicModal({ draft, setDraft, onClose, onSave }: TopicModalProps) {
  const { t } = useLang();
  const set = <K extends keyof TopicDraft>(k: K, v: TopicDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={draft.id ? t('fc_edit_topic') : t('fc_new_topic')}
      width={480}
      footer={
        <>
          <FBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </FBtn>
          <FBtn variant="primary" onClick={() => onSave(draft)}>
            {t('save')}
          </FBtn>
        </>
      }
    >
      <FInput
        label={t('fc_topic_name')}
        autoFocus={true}
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
      />
      <div className="mochi-field">
        <label className="mochi-field__label">{t('fc_description')}</label>
        <textarea
          className="mochi-input"
          rows={3}
          style={{ resize: 'vertical', minHeight: 72, paddingTop: 10 }}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <ColorPicker label={t('color')} value={draft.color} onChange={(v) => set('color', v)} />
    </Modal>
  );
}
