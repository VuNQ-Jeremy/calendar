import React from 'react';
import type { FetcherWithComponents } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { QuestionRow } from '../../server/services/questions.js';
import type { GradeLevelRow } from '../../server/services/grade-levels.js';

const { Button: MBtn, IconButton: MIB, Checkbox: MCheck } = DS;

const MAX_OPTIONS = 10;

export type QDraftType = 'mcq' | 'multi' | 'text' | 'essay';

export type QuestionDraft = {
  id?: string;
  type: QDraftType;
  prompt: string;
  /** '' means "no grade level" — the select cannot hold null. */
  gradeLevelId: string;
  /** '' means "no difficulty". */
  difficulty: '' | 'easy' | 'medium' | 'hard';
  tags: string[];
  options: { id: string; text: string }[];
  /** mcq -> option id; multi/text -> string[]; essay -> null. */
  answerKey: string | string[] | null;
  explanation: string;
};

export const newQuestionDraft = (): QuestionDraft => ({
  type: 'mcq',
  prompt: '',
  gradeLevelId: '',
  difficulty: '',
  tags: [],
  options: [],
  answerKey: '',
  explanation: '',
});

export const draftFromQuestion = (q: QuestionRow): QuestionDraft => ({
  id: q.id,
  type: q.type,
  prompt: q.prompt,
  gradeLevelId: q.gradeLevelId ?? '',
  difficulty: q.difficulty ?? '',
  tags: [...q.tags],
  options: q.options.map((o) => ({ ...o })),
  answerKey: Array.isArray(q.answerKey) ? [...q.answerKey] : q.answerKey,
  explanation: q.explanation ?? '',
});

/** The zero answer key for a type — what a type switch must reset to. */
const emptyKeyFor = (type: QDraftType): string | string[] | null => {
  if (type === 'mcq') return '';
  if (type === 'multi' || type === 'text') return [];
  return null;
};

const asArray = (k: string | string[] | null): string[] => (Array.isArray(k) ? k : []);

interface ChipInputProps {
  label: string;
  placeholder: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
}

/**
 * Type text, press Enter to commit a chip. Module-level on purpose: a component function created
 * inside the modal's render path would remount on every keystroke and drop the pending text.
 */
function ChipInput({ label, placeholder, hint, values, onChange }: ChipInputProps) {
  const [text, setText] = React.useState('');
  const commit = () => {
    const v = text.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setText('');
  };
  return (
    <div className="mochi-field">
      <label className="mochi-field__label">{label}</label>
      {values.length > 0 && (
        <div className="m-row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {values.map((v) => (
            <span key={v} className="mchip" style={{ gap: 4 }}>
              {v}
              <button
                type="button"
                aria-label={`${label}: ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  color: 'inherit',
                }}
              >
                <MIcon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="mochi-input"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      {hint && (
        <span className="m-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

interface QuestionEditorModalProps {
  draft: QuestionDraft;
  setDraft: React.Dispatch<React.SetStateAction<QuestionDraft | null>>;
  gradeLevels: GradeLevelRow[];
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
}

export function QuestionEditorModal({
  draft,
  setDraft,
  gradeLevels,
  fetcher,
  onClose,
}: QuestionEditorModalProps) {
  const { t } = useLang();
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  /** Switching the type invalidates both the options and the answer key. */
  const setType = (type: QDraftType) => {
    setError(null);
    setDraft((d) => (d ? { ...d, type, options: [], answerKey: emptyKeyFor(type) } : d));
  };

  const trueFalsePreset = () => {
    setError(null);
    setDraft((d) =>
      d
        ? {
            ...d,
            type: 'mcq',
            options: [
              { id: crypto.randomUUID(), text: t('qb_true') },
              { id: crypto.randomUUID(), text: t('qb_false') },
            ],
            answerKey: '',
          }
        : d,
    );
  };

  const addOption = () => {
    if (draft.options.length >= MAX_OPTIONS) return;
    set('options', [...draft.options, { id: crypto.randomUUID(), text: '' }]);
  };

  const setOptionText = (id: string, text: string) =>
    set(
      'options',
      draft.options.map((o) => (o.id === id ? { ...o, text } : o)),
    );

  const removeOption = (id: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            options: d.options.filter((o) => o.id !== id),
            // Drop the removed option from the key so it can never dangle.
            answerKey:
              d.type === 'mcq'
                ? d.answerKey === id
                  ? ''
                  : d.answerKey
                : asArray(d.answerKey).filter((k) => k !== id),
          }
        : d,
    );

  const isCorrect = (id: string) =>
    draft.type === 'mcq' ? draft.answerKey === id : asArray(draft.answerKey).includes(id);

  const toggleCorrect = (id: string) => {
    setError(null);
    if (draft.type === 'mcq') {
      set('answerKey', id);
      return;
    }
    const cur = asArray(draft.answerKey);
    set('answerKey', cur.includes(id) ? cur.filter((k) => k !== id) : [...cur, id]);
  };

  /** Mirrors the server's superRefine so a valid-looking form is never bounced by a 400. */
  const validate = (): string | null => {
    if (!draft.prompt.trim()) return t('qb_err_no_prompt');
    if (draft.type === 'mcq' || draft.type === 'multi') {
      const filled = draft.options.filter((o) => o.text.trim() !== '');
      if (filled.length < 2) return t('qb_err_options_min');
      if (draft.type === 'mcq') {
        if (typeof draft.answerKey !== 'string' || !draft.answerKey) return t('qb_err_no_correct');
        if (!filled.some((o) => o.id === draft.answerKey)) return t('qb_err_no_correct');
      } else {
        const key = asArray(draft.answerKey).filter((k) => filled.some((o) => o.id === k));
        if (!key.length) return t('qb_err_no_correct');
      }
    }
    if (draft.type === 'text' && asArray(draft.answerKey).length === 0) {
      return t('qb_err_no_accepted');
    }
    return null;
  };

  const save = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    const options =
      draft.type === 'mcq' || draft.type === 'multi'
        ? draft.options
            .filter((o) => o.text.trim() !== '')
            .map((o) => ({ ...o, text: o.text.trim() }))
        : [];
    const ids = new Set(options.map((o) => o.id));
    let answerKey: string | string[] | null = null;
    if (draft.type === 'mcq') answerKey = draft.answerKey as string;
    else if (draft.type === 'multi') answerKey = asArray(draft.answerKey).filter((k) => ids.has(k));
    else if (draft.type === 'text') answerKey = asArray(draft.answerKey);

    const fd = new FormData();
    fd.set('intent', draft.id ? 'update' : 'create');
    if (draft.id) fd.set('id', draft.id);
    fd.set('type', draft.type);
    fd.set('prompt', draft.prompt.trim());
    fd.set('gradeLevelId', draft.gradeLevelId);
    fd.set('difficulty', draft.difficulty);
    fd.set('explanation', draft.explanation.trim());
    fd.set('tags', JSON.stringify(draft.tags));
    // ALWAYS sent, including on update: parsePatch drops absent keys, so omitting these would
    // leave the previous options/answer key in place after a type switch.
    fd.set('options', JSON.stringify(options));
    fd.set('answerKey', JSON.stringify(answerKey));
    fetcher.submit(fd, { action: '/questions', method: 'post' });
    onClose();
  };

  const gradeOptions = [
    { value: '', label: t('qb_grade_none') },
    ...gradeLevels
      .filter((g) => g.active || g.id === draft.gradeLevelId)
      .map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? t('qb_edit') : t('qb_add')}
      width={600}
      footer={
        <>
          <MBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </MBtn>
          <MBtn variant="primary" onClick={save}>
            {t('save')}
          </MBtn>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('qb_prompt_label')}</label>
        <textarea
          className="mochi-input"
          rows={3}
          autoFocus
          style={{ resize: 'vertical', minHeight: 84, paddingTop: 10 }}
          placeholder={t('qb_prompt_ph')}
          value={draft.prompt}
          onChange={(e) => set('prompt', e.target.value)}
        />
      </div>

      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('qb_type_label')}
          value={draft.type}
          onChange={(v) => setType(v as QDraftType)}
          options={[
            { value: 'mcq', label: t('qb_type_mcq') },
            { value: 'multi', label: t('qb_type_multi') },
            { value: 'text', label: t('qb_type_text') },
            { value: 'essay', label: t('qb_type_essay') },
          ]}
        />
        <MSelect
          label={t('qb_diff_label')}
          value={draft.difficulty}
          onChange={(v) => set('difficulty', v as QuestionDraft['difficulty'])}
          options={[
            { value: '', label: t('qb_diff_none') },
            { value: 'easy', label: t('qb_diff_easy') },
            { value: 'medium', label: t('qb_diff_medium') },
            { value: 'hard', label: t('qb_diff_hard') },
          ]}
        />
      </div>

      <MSelect
        label={t('qb_grade_label')}
        value={draft.gradeLevelId}
        onChange={(v) => set('gradeLevelId', v)}
        options={gradeOptions}
      />

      <hr className="divider" />

      {(draft.type === 'mcq' || draft.type === 'multi') && (
        <div className="m-stack" style={{ gap: 8 }}>
          <div className="m-spread">
            <label className="mochi-field__label">{t('qb_options_label')}</label>
            <span className="m-muted" style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
              {t('qb_correct_label')}
            </span>
          </div>
          {draft.options.map((o, i) => (
            <div key={o.id} className="m-row" style={{ gap: 8 }}>
              {draft.type === 'mcq' ? (
                <input
                  type="radio"
                  name="qb-correct"
                  aria-label={t('qb_correct_label')}
                  checked={isCorrect(o.id)}
                  onChange={() => toggleCorrect(o.id)}
                  style={{ accentColor: 'var(--brand)', width: 18, height: 18, flexShrink: 0 }}
                />
              ) : (
                <MCheck checked={isCorrect(o.id)} onChange={() => toggleCorrect(o.id)} />
              )}
              <input
                className="mochi-input"
                style={{ flex: 1 }}
                placeholder={t('qb_option_ph', { n: i + 1 })}
                value={o.text}
                onChange={(e) => setOptionText(o.id, e.target.value)}
              />
              <MIB label={t('remove')} size="sm" onClick={() => removeOption(o.id)}>
                <MIcon name="x" size={14} />
              </MIB>
            </div>
          ))}
          <div className="m-row" style={{ gap: 8 }}>
            <MBtn
              variant="secondary"
              size="sm"
              iconLeft={<MIcon name="plus" size={14} />}
              onClick={addOption}
              disabled={draft.options.length >= MAX_OPTIONS}
            >
              {t('qb_add_option')}
            </MBtn>
            <MBtn variant="ghost" size="sm" onClick={trueFalsePreset}>
              {t('qb_tf_preset')}
            </MBtn>
          </div>
        </div>
      )}

      {draft.type === 'text' && (
        <ChipInput
          label={t('qb_accepted_answers')}
          placeholder={t('qb_accepted_ph')}
          hint={t('qb_accepted_hint')}
          values={asArray(draft.answerKey)}
          onChange={(next) => {
            setError(null);
            set('answerKey', next);
          }}
        />
      )}

      {draft.type === 'essay' && (
        <div className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
          {t('qb_essay_hint')}
        </div>
      )}

      <hr className="divider" />

      <ChipInput
        label={t('qb_tags_label')}
        placeholder={t('qb_tags_ph')}
        values={draft.tags}
        onChange={(next) => set('tags', next)}
      />

      <div className="mochi-field">
        <label className="mochi-field__label">{t('qb_explanation_label')}</label>
        <textarea
          className="mochi-input"
          rows={2}
          style={{ resize: 'vertical', minHeight: 64, paddingTop: 10 }}
          placeholder={t('qb_explanation_ph')}
          value={draft.explanation}
          onChange={(e) => set('explanation', e.target.value)}
        />
      </div>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
