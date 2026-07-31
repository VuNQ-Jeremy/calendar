import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { MSelect, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { normalizeText } from '../../shared/logic/tests.js';
import {
  QuestionEditorModal,
  newQuestionDraft,
  draftFromQuestion,
  type QuestionDraft,
} from './question-editor.jsx';
import { QuestionImportModal } from './question-import.jsx';
import type { QuestionRow } from '../../server/services/questions.js';
import type { GradeLevelRow } from '../../server/services/grade-levels.js';

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Badge: MBadge } = DS;

interface QuestionsLoaderData {
  questions: QuestionRow[];
  gradeLevels: GradeLevelRow[];
  usage: Record<string, number>;
}

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

const DIFF_TK: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'qb_diff_easy',
  medium: 'qb_diff_medium',
  hard: 'qb_diff_hard',
};

const DIFF_COLOR: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'green',
  medium: 'orange',
  hard: 'rose',
};

export function QuestionBankScreen() {
  const { questions, gradeLevels, usage } = useLoaderData() as QuestionsLoaderData;
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const { t } = useLang();
  const [draft, setDraft] = React.useState<QuestionDraft | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [confirm, confirmNode] = useConfirm();

  const [q, setQ] = React.useState('');
  const [fGrade, setFGrade] = React.useState('');
  const [fType, setFType] = React.useState('');
  const [fDiff, setFDiff] = React.useState('');
  const [fTags, setFTags] = React.useState<string[]>([]);

  const serverError = fetcher.data && 'error' in fetcher.data ? fetcher.data.error : undefined;
  const errorMsg =
    serverError === 'question_locked'
      ? t('qb_locked_msg')
      : serverError === 'question_in_use'
        ? t('qb_in_use_tip')
        : null;

  const gradeName = (id: string | null) =>
    id ? (gradeLevels.find((g) => g.id === id)?.name ?? '') : '';

  const allTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of questions) for (const tag of item.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const filtered = React.useMemo(() => {
    const needle = normalizeText(q);
    return questions.filter((item) => {
      if (needle && !normalizeText(item.prompt).includes(needle)) return false;
      if (fGrade && item.gradeLevelId !== fGrade) return false;
      if (fType && item.type !== fType) return false;
      if (fDiff && item.difficulty !== fDiff) return false;
      if (fTags.length && !fTags.every((tag) => item.tags.includes(tag))) return false;
      return true;
    });
  }, [questions, q, fGrade, fType, fDiff, fTags]);

  const toggleTag = (tag: string) =>
    setFTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const del = async (item: QuestionRow) => {
    if (
      await confirm({
        title: t('qb_delete_confirm'),
        message: item.prompt,
        confirmLabel: t('delete'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('intent', 'delete');
      fd.set('id', item.id);
      fetcher.submit(fd, { action: '/questions', method: 'post' });
    }
  };

  return (
    <div className="content">
      <PageHeader
        title={t('qb_title')}
        subtitle={t('qb_subtitle')}
        actions={
          <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <MBtn
              variant="secondary"
              iconLeft={<MIcon name="upload" size={18} />}
              onClick={() => setImporting(true)}
            >
              {t('qi_open')}
            </MBtn>
            <MBtn
              variant="primary"
              iconLeft={<MIcon name="plus" size={18} />}
              onClick={() => setDraft(newQuestionDraft())}
            >
              {t('qb_add')}
            </MBtn>
          </div>
        }
      />

      {errorMsg && (
        <div
          className="m-muted"
          style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 12 }}
        >
          {errorMsg}
        </div>
      )}

      <MC style={{ padding: 14, marginBottom: 16 }}>
        <div className="m-grid cols-4" style={{ gap: 12 }}>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('search')}</label>
            <input
              className="mochi-input"
              placeholder={t('qb_search_ph')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
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
          <div className="m-row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
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
      </MC>

      {filtered.length === 0 ? (
        <Empty icon="help" title={t('qb_empty')} />
      ) : (
        <div className="m-stack" style={{ gap: 8 }}>
          {filtered.map((item) => {
            const used = usage[item.id] ?? 0;
            const gname = gradeName(item.gradeLevelId);
            return (
              <MC key={item.id} style={{ padding: 14 }}>
                <div className="m-spread" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="m-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <MTag color={TYPE_COLOR[item.type]}>{t(TYPE_TK[item.type])}</MTag>
                      {item.difficulty && (
                        <MBadge color={DIFF_COLOR[item.difficulty]}>
                          {t(DIFF_TK[item.difficulty])}
                        </MBadge>
                      )}
                      {gname && <span className="mchip">{gname}</span>}
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: 'var(--text-strong)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {item.prompt}
                    </div>
                    <div
                      className="m-row"
                      style={{ gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}
                    >
                      {item.tags.map((tag) => (
                        <span key={tag} className="mchip">
                          {tag}
                        </span>
                      ))}
                      <span
                        className="m-muted"
                        style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}
                      >
                        {t('qb_used_in', { n: used })}
                      </span>
                    </div>
                  </div>
                  <div className="lrow__actions" style={{ flexShrink: 0 }}>
                    <MIB
                      label={t('edit')}
                      size="sm"
                      onClick={() => setDraft(draftFromQuestion(item))}
                    >
                      <MIcon name="edit" size={16} />
                    </MIB>
                    <MIB
                      label={t('delete')}
                      size="sm"
                      disabled={used > 0}
                      title={used > 0 ? t('qb_in_use_tip') : t('delete')}
                      onClick={() => del(item)}
                    >
                      <MIcon name="trash" size={16} />
                    </MIB>
                  </div>
                </div>
              </MC>
            );
          })}
        </div>
      )}

      {draft && (
        <QuestionEditorModal
          draft={draft}
          setDraft={setDraft}
          gradeLevels={gradeLevels}
          fetcher={fetcher}
          onClose={() => setDraft(null)}
        />
      )}
      {importing && (
        <QuestionImportModal
          mode="bank"
          action="/questions"
          gradeLevels={gradeLevels}
          onClose={() => setImporting(false)}
        />
      )}
      {confirmNode}
    </div>
  );
}
