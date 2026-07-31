import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { MSelect, Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { normalizeText } from '../../shared/logic/tests.js';
import type { TestQuestionRow, TestAttemptRow } from '../../server/services/tests.js';
import type { QuestionRow } from '../../server/services/questions.js';
import type { GradeLevelRow } from '../../server/services/grade-levels.js';

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag } = DS;

const TYPE_TK: Record<QuestionRow['type'], string> = {
  mcq: 'qb_type_mcq',
  multi: 'qb_type_multi',
  text: 'qb_type_text',
  essay: 'qb_type_essay',
};

const TYPE_COLOR: Record<QuestionRow['type'], string> = {
  mcq: 'blue',
  multi: 'violet',
  text: 'green',
  essay: 'orange',
};

interface QuestionPickerProps {
  links: TestQuestionRow[];
  questions: QuestionRow[];
  gradeLevels: GradeLevelRow[];
  attempts: TestAttemptRow[];
  action: string;
}

type Picked = { questionId: string; points: number };

export function QuestionPicker({
  links,
  questions,
  gradeLevels,
  attempts,
  action,
}: QuestionPickerProps) {
  const { t } = useLang();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const locked = attempts.length > 0;

  // Local draft of the picked list; loader data is never mutated. Reseeded only when the
  // set of saved links actually changes, so an in-flight edit is not thrown away.
  const seed = React.useMemo(
    () => links.map((l) => ({ questionId: l.questionId, points: l.points })),
    [links],
  );
  const [picked, setPicked] = React.useState<Picked[]>(seed);
  const seedKey = seed.map((p) => `${p.questionId}:${p.points}`).join('|');
  React.useEffect(() => {
    setPicked(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const [q, setQ] = React.useState('');
  const [fGrade, setFGrade] = React.useState('');
  const [fType, setFType] = React.useState('');
  const [fDiff, setFDiff] = React.useState('');
  const [fTags, setFTags] = React.useState<string[]>([]);

  const byId = React.useMemo(() => new Map(questions.map((item) => [item.id, item])), [questions]);
  const pickedIds = new Set(picked.map((p) => p.questionId));

  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of questions) for (const tag of item.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const bank = React.useMemo(() => {
    const needle = normalizeText(q);
    return questions.filter((item) => {
      if (pickedIds.has(item.id)) return false;
      if (needle && !normalizeText(item.prompt).includes(needle)) return false;
      if (fGrade && item.gradeLevelId !== fGrade) return false;
      if (fType && item.type !== fType) return false;
      if (fDiff && item.difficulty !== fDiff) return false;
      if (fTags.length && !fTags.every((tag) => item.tags.includes(tag))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, q, fGrade, fType, fDiff, fTags, picked]);

  const toggleTag = (tag: string) =>
    setFTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const add = (id: string) => setPicked((p) => [...p, { questionId: id, points: 1 }]);
  const remove = (id: string) => setPicked((p) => p.filter((x) => x.questionId !== id));
  const setPoints = (id: string, points: number) =>
    setPicked((p) => p.map((x) => (x.questionId === id ? { ...x, points } : x)));
  const move = (i: number, delta: number) =>
    setPicked((p) => {
      const j = i + delta;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      const [row] = next.splice(i, 1);
      next.splice(j, 0, row);
      return next;
    });

  const totalPoints = picked.reduce(
    (sum, p) => sum + (Number.isFinite(p.points) ? p.points : 0),
    0,
  );

  const save = () => {
    const fd = new FormData();
    fd.set('intent', 'save-questions');
    // Array order IS the question order — the service writes sortOrder = index.
    fd.set('items', JSON.stringify(picked));
    fetcher.submit(fd, { action, method: 'post' });
  };

  return (
    <div className="m-stack" style={{ gap: 16 }}>
      {locked && (
        <MC style={{ padding: 14 }}>
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
            {t('tests_locked_attempts')}
          </span>
        </MC>
      )}

      <div className="m-grid cols-2" style={{ gap: 16, alignItems: 'start' }}>
        <MC style={{ padding: 14 }}>
          <div className="mochi-eyebrow" style={{ marginBottom: 10 }}>
            {t('tests_pick_bank')}
          </div>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('search')}</label>
            <input
              className="mochi-input"
              placeholder={t('qb_search_ph')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="m-grid cols-3" style={{ gap: 10 }}>
            <MSelect
              label={t('qb_grade_label')}
              value={fGrade}
              onChange={setFGrade}
              options={[
                { value: '', label: t('qb_grade_all') },
                ...gradeLevels
                  .filter((g) => g.active || g.id === fGrade)
                  .map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
            <MSelect
              label={t('qb_type_label')}
              value={fType}
              onChange={setFType}
              options={[
                { value: '', label: t('qb_type_all') },
                { value: 'mcq', label: t('qb_type_mcq') },
                { value: 'multi', label: t('qb_type_multi') },
                { value: 'text', label: t('qb_type_text') },
                { value: 'essay', label: t('qb_type_essay') },
              ]}
            />
            <MSelect
              label={t('qb_diff_label')}
              value={fDiff}
              onChange={setFDiff}
              options={[
                { value: '', label: t('qb_diff_all') },
                { value: 'easy', label: t('qb_diff_easy') },
                { value: 'medium', label: t('qb_diff_medium') },
                { value: 'hard', label: t('qb_diff_hard') },
              ]}
            />
          </div>
          {allTags.length > 0 && (
            <div className="m-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {allTags.map((tag) => {
                const on = fTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className="mchip"
                    onClick={() => toggleTag(tag)}
                    style={{
                      border: '1.5px solid',
                      borderColor: on ? 'var(--brand)' : 'transparent',
                      background: on ? 'var(--brand-soft)' : undefined,
                      color: on ? 'var(--brand-soft-ink)' : undefined,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}

          <div className="m-stack" style={{ gap: 6, marginTop: 12 }}>
            {bank.length === 0 ? (
              <Empty icon="help" title={t('qb_empty')} />
            ) : (
              bank.map((item) => (
                <div key={item.id} className="lrow" style={{ gap: 10 }}>
                  <MTag color={TYPE_COLOR[item.type]}>{t(TYPE_TK[item.type])}</MTag>
                  <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
                    {item.prompt}
                  </span>
                  <MBtn
                    variant="secondary"
                    size="sm"
                    disabled={locked}
                    onClick={() => add(item.id)}
                  >
                    {t('tests_pick_add')}
                  </MBtn>
                </div>
              ))
            )}
          </div>
        </MC>

        <MC style={{ padding: 14 }}>
          <div className="mochi-eyebrow" style={{ marginBottom: 10 }}>
            {t('tests_pick_picked')}
          </div>
          {picked.length === 0 ? (
            <Empty icon="clipboard" title={t('tests_q_count', { n: 0 })} />
          ) : (
            <div className="m-stack" style={{ gap: 6 }}>
              {picked.map((p, i) => {
                const item = byId.get(p.questionId);
                return (
                  <div key={p.questionId} className="lrow" style={{ gap: 8 }}>
                    <span
                      className="m-muted"
                      style={{ fontWeight: 800, fontSize: 'var(--text-sm)', width: 20 }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
                      {item?.prompt ?? p.questionId}
                    </span>
                    {item && <MTag color={TYPE_COLOR[item.type]}>{t(TYPE_TK[item.type])}</MTag>}
                    <input
                      className="mochi-input"
                      type="number"
                      step="0.5"
                      min="0"
                      style={{ width: 80 }}
                      disabled={locked}
                      value={String(p.points)}
                      onChange={(e) => setPoints(p.questionId, Number(e.target.value))}
                      aria-label={t('tests_points_label')}
                    />
                    <MIB
                      label={t('tests_move_up')}
                      size="sm"
                      disabled={locked || i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <MIcon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} />
                    </MIB>
                    <MIB
                      label={t('tests_move_down')}
                      size="sm"
                      disabled={locked || i === picked.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <MIcon name="chevronDown" size={14} />
                    </MIB>
                    <MIB
                      label={t('delete')}
                      size="sm"
                      disabled={locked}
                      onClick={() => remove(p.questionId)}
                    >
                      <MIcon name="x" size={14} />
                    </MIB>
                  </div>
                );
              })}
            </div>
          )}

          <hr className="divider" />
          <div className="m-spread" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
              {t('tests_q_count', { n: picked.length })} ·{' '}
              {t('tests_total_points', { n: totalPoints })}
            </span>
            <MBtn variant="primary" disabled={locked} onClick={save}>
              {t('tests_pick_save')}
            </MBtn>
          </div>
        </MC>
      </div>
    </div>
  );
}
