import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import {
  ACCEPT,
  KEY_ACCEPT,
  readQuestionRows,
  extractKeyText,
  ExtractInputError,
} from './import-extract.js';
import { QuestionEditorModal, validateDraft, type QuestionDraft } from './question-editor.jsx';
import type { ImportedQuestionDraft } from '../../shared/logic/question-import.js';
import {
  parseQuestionRows,
  TEMPLATE_CSV,
  type ParsedCsv,
} from '../../shared/logic/question-csv.js';
import { parseAnswerKey, applyAnswerKey, stripHtml } from '../../shared/logic/answer-key.js';
import { MAX_IMPORT_QUESTIONS } from '../../shared/schemas.js';
import type { GradeLevelRow } from '../../server/services/grade-levels.js';

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Badge: MBadge, Checkbox: MCheck } = DS;

const TYPE_TK: Record<QuestionDraft['type'], string> = {
  mcq: 'qb_type_mcq',
  multi: 'qb_type_multi',
  text: 'qb_type_text',
  essay: 'qb_type_essay',
};

const TYPE_COLOR: Record<QuestionDraft['type'], string> = {
  mcq: 'blue',
  multi: 'violet',
  text: 'green',
  essay: 'orange',
};

/** How many question numbers a one-line notice will spell out before it starts counting instead. */
const NUMBER_LIST_MAX = 12;

/** A draft plus the review screen's own per-row state. */
type Row = {
  key: string;
  draft: QuestionDraft;
  /** i18n keys from the sanitizer — why this row needs a look before it can be saved. */
  issues: string[];
  checked: boolean;
  /** The number printed in the document, for answer-key matching. Never saved. */
  sourceNumber: number | null;
  /** Original printed option position -> id. See `letterIds` in shared/logic/question-import. */
  letterIds: (string | null)[];
};

const toDraft = (d: ImportedQuestionDraft): QuestionDraft => ({
  type: d.type,
  prompt: d.prompt,
  context: d.context ?? '',
  gradeLevelId: '',
  difficulty: d.difficulty ?? '',
  tags: [...d.tags],
  options: d.options.map((o) => ({ ...o })),
  answerKey: Array.isArray(d.answerKey) ? [...d.answerKey] : d.answerKey,
  explanation: d.explanation ?? '',
});

/**
 * What the import intents expect per question.
 *
 * Normalizes exactly the way `QuestionEditorModal.save()` does, and clamps to the same limits the
 * server enforces. `validateDraft` deliberately tolerates blank options and has no length rules,
 * so without this a row edited in the modal could look ready, pass the client check, and then 400
 * the WHOLE batch on `QuestionOption.text.min(1)` — losing every other question with it.
 */
export const toPayload = (draft: QuestionDraft) => {
  const options =
    draft.type === 'mcq' || draft.type === 'multi'
      ? draft.options
          .filter((o) => o.text.trim() !== '')
          .map((o) => ({ id: o.id, text: o.text.trim().slice(0, 500) }))
      : [];
  const ids = new Set(options.map((o) => o.id));
  let answerKey: string | string[] | null = null;
  if (draft.type === 'mcq') answerKey = draft.answerKey as string;
  else if (draft.type === 'multi') {
    answerKey = (Array.isArray(draft.answerKey) ? draft.answerKey : []).filter((k) => ids.has(k));
  } else if (draft.type === 'text') {
    answerKey = (Array.isArray(draft.answerKey) ? draft.answerKey : [])
      .map((a) => a.trim())
      .filter((a) => a !== '');
  }
  return {
    type: draft.type,
    prompt: draft.prompt.trim().slice(0, 4000),
    context: draft.context.trim().slice(0, 8000) || null,
    gradeLevelId: draft.gradeLevelId || null,
    difficulty: draft.difficulty || null,
    tags: [...new Set(draft.tags.map((tag) => tag.trim().slice(0, 50)).filter(Boolean))].slice(
      0,
      20,
    ),
    options,
    answerKey,
    explanation: draft.explanation.trim().slice(0, 2000) || null,
  };
};

interface QuestionImportModalProps {
  /** 'bank' saves to the question bank only; 'test' also attaches to the test at `action`. */
  mode: 'bank' | 'test';
  /** '/questions' or `/tests/:id`. */
  action: string;
  gradeLevels: GradeLevelRow[];
  /** Pre-selects a grade level for every imported row (the test's own, on a test page). */
  defaultGradeLevelId?: string | null;
  /** Questions already on the test, for the 100-per-test cap. Only meaningful in 'test' mode. */
  existingCount?: number;
  onClose: () => void;
}

type Phase = 'pick' | 'review';

export function QuestionImportModal({
  mode,
  action,
  gradeLevels,
  defaultGradeLevelId,
  existingCount = 0,
  onClose,
}: QuestionImportModalProps) {
  const { t } = useLang();
  const fetcher = useFetcher<{
    ok?: boolean;
    error?: string;
    created?: number;
    createdInBank?: number;
  }>();

  const [phase, setPhase] = React.useState<Phase>('pick');
  const [fileName, setFileName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  /**
   * True while the file is being read. The parse itself is instant, but `readQuestionRows` has to
   * fetch the SheetJS chunk first, which on a school connection is a visible wait.
   */
  const [busy, setBusy] = React.useState(false);
  /** Spreadsheet rows that held something but no question text, by 1-based row number. */
  const [skipped, setSkipped] = React.useState<number[]>([]);
  /** The file held more questions than one import can carry, and the rest were left behind. */
  const [truncated, setTruncated] = React.useState(false);
  const [bulkGrade, setBulkGrade] = React.useState(defaultGradeLevelId ?? '');
  const [points, setPoints] = React.useState(1);
  /**
   * The row open in the full editor. The editor edits `rows` live (its `setDraft` writes straight
   * through), so the pre-edit draft is snapshotted here and restored if the teacher cancels —
   * otherwise "Cancel" would silently keep every keystroke.
   */
  const [editing, setEditing] = React.useState<{ index: number; snapshot: QuestionDraft } | null>(
    null,
  );
  /** The separate answer key: pasted, or read out of a picked file. */
  const [keyText, setKeyText] = React.useState('');
  const [keyOpen, setKeyOpen] = React.useState(false);
  const [keyError, setKeyError] = React.useState<string | null>(null);
  const [keyResult, setKeyResult] = React.useState<{
    matched: number;
    unmatched: number[];
    unresolved: number[];
    ambiguous: number[];
  } | null>(null);

  const saving = fetcher.state !== 'idle';
  const saved = fetcher.data?.ok === true;
  /**
   * On a test-page import the questions are created BEFORE they are attached, so an attach failure
   * leaves them in the bank. Re-submitting would create a second copy of every one, so once the
   * server reports that, the import is over.
   */
  const partiallyDone = fetcher.data?.createdInBank != null;

  // Close once the import lands. Doing it here rather than in the click handler means the modal
  // stays open (and the button stays busy) until the server has actually accepted the rows.
  React.useEffect(() => {
    if (saved) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const serverError = fetcher.data?.error;
  const serverErrorMsg = serverError
    ? serverError === 'test_has_attempts'
      ? t('qi_err_attach_locked', { n: fetcher.data?.createdInBank ?? 0 })
      : serverError === 'too_many_questions'
        ? t('qi_err_too_many_on_test')
        : t('qi_err_save_failed')
    : null;

  /**
   * The template, as a link the browser can save.
   *
   * The byte-order mark is not decoration: Excel decides a .csv's encoding from its first bytes, and
   * without the mark it falls back to the system codepage, so the Vietnamese in the example rows
   * opens as mojibake and the teacher's reasonable conclusion is that the template is broken. The
   * parser tolerates the mark on the way back in.
   *
   * Minted in an effect rather than inline so that it is created once per open, revoked when the
   * modal closes, and never touched while rendering — `URL.createObjectURL` does not exist during
   * SSR, and a URL revoked straight after a click is a race some browsers lose by downloading an
   * empty file.
   */
  const [templateUrl, setTemplateUrl] = React.useState('');
  React.useEffect(() => {
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }),
    );
    setTemplateUrl(url);
    return () => URL.revokeObjectURL(url);
  }, []);

  /**
   * Read the picked sheet and go straight to review. No round trip, nothing guessed: what the review
   * screen shows is what the file said, so a mistake the teacher spots there is a mistake they can
   * fix in the file itself and re-upload.
   */
  const pick = async (file: File) => {
    setError(null);
    setFileName(file.name);
    setBusy(true);
    let parsed: ParsedCsv;
    try {
      parsed = parseQuestionRows(await readQuestionRows(file));
    } catch (e) {
      // Both the reader and the parser throw an i18n key as the message — a bad header, an
      // unreadable file type, a file over the size cap — and anything else is a real fault.
      setError(t(e instanceof ExtractInputError ? e.message : 'qi_err_read_failed'));
      setBusy(false);
      return;
    }
    setBusy(false);

    if (!parsed.drafts.length) {
      setError(t('qi_err_none_found'));
      return;
    }
    setRows(
      parsed.drafts.map((q, i) => ({
        key: `${i}`,
        draft: { ...toDraft(q), gradeLevelId: defaultGradeLevelId ?? '' },
        issues: q.issues,
        // A row the file did not fully answer starts unchecked: importing a question with no answer
        // key would silently create something no student can be graded against.
        checked: q.issues.length === 0,
        sourceNumber: q.sourceNumber,
        letterIds: q.letterIds,
      })),
    );
    setSkipped(parsed.skipped);
    setTruncated(parsed.truncated);
    setKeyResult(null);
    setPhase('review');
  };

  const patchRow = (index: number, next: Partial<Row>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...next } : row)));

  /** Save from the editor: keep the draft and re-derive its state, so a fixed row clears its badge. */
  const applyEdit = (index: number, draft: QuestionDraft) => {
    const problem = validateDraft(draft);
    patchRow(index, { draft, issues: problem ? [problem] : [], checked: problem == null });
    setEditing(null);
  };

  /** Cancel from the editor: put the pre-edit draft back, since the editor wrote through live. */
  const cancelEdit = () => {
    if (editing) patchRow(editing.index, { draft: editing.snapshot });
    setEditing(null);
  };

  const applyBulkGrade = (value: string) => {
    setBulkGrade(value);
    setRows((prev) =>
      prev.map((row) => ({ ...row, draft: { ...row.draft, gradeLevelId: value } })),
    );
  };

  /** A key file is read in the browser and shown in the box, so the teacher can fix it before use. */
  const pickKeyFile = async (file: File) => {
    setKeyError(null);
    try {
      setKeyText(
        stripHtml(await extractKeyText(file))
          .replace(/[ \t]+\n/g, '\n')
          .trim(),
      );
    } catch (e) {
      setKeyError(t(e instanceof ExtractInputError ? e.message : 'qi_err_read_failed'));
    }
  };

  /**
   * Match the key onto the rows by the question number printed in the document.
   *
   * The key wins over whatever the sheet's own answer column said: a teacher who pastes one is
   * stating what the answers are. Rows it fixes are re-validated and re-checked, so a paper that
   * arrived with forty "no answer marked" rows becomes importable in one click.
   */
  const applyKey = () => {
    setKeyError(null);
    const entries = parseAnswerKey(keyText);
    if (!entries.length) {
      setKeyResult(null);
      setKeyError(t('qi_key_err_none'));
      return;
    }
    const { applied, unmatchedNumbers, unresolvedNumbers, ambiguousNumbers } = applyAnswerKey(
      rows.map((row) => ({
        type: row.draft.type,
        letterIds: row.letterIds,
        sourceNumber: row.sourceNumber,
      })),
      entries,
    );
    const byIndex = new Map(applied.map((a) => [a.index, a]));
    setRows((prev) =>
      prev.map((row, i) => {
        const hit = byIndex.get(i);
        if (!hit) return row;
        const draft = { ...row.draft, type: hit.type, answerKey: hit.answerKey };
        const problem = validateDraft(draft);
        // Both answer flags are exactly what the key answers, and it only ever applies when every
        // letter it named resolved — so a row it touched has a whole answer, not a partial one.
        // Anything else the sanitizer reported (options capped, type downgraded) still wants a look.
        const issues = row.issues.filter(
          (issue) => issue !== 'qi_issue_no_answer' && issue !== 'qi_issue_partial_answer',
        );
        if (problem && !issues.includes(problem)) issues.push(problem);
        return { ...row, draft, issues, checked: problem == null };
      }),
    );
    setKeyResult({
      matched: applied.length,
      unmatched: unmatchedNumbers,
      unresolved: unresolvedNumbers,
      ambiguous: ambiguousNumbers,
    });
  };

  /**
   * Numbers the file uses that no row carries — a question went missing between the paper and the
   * sheet. Only meaningful once most rows are numbered, and only within the range the file covers.
   */
  const missingNumbers = React.useMemo(() => {
    const numbers = rows.map((row) => row.sourceNumber).filter((n): n is number => n != null);
    if (numbers.length < 2) return [];
    const present = new Set(numbers);
    const out: number[] = [];
    for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++) {
      if (!present.has(n)) out.push(n);
    }
    // A paper numbered in sections that restart would light this up for every gap; past a handful
    // the warning is noise rather than a lost question.
    return out.length > 10 ? [] : out;
  }, [rows]);

  /**
   * Spell out a list of question numbers, then start counting.
   *
   * These land in one-line notices, and a legitimately partial key produces a long list: importing
   * part 2 of a split paper and pasting the whole key is the intended workflow, and "no question
   * numbered 1, 2, 3, … 50" in danger red reads as "your answer key is wrong" when nothing is.
   */
  const joinNumbers = (numbers: number[]): string =>
    numbers.length <= NUMBER_LIST_MAX
      ? numbers.join(', ')
      : `${numbers.slice(0, NUMBER_LIST_MAX).join(', ')} ${t('qi_and_more', {
          n: numbers.length - NUMBER_LIST_MAX,
        })}`;

  const selected = rows.filter((row) => row.checked);
  const blocked = selected.filter((row) => validateDraft(row.draft) != null);
  // On a test the imported questions are appended to whatever is already there, and the test caps
  // at 100 — checked here as well as on the server so the teacher finds out before the questions
  // have been written to the bank.
  const overTestCap = mode === 'test' && existingCount + selected.length > 100;
  const canSave =
    selected.length > 0 && blocked.length === 0 && !overTestCap && !saving && !partiallyDone;

  const submit = () => {
    const fd = new FormData();
    fd.set('intent', mode === 'test' ? 'import-questions' : 'import');
    fd.set('payload', JSON.stringify({ questions: selected.map((row) => toPayload(row.draft)) }));
    if (mode === 'test') fd.set('defaultPoints', String(points));
    fetcher.submit(fd, { action, method: 'post' });
  };

  const gradeOptions = [
    { value: '', label: t('qb_grade_none') },
    ...gradeLevels
      .filter((g) => g.active || g.id === bulkGrade)
      .map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t('qi_title')}
        subtitle={
          phase === 'review' ? t('qi_found', { n: rows.length, file: fileName }) : undefined
        }
        width={820}
        footer={
          phase === 'review' ? (
            <>
              <MBtn variant="secondary" onClick={onClose} disabled={saving}>
                {t('cancel')}
              </MBtn>
              <MBtn variant="primary" onClick={submit} disabled={!canSave}>
                {saving ? t('qi_saving') : t('qi_import_n', { n: selected.length })}
              </MBtn>
            </>
          ) : (
            <MBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </MBtn>
          )
        }
      >
        {phase === 'pick' && (
          <div className="m-stack" style={{ gap: 12 }}>
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
              {t('qi_intro')}
            </span>
            <label
              className="m-stack"
              style={{
                gap: 6,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                border: '2px dashed var(--border)',
                borderRadius: 'var(--radius-md, 12px)',
                cursor: busy ? 'progress' : 'pointer',
                textAlign: 'center',
              }}
            >
              <MIcon name={busy ? 'clock' : 'upload'} size={22} />
              <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
                {t('qi_choose_file')}
              </span>
              <span className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                {busy ? fileName : t('qi_formats', { max: MAX_IMPORT_QUESTIONS })}
              </span>
              <input
                type="file"
                accept={ACCEPT}
                disabled={busy}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so re-picking the same file after an error fires onChange again.
                  e.target.value = '';
                  if (file) void pick(file);
                }}
              />
            </label>
            {/* The DS Button always renders a <button>, and a download needs an <a download>, so this
                is a plain anchor wearing the same dashed styling as the key-file control further
                down. */}
            <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <a
                href={templateUrl || undefined}
                download="mochi-questions-template.csv"
                className="m-row"
                style={{
                  gap: 6,
                  padding: '6px 12px',
                  border: '1.5px dashed var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <MIcon name="download" size={16} />
                {t('qi_template')}
              </a>
              <span
                className="m-muted"
                style={{ fontSize: 'var(--text-xs)', flex: 1, minWidth: 200 }}
              >
                {t('qi_skill_hint')}
              </span>
            </div>
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                {error}
              </div>
            )}
          </div>
        )}

        {phase === 'review' && (
          <div className="m-stack" style={{ gap: 12 }}>
            <MC style={{ padding: 12 }}>
              <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <MBtn
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setRows((prev) =>
                      prev.map((row) => ({ ...row, checked: validateDraft(row.draft) == null })),
                    )
                  }
                >
                  {t('qi_select_valid')}
                </MBtn>
                <MBtn
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((prev) => prev.map((row) => ({ ...row, checked: false })))}
                >
                  {t('qi_select_none')}
                </MBtn>
                <div style={{ minWidth: 180, flex: 1 }}>
                  <MSelect
                    label={t('qi_bulk_grade')}
                    value={bulkGrade}
                    onChange={applyBulkGrade}
                    options={gradeOptions}
                  />
                </div>
                {mode === 'test' && (
                  <div className="mochi-field" style={{ width: 130 }}>
                    <label className="mochi-field__label">{t('qi_points_each')}</label>
                    <input
                      className="mochi-input"
                      type="number"
                      step="0.5"
                      min="0"
                      value={String(points)}
                      onChange={(e) => setPoints(Number(e.target.value))}
                    />
                  </div>
                )}
              </div>
            </MC>

            {/* Separate answer key. Collapsed by default — a paper that already marks its answers
                needs nothing here, and the box is long. */}
            <MC style={{ padding: 12 }}>
              <div className="m-spread" style={{ alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
                  {t('qi_key_title')}
                </span>
                <MBtn variant="ghost" size="sm" onClick={() => setKeyOpen((v) => !v)}>
                  {keyOpen ? t('qi_key_hide') : t('qi_key_show')}
                </MBtn>
              </div>
              {keyOpen && (
                <div className="m-stack" style={{ gap: 8, marginTop: 8 }}>
                  <span className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {t('qi_key_hint')}
                  </span>
                  <textarea
                    className="mochi-input"
                    rows={4}
                    style={{ resize: 'vertical', minHeight: 84, paddingTop: 10 }}
                    placeholder={t('qi_key_ph')}
                    value={keyText}
                    onChange={(e) => setKeyText(e.target.value)}
                  />
                  <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <MBtn variant="primary" size="sm" onClick={applyKey} disabled={!keyText.trim()}>
                      {t('qi_key_apply')}
                    </MBtn>
                    <label
                      className="m-row"
                      style={{
                        gap: 6,
                        padding: '6px 12px',
                        border: '1.5px dashed var(--border-strong)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 600,
                      }}
                    >
                      <MIcon name="upload" size={16} />
                      {t('qi_key_pick_file')}
                      <input
                        type="file"
                        accept={KEY_ACCEPT}
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) void pickKeyFile(file);
                        }}
                      />
                    </label>
                  </div>
                  {keyError && (
                    <span
                      style={{
                        color: 'var(--danger)',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 700,
                      }}
                    >
                      {keyError}
                    </span>
                  )}
                  {keyResult && (
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                      {t('qi_key_matched', { n: keyResult.matched })}
                      {keyResult.unmatched.length > 0 &&
                        ` · ${t('qi_key_unmatched', { list: joinNumbers(keyResult.unmatched) })}`}
                      {keyResult.unresolved.length > 0 &&
                        ` · ${t('qi_key_unresolved', { list: joinNumbers(keyResult.unresolved) })}`}
                      {keyResult.ambiguous.length > 0 &&
                        ` · ${t('qi_key_ambiguous', { list: joinNumbers(keyResult.ambiguous) })}`}
                    </span>
                  )}
                </div>
              )}
            </MC>

            <div className="m-stack" style={{ gap: 6, maxHeight: '46vh', overflowY: 'auto' }}>
              {rows.map((row, i) => {
                const problem = validateDraft(row.draft);
                return (
                  <div key={row.key} className="lrow" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ paddingTop: 2 }}>
                      <MCheck
                        checked={row.checked}
                        onChange={() => patchRow(i, { checked: !row.checked })}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="m-row"
                        style={{ gap: 6, flexWrap: 'wrap', marginBottom: 4, alignItems: 'center' }}
                      >
                        {row.sourceNumber != null && (
                          <span
                            className="m-muted"
                            style={{ fontSize: 'var(--text-xs)', fontWeight: 800 }}
                          >
                            {t('qi_q_number', { n: row.sourceNumber })}
                          </span>
                        )}
                        <MTag color={TYPE_COLOR[row.draft.type]}>{t(TYPE_TK[row.draft.type])}</MTag>
                        {row.draft.context && (
                          <span className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                            {t('qi_has_context')}
                          </span>
                        )}
                        {row.draft.options.length > 0 && (
                          <span className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                            {t('qi_n_options', { n: row.draft.options.length })}
                          </span>
                        )}
                        {row.issues.map((issue) => (
                          <MBadge key={issue} color="orange">
                            {t(issue)}
                          </MBadge>
                        ))}
                        {row.checked && problem && !row.issues.includes(problem) && (
                          <MBadge color="danger">{t(problem)}</MBadge>
                        )}
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
                        {row.draft.prompt}
                      </div>
                    </div>
                    <MIB
                      label={t('edit')}
                      size="sm"
                      onClick={() => setEditing({ index: i, snapshot: row.draft })}
                    >
                      <MIcon name="edit" size={16} />
                    </MIB>
                  </div>
                );
              })}
            </div>

            {skipped.length > 0 && (
              <span className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                {t('qi_rows_skipped', { list: skipped.join(', ') })}
              </span>
            )}
            {truncated && (
              <span style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                {t('qi_truncated', { max: MAX_IMPORT_QUESTIONS })}
              </span>
            )}
            {missingNumbers.length > 0 && (
              <span className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                {t('qi_missing_numbers', { list: joinNumbers(missingNumbers) })}
              </span>
            )}
            {blocked.length > 0 && (
              <span style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                {t('qi_fix_selected', { n: blocked.length })}
              </span>
            )}
            {overTestCap && (
              <span style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                {t('qi_over_test_cap', { have: existingCount, pick: selected.length })}
              </span>
            )}
            {serverErrorMsg && (
              <span style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                {serverErrorMsg}
              </span>
            )}
          </div>
        )}
      </Modal>

      {editing && rows[editing.index] && (
        <QuestionEditorModal
          draft={rows[editing.index].draft}
          setDraft={(update) =>
            setRows((prev) =>
              prev.map((row, i) => {
                if (i !== editing.index) return row;
                const next = typeof update === 'function' ? update(row.draft) : update;
                return next ? { ...row, draft: next } : row;
              }),
            )
          }
          gradeLevels={gradeLevels}
          onSave={(draft) => applyEdit(editing.index, draft)}
          onClose={cancelEdit}
        />
      )}
    </>
  );
}
