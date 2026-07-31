import React from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, ColorPicker, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { fetchGeneratedWords } from '../lib/generate-client.js';
import { VOCAB_TOPICS, vocabTopicLabel } from '../../shared/logic/vocab-topics';
import type { FlashcardTopicRow } from '../../server/services/flashcards.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Input: FInput } = DS;

type LoaderData = {
  topics: FlashcardTopicRow[];
  kind: 'staff' | 'student';
  canUseAi: boolean;
};

interface TopicDraft {
  id?: string;
  name: string;
  description: string;
  color: string;
}

export function FlashcardTopicsScreen() {
  const { topics, kind, canUseAi } = useLoaderData() as LoaderData;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { t } = useLang();
  const [modal, setModal] = React.useState<TopicDraft | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [confirm, confirmNode] = useConfirm();
  const isStaff = kind === 'staff';

  // The generate-topic action replies with the new topic, so land the teacher straight in it.
  const generated = fetcher.data as { topic?: { slug: string | null; id: string } } | undefined;
  React.useEffect(() => {
    const created = generated?.topic;
    if (created) navigate(`/vocabulary/${created.slug ?? created.id}`);
  }, [generated, navigate]);

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
            <span className="m-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {canUseAi && (
                <FBtn
                  variant="secondary"
                  iconLeft={<MIcon name="sparkle" size={18} />}
                  onClick={() => setGenerating(true)}
                >
                  {t('fc_gen_new_btn')}
                </FBtn>
              )}
              <FBtn
                variant="primary"
                iconLeft={<MIcon name="plus" size={18} />}
                onClick={() => setModal({ name: '', description: '', color: 'violet' })}
              >
                {t('fc_new_topic')}
              </FBtn>
            </span>
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
                onClick={() => navigate(`/vocabulary/${topic.slug ?? topic.id}`)}
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
      {generating && <GenerateTopicModal fetcher={fetcher} onClose={() => setGenerating(false)} />}
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

// ---- AI topic generation ----

type GenRow = {
  word: string;
  meaningVi: string;
  definitionEn: string;
  ipa: string;
  include: boolean;
};

const GEN_LEVELS = ['any', 'beginner', 'intermediate', 'advanced'] as const;

/**
 * Create a whole topic from a name: pick from the curated list (or type your own), let Claude
 * propose the words, review them, then save. The topic and its words are written in one action
 * (`generate-topic`), so an abandoned review never leaves an empty topic behind.
 */
function GenerateTopicModal({
  fetcher,
  onClose,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const [step, setStep] = React.useState<'setup' | 'review'>('setup');
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('violet');
  const [count, setCount] = React.useState('20');
  const [level, setLevel] = React.useState<(typeof GEN_LEVELS)[number]>('any');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<GenRow[]>([]);

  // Picking from the catalog fills the name field rather than hiding a second value: the name is
  // both what the topic is called and what the model is asked for, and it stays editable.
  const pick = (id: string) => {
    if (id === 'custom') {
      setName('');
      return;
    }
    setName(VOCAB_TOPICS.find((vt) => vt.id === id)?.en ?? '');
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await fetchGeneratedWords({
      topic: name.trim(),
      count: Math.min(Math.max(parseInt(count, 10) || 20, 1), 50),
      level: level === 'any' ? null : level,
      exclude: [],
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(res.error === 'disabled' ? 'fc_gen_disabled' : 'fc_gen_failed'));
      return;
    }
    if (res.words.length === 0) {
      setError(t('fc_gen_empty'));
      return;
    }
    setRows(
      res.words.map((w) => ({
        word: w.word,
        meaningVi: w.meaningVi,
        definitionEn: w.definitionEn ?? '',
        ipa: w.ipa ?? '',
        include: true,
      })),
    );
    setStep('review');
  };

  const setRow = (i: number, patch: Partial<GenRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const readyCount = rows.filter((r) => r.include && r.word.trim()).length;

  const submit = () => {
    const words = rows
      .filter((r) => r.include && r.word.trim())
      .map((r) => ({
        word: r.word.trim(),
        meaningVi: r.meaningVi.trim(),
        ipa: r.ipa.trim() || null,
        definitionEn: r.definitionEn.trim() || null,
      }));
    if (words.length === 0 || !name.trim()) return;
    const fd = new FormData();
    fd.set('intent', 'generate-topic');
    fd.set('name', name.trim());
    fd.set('description', '');
    fd.set('color', color);
    fd.set('words', JSON.stringify(words));
    fetcher.submit(fd, { method: 'post' });
    onClose();
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('fc_gen_new_title')}
      width={640}
      footer={
        step === 'setup' ? (
          <>
            <FBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </FBtn>
            <FBtn
              variant="primary"
              iconLeft={<MIcon name="sparkle" size={16} />}
              disabled={!name.trim() || busy}
              onClick={run}
            >
              {busy ? t('fc_gen_running') : t('fc_gen_run')}
            </FBtn>
          </>
        ) : (
          <>
            <FBtn variant="secondary" onClick={() => setStep('setup')}>
              {t('cancel')}
            </FBtn>
            <FBtn variant="primary" disabled={readyCount === 0} onClick={submit}>
              {t('fc_gen_new_save', { n: readyCount })}
            </FBtn>
          </>
        )
      }
    >
      {step === 'setup' ? (
        <>
          <MSelect
            label={t('fc_gen_topic_pick')}
            value={VOCAB_TOPICS.find((vt) => vt.en === name)?.id ?? (name ? 'custom' : '')}
            onChange={pick}
            options={[
              { value: '', label: t('fc_gen_topic_pick') },
              ...VOCAB_TOPICS.map((vt) => ({ value: vt.id, label: vocabTopicLabel(vt, lang) })),
              { value: 'custom', label: t('fc_gen_topic_custom') },
            ]}
            hint={t('fc_gen_new_hint')}
          />
          <FInput
            label={t('fc_topic_name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <div className="mochi-field">
              <label className="mochi-field__label">{t('fc_gen_count')}</label>
              <input
                className="mochi-input"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <MSelect
              label={t('fc_gen_level')}
              value={level}
              onChange={(v) => setLevel(v as (typeof GEN_LEVELS)[number])}
              options={GEN_LEVELS.map((l) => ({ value: l, label: t(`fc_gen_level_${l}`) }))}
            />
          </div>
          <ColorPicker label={t('color')} value={color} onChange={setColor} />
          {busy && <span className="mochi-field__hint">{t('fc_gen_wait')}</span>}
          {error && (
            <span className="mochi-field__hint" style={{ color: 'var(--red-600, #c0392b)' }}>
              {error}
            </span>
          )}
        </>
      ) : (
        <div className="m-stack" style={{ gap: 8 }}>
          {rows.map((r, i) => (
            <div
              key={i}
              className="lrow"
              style={{ alignItems: 'center', gap: 10, opacity: r.include ? 1 : 0.5 }}
            >
              <input
                type="checkbox"
                checked={r.include}
                onChange={(e) => setRow(i, { include: e.target.checked })}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{r.word}</span>
                  {r.ipa && (
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      {r.ipa}
                    </span>
                  )}
                </div>
                {r.definitionEn && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    {r.definitionEn}
                  </div>
                )}
                <input
                  className="mochi-input"
                  style={{ marginTop: 4 }}
                  placeholder={t('fc_meaning_vi')}
                  value={r.meaningVi}
                  onChange={(e) => setRow(i, { meaningVi: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
