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

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Badge: MBadge, Checkbox: MCheck } = DS;

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

/** What every bulk intent can put in `fetcher.data`, on top of the shared ok/error shape. */
type BankFetcherData = {
  ok?: boolean;
  error?: string;
  /** bulk-delete and wipe */
  deleted?: number;
  /** bulk-delete only — questions a test still holds, left in place */
  skippedInUse?: number;
  /** wipe only — how many test links were removed, and what tells the two deletes apart */
  detachedFromTests?: number;
  /** bulk-meta and bulk-tags */
  updated?: number;
};

export function QuestionBankScreen() {
  const { questions, gradeLevels, usage } = useLoaderData() as QuestionsLoaderData;
  const fetcher = useFetcher<BankFetcherData>();
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

  /**
   * What the last bulk action did. A bulk delete that quietly kept three questions, or a tag add that
   * changed nothing because every row already had it, is indistinguishable from a no-op without this.
   */
  const resultMsg = React.useMemo(() => {
    const data = fetcher.data;
    if (!data?.ok) return null;
    if (typeof data.deleted === 'number') {
      if (!data.skippedInUse) {
        // The wipe reports `detachedFromTests` rather than `skippedInUse`, and empties everything.
        return 'detachedFromTests' in data
          ? t('qb_wipe_done', { n: data.deleted })
          : t('qb_bulk_deleted_all', { n: data.deleted });
      }
      return t('qb_bulk_deleted', { n: data.deleted, skipped: data.skippedInUse });
    }
    if (typeof data.updated === 'number') return t('qb_bulk_updated', { n: data.updated });
    return null;
  }, [fetcher.data, t]);

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

  /**
   * Ids of the ticked questions, not a flag on each row — the rows come from the loader and are
   * replaced wholesale on every revalidation, so a `checked` field on them (the pattern the import
   * review screen uses on its own draft rows) would be wiped out by each mutation.
   */
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = React.useState('');

  // Drop ids that no longer exist. Anything else leaves a bulk bar counting rows that were just
  // deleted, and a follow-up action submitting ids the server would only skip.
  React.useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const live = new Set(questions.map((item) => item.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [questions]);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const busy = fetcher.state !== 'idle';
  const selectedIds = [...selected];
  /** How many of the selection a test still holds — the bank already loads `usage` for the row chips. */
  const selectedInUse = selectedIds.filter((id) => (usage[id] ?? 0) > 0).length;

  const submitBulk = (intent: string, payload: Record<string, unknown>) => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('payload', JSON.stringify(payload));
    fetcher.submit(fd, { action: '/questions', method: 'post' });
  };

  /**
   * `MSelect` takes no `disabled`, and these fire on change rather than on a button, so the in-flight
   * guard lives here: two overlapping bulk writes to the same rows would race, and the second would
   * land on a stale selection.
   */
  const bulkMeta = (patch: { gradeLevelId?: string | null; difficulty?: string | null }) => {
    if (busy || !selectedIds.length) return;
    submitBulk('bulk-meta', { ids: selectedIds, ...patch });
  };

  const addBulkTag = () => {
    const tag = bulkTag.trim();
    if (!tag) return;
    setBulkTag('');
    submitBulk('bulk-tags', { ids: selectedIds, tags: [tag] });
  };

  const bulkDelete = async () => {
    if (
      await confirm({
        title: t('qb_bulk_delete_confirm', { n: selected.size }),
        message: selectedInUse
          ? t('qb_bulk_delete_msg', { used: selectedInUse })
          : t('qb_bulk_delete_msg_free'),
        confirmLabel: t('delete'),
        danger: true,
      })
    ) {
      submitBulk('bulk-delete', { ids: selectedIds });
      setSelected(new Set());
    }
  };

  /**
   * Empty the bank. The confirmation has to carry the part nobody would guess: `test_answers`
   * cascades off `questions`, so this deletes what students answered, not just the bank.
   */
  const wipe = async () => {
    const usedCount = questions.filter((item) => (usage[item.id] ?? 0) > 0).length;
    if (
      await confirm({
        title: t('qb_wipe_confirm', { n: questions.length }),
        message: usedCount ? t('qb_wipe_msg', { used: usedCount }) : t('qb_wipe_msg_free'),
        confirmLabel: t('qb_wipe'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('intent', 'wipe');
      fetcher.submit(fd, { action: '/questions', method: 'post' });
      setSelected(new Set());
    }
  };

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
            {/* Hidden on an empty bank: there is nothing to wipe, and a red button with no effect
                is just an invitation to find out what it does. */}
            {questions.length > 0 && (
              <MBtn
                variant="danger"
                iconLeft={<MIcon name="trash" size={18} />}
                disabled={busy}
                onClick={() => void wipe()}
              >
                {t('qb_wipe')}
              </MBtn>
            )}
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

      {resultMsg && (
        <div
          className="m-muted"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 12 }}
        >
          {resultMsg}
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

      {filtered.length > 0 && (
        <MC style={{ padding: 12, marginBottom: 12 }}>
          <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* "All" takes the FILTERED ids, so selection composes with the search and filters
                above rather than quietly reaching questions the teacher cannot see. */}
            <MBtn
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set(filtered.map((item) => item.id)))}
            >
              {t('qb_select_all', { n: filtered.length })}
            </MBtn>
            {selected.size > 0 && (
              <MBtn variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                {t('qb_select_none')}
              </MBtn>
            )}
            {selected.size > 0 && (
              <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
                {t('qb_selected_n', { n: selected.size })}
              </span>
            )}
          </div>

          {selected.size > 0 && (
            <div
              className="m-row"
              style={{
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{ minWidth: 170 }}>
                <MSelect
                  label={t('qb_bulk_grade')}
                  value=""
                  onChange={(v) => bulkMeta({ gradeLevelId: v === '__clear__' ? null : v })}
                  options={[
                    { value: '', label: '—' },
                    { value: '__clear__', label: t('qb_bulk_clear') },
                    ...gradeLevels
                      .filter((g) => g.active)
                      .map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
              </div>
              <div style={{ minWidth: 150 }}>
                <MSelect
                  label={t('qb_bulk_diff')}
                  value=""
                  onChange={(v) => bulkMeta({ difficulty: v === '__clear__' ? null : v })}
                  options={[
                    { value: '', label: '—' },
                    { value: '__clear__', label: t('qb_bulk_clear') },
                    { value: 'easy', label: t('qb_diff_easy') },
                    { value: 'medium', label: t('qb_diff_medium') },
                    { value: 'hard', label: t('qb_diff_hard') },
                  ]}
                />
              </div>
              <div className="mochi-field" style={{ minWidth: 170 }}>
                <label className="mochi-field__label">{t('qb_bulk_add_tag')}</label>
                <input
                  className="mochi-input"
                  placeholder={t('qb_bulk_add_tag_ph')}
                  value={bulkTag}
                  disabled={busy}
                  onChange={(e) => setBulkTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addBulkTag();
                    }
                  }}
                />
              </div>
              <MBtn variant="secondary" disabled={busy || !bulkTag.trim()} onClick={addBulkTag}>
                {t('qb_bulk_add_tag')}
              </MBtn>
              <MBtn
                variant="danger"
                iconLeft={<MIcon name="trash" size={16} />}
                disabled={busy}
                onClick={() => void bulkDelete()}
              >
                {t('qb_bulk_delete')}
              </MBtn>
            </div>
          )}
        </MC>
      )}

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
                  <div style={{ paddingTop: 2, flexShrink: 0 }}>
                    <MCheck
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                  </div>
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
