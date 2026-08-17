import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { readSheetRows, SHEET_ACCEPT } from '../lib/sheet-rows.js';
import { ExtractInputError } from '../../shared/logic/import-error';
import {
  MAX_IMPORT_UNITS,
  MAX_IMPORT_WORDS,
  parseVocabRows,
  VOCAB_TEMPLATE_CSV,
  type ParsedVocabUnit,
  type ParsedVocabWord,
} from '../../shared/logic/vocab-csv';
import type { VocabCurriculumRow } from '../../server/services/vocab-curricula.js';
import type { VocabTopicRow } from '../../server/services/flashcards.js';

const { Button, IconButton, Checkbox, Badge, Tag } = DS;

/**
 * Curriculum management and workbook import for /vocabulary.
 *
 * Kept out of src/flashcards/index.tsx, which is already ~1200 lines and holds four concerns. These
 * two belong together: they are the same object seen from two angles — the rail files decks into a
 * book, and the importer creates a book's worth of decks at once.
 */

export interface GradeLevelOption {
  id: string;
  name: string;
  active: boolean;
}

/* ── Rail ────────────────────────────────────────────────────────────────────────────────────── */

export type RailValue = { kind: 'all' } | { kind: 'loose' } | { kind: 'curriculum'; id: string };

/**
 * The filter above the deck grid: All units · Not in a book · one chip per curriculum.
 *
 * "Not in a book" exists because every deck that predates the curriculum spine is unfiled, and a rail
 * that only offered books would hide them.
 */
export function CurriculumRail({
  curricula,
  value,
  onChange,
  onEdit,
  onNew,
  onImport,
  canManage,
}: {
  curricula: VocabCurriculumRow[];
  value: RailValue;
  onChange: (v: RailValue) => void;
  onEdit: (c: VocabCurriculumRow) => void;
  onNew: () => void;
  onImport: () => void;
  canManage: boolean;
}) {
  const { t, lang } = useLang();
  const is = (v: RailValue) =>
    v.kind === value.kind && (v.kind !== 'curriculum' || v.id === (value as { id: string }).id);

  return (
    <div className="m-row m-row--wrap" style={{ gap: 8, marginBottom: 14, alignItems: 'center' }}>
      <Tag color={is({ kind: 'all' }) ? 'violet' : null} onClick={() => onChange({ kind: 'all' })}>
        {t('vc_all_decks')}
      </Tag>
      <Tag
        color={is({ kind: 'loose' }) ? 'violet' : null}
        onClick={() => onChange({ kind: 'loose' })}
      >
        {t('vc_freestanding')}
      </Tag>
      {curricula.map((c) => (
        <span key={c.id} className="m-row" style={{ gap: 2, alignItems: 'center' }}>
          <Tag
            color={is({ kind: 'curriculum', id: c.id }) ? 'violet' : null}
            onClick={() => onChange({ kind: 'curriculum', id: c.id })}
          >
            {c.name}
            {/* A shared badge, so a teacher can tell a platform book from their own before editing. */}
            {c.tenantId === null ? ` · ${t('vc_library_badge')}` : ''}
            {` · ${t('vc_n_units', { n: c.unitCount })}`}
          </Tag>
          {canManage && (
            <IconButton label={t('edit')} size="sm" onClick={() => onEdit(c)}>
              <MIcon name="edit" size={14} />
            </IconButton>
          )}
        </span>
      ))}
      {canManage && (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onNew}
            iconLeft={<MIcon name="plus" size={16} />}
          >
            {t('vc_add')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onImport}
            iconLeft={<MIcon name="upload" size={16} />}
          >
            {t('vi_import')}
          </Button>
        </>
      )}
      {/* `lang` is read so the rail re-renders on a language switch even though every label is via t(). */}
      <span hidden data-lang={lang} />
    </div>
  );
}

/* ── Create / edit a curriculum ───────────────────────────────────────────────────────────────── */

export interface CurriculumDraft {
  id?: string;
  name: string;
  gradeLevelId: string | null;
  publisher: string;
  description: string;
  active: boolean;
  intoLibrary: boolean;
  /** Set when editing a shared library row, which only a platform admin may save. */
  isLibrary: boolean;
}

export const emptyCurriculum = (): CurriculumDraft => ({
  name: '',
  gradeLevelId: null,
  publisher: '',
  description: '',
  active: true,
  intoLibrary: false,
  isLibrary: false,
});

export const draftOf = (c: VocabCurriculumRow): CurriculumDraft => ({
  id: c.id,
  name: c.name,
  gradeLevelId: c.gradeLevelId,
  publisher: c.publisher ?? '',
  description: c.description ?? '',
  active: c.active,
  intoLibrary: c.tenantId === null,
  isLibrary: c.tenantId === null,
});

export function CurriculumModal({
  draft,
  grades,
  isPlatformAdmin,
  onClose,
}: {
  draft: CurriculumDraft;
  grades: GradeLevelOption[];
  isPlatformAdmin: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [d, setD] = React.useState(draft);
  const [confirm, confirmNode] = useConfirm();
  const busy = fetcher.state !== 'idle';

  // The list may deactivate a grade after this book was filed to it, so keep the current value
  // selectable — the same rule every other grade picker in the app follows.
  const options = grades.filter((g) => g.active || g.id === d.gradeLevelId);
  const readOnly = d.isLibrary && !isPlatformAdmin;

  const save = () => {
    if (!d.name.trim()) return;
    const fd = new FormData();
    fd.set('intent', d.id ? 'curriculum-update' : 'curriculum-create');
    if (d.id) fd.set('id', d.id);
    fd.set('name', d.name.trim());
    fd.set('gradeLevelId', d.gradeLevelId ?? '');
    fd.set('publisher', d.publisher.trim());
    fd.set('description', d.description.trim());
    fd.set('active', String(d.active));
    if (!d.id) fd.set('intoLibrary', String(d.intoLibrary));
    fetcher.submit(fd, { action: '/vocabulary', method: 'post' });
    onClose();
  };

  const del = async () => {
    if (!d.id) return;
    if (!(await confirm({ title: t('vc_delete_q'), message: t('vc_delete_msg') }))) return;
    const fd = new FormData();
    fd.set('intent', 'curriculum-delete');
    fd.set('id', d.id);
    fetcher.submit(fd, { action: '/vocabulary', method: 'post' });
    onClose();
  };

  return (
    <Modal
      open
      title={d.id ? t('vc_edit') : t('vc_add')}
      width={560}
      onClose={onClose}
      footer={
        <div className="m-row" style={{ justifyContent: 'space-between', width: '100%' }}>
          {d.id && !readOnly ? (
            <Button variant="danger" onClick={del} disabled={busy}>
              {t('delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="m-row" style={{ gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="primary" onClick={save} disabled={busy || readOnly || !d.name.trim()}>
              {t('save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="m-stack">
        {readOnly && <p className="m-muted">{t('vc_library_read_only')}</p>}
        <div className="mochi-field">
          <label className="mochi-field__label">{t('vc_name')}</label>
          <input
            className="mochi-input"
            autoFocus
            disabled={readOnly}
            value={d.name}
            onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))}
          />
        </div>
        <MSelect
          label={t('vc_grade')}
          value={d.gradeLevelId ?? ''}
          onChange={(v: string) => setD((x) => ({ ...x, gradeLevelId: v || null }))}
          options={[
            { value: '', label: t('vc_no_grade') },
            ...options.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <div className="mochi-field">
          <label className="mochi-field__label">{t('vc_publisher')}</label>
          <input
            className="mochi-input"
            disabled={readOnly}
            value={d.publisher}
            onChange={(e) => setD((x) => ({ ...x, publisher: e.target.value }))}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('vc_description')}</label>
          <textarea
            className="mochi-input"
            rows={2}
            disabled={readOnly}
            value={d.description}
            onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))}
          />
        </div>
        <Checkbox
          checked={d.active}
          disabled={readOnly}
          onChange={() => setD((x) => ({ ...x, active: !x.active }))}
          label={t('cfg_active')}
        />
        {/* Only offered on create: moving a book between tiers would move every unit with it, which
            is a migration, not a checkbox. */}
        {!d.id && isPlatformAdmin && (
          <Checkbox
            checked={d.intoLibrary}
            onChange={() => setD((x) => ({ ...x, intoLibrary: !x.intoLibrary }))}
            label={t('vc_into_library')}
          />
        )}
      </div>
      {confirmNode}
    </Modal>
  );
}

/* ── Import a workbook ───────────────────────────────────────────────────────────────────────── */

type Row = { word: ParsedVocabWord; checked: boolean };
type Unit = { unitNo: number; name: string; rows: Row[]; open: boolean };

/**
 * Pick a file, review what was parsed, import.
 *
 * Modelled on src/tests/question-import.tsx, including its load-bearing rule: a row carrying an issue
 * starts UNCHECKED. Importing a word the app cannot fully honour — no meaning, or an example sentence
 * the games can never blank — should be a decision, not an accident.
 */
export function CurriculumImportModal({
  curricula,
  vocabTopics,
  isPlatformAdmin,
  onClose,
}: {
  curricula: VocabCurriculumRow[];
  vocabTopics: VocabTopicRow[];
  isPlatformAdmin: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const fetcher = useFetcher<{ ok?: boolean; units?: number; words?: number; error?: string }>();
  const [phase, setPhase] = React.useState<'pick' | 'review'>('pick');
  const [target, setTarget] = React.useState(curricula[0]?.id ?? '');
  const [units, setUnits] = React.useState<Unit[]>([]);
  const [skipped, setSkipped] = React.useState<number[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [error, setError] = React.useState('');

  const known = React.useMemo(() => vocabTopics.map((v) => v.id), [vocabTopics]);
  const chosen = curricula.find((c) => c.id === target);
  const intoLibrary = chosen?.tenantId === null && isPlatformAdmin;

  const pick = async (file: File | null) => {
    if (!file) return;
    setError('');
    try {
      const parsed = parseVocabRows(await readSheetRows(file), known);
      setUnits(
        parsed.units.map((u: ParsedVocabUnit) => ({
          unitNo: u.unitNo,
          name: u.name,
          open: false,
          rows: u.words.map((w) => ({ word: w, checked: w.issues.length === 0 })),
        })),
      );
      setSkipped(parsed.skipped);
      setTruncated(parsed.truncated);
      setPhase('review');
    } catch (e) {
      // Both the reader and the parser throw an i18n key as the message; anything else is a fault.
      setError(t(e instanceof ExtractInputError ? e.message : 'vi_err_read_failed'));
    }
  };

  const selected = units
    .map((u) => ({ ...u, rows: u.rows.filter((r) => r.checked) }))
    .filter((u) => u.rows.length);
  const selectedWords = selected.reduce((n, u) => n + u.rows.length, 0);

  const template = () => {
    // A BOM, because Excel mangles Vietnamese diacritics in a CSV without one.
    const blob = new Blob(['﻿' + VOCAB_TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vocabulary-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const submit = () => {
    if (!target || !selectedWords) return;
    const fd = new FormData();
    fd.set('intent', 'curriculum-import');
    if (intoLibrary) fd.set('intoLibrary', 'true');
    fd.set(
      'payload',
      JSON.stringify({
        curriculumId: target,
        units: selected.map((u) => ({
          unitNo: u.unitNo,
          name: u.name,
          // Re-clamped by the parser already; sent as the server's own input shape.
          words: u.rows.map((r) => ({
            word: r.word.word,
            meaningVi: r.word.meaningVi,
            definitionEn: r.word.definitionEn,
            ipa: r.word.ipa,
            partOfSpeech: r.word.partOfSpeech,
            exampleEn: r.word.exampleEn,
            exampleAnswer: r.word.exampleAnswer,
            topicIds: r.word.topicIds,
          })),
        })),
      }),
    );
    fetcher.submit(fd, { action: '/vocabulary', method: 'post' });
  };

  const done = fetcher.data?.ok;
  const toggleUnit = (no: number, checked: boolean) =>
    setUnits((us) =>
      us.map((u) => (u.unitNo === no ? { ...u, rows: u.rows.map((r) => ({ ...r, checked })) } : u)),
    );

  return (
    <Modal
      open
      title={t('vi_import')}
      width={760}
      onClose={onClose}
      footer={
        <div className="m-row" style={{ justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <Button variant="secondary" onClick={onClose}>
            {done ? t('close') : t('cancel')}
          </Button>
          {phase === 'review' && !done && (
            <Button
              variant="primary"
              onClick={submit}
              disabled={fetcher.state !== 'idle' || !target || !selectedWords}
            >
              {t('vi_do_import', { n: selectedWords })}
            </Button>
          )}
        </div>
      }
    >
      {done ? (
        <p>{t('vi_imported', { n: fetcher.data?.units ?? 0, m: fetcher.data?.words ?? 0 })}</p>
      ) : (
        <div className="m-stack">
          <MSelect
            label={t('vi_import_target')}
            value={target}
            onChange={setTarget}
            options={curricula.map((c) => ({
              value: c.id,
              label: c.tenantId === null ? `${c.name} · ${t('vc_library_badge')}` : c.name,
            }))}
          />
          {!curricula.length && <p className="m-muted">{t('vi_need_curriculum')}</p>}

          {phase === 'pick' && (
            <>
              <div className="mochi-field">
                <label className="mochi-field__label">{t('vi_file')}</label>
                <input
                  type="file"
                  className="mochi-input"
                  accept={SHEET_ACCEPT}
                  onChange={(e) => pick(e.target.files?.[0] ?? null)}
                />
                <div className="mochi-field__hint">{t('vi_file_hint')}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={template}>
                {t('vi_template')}
              </Button>
            </>
          )}

          {error && <p style={{ color: 'var(--danger, #d33)' }}>{error}</p>}
          {fetcher.data?.error && (
            <p style={{ color: 'var(--danger, #d33)' }}>{t('vi_err_save')}</p>
          )}

          {phase === 'review' && (
            <>
              <p>
                {t('vi_units_found', {
                  n: units.length,
                  m: units.reduce((a, u) => a + u.rows.length, 0),
                })}
              </p>
              {truncated && (
                <p className="m-muted">
                  {t('vi_truncated', { n: MAX_IMPORT_WORDS, u: MAX_IMPORT_UNITS })}
                </p>
              )}
              {skipped.length > 0 && (
                <p className="m-muted">{t('vi_skipped_rows', { rows: skipped.join(', ') })}</p>
              )}
              <div className="m-stack">
                {units.map((u) => {
                  const on = u.rows.filter((r) => r.checked).length;
                  return (
                    <div
                      key={u.unitNo}
                      className="lrow"
                      style={{ flexDirection: 'column', alignItems: 'stretch' }}
                    >
                      <div className="m-row" style={{ gap: 10 }}>
                        <Checkbox
                          checked={on === u.rows.length}
                          onChange={() => toggleUnit(u.unitNo, on !== u.rows.length)}
                          label=""
                        />
                        <span className="lrow__title" style={{ flex: 1 }}>
                          {t('vc_unit_badge', { n: u.unitNo })} · {u.name}
                        </span>
                        <Badge color={on ? 'green' : 'neutral'}>
                          {on}/{u.rows.length}
                        </Badge>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setUnits((us) =>
                              us.map((x) => (x.unitNo === u.unitNo ? { ...x, open: !x.open } : x)),
                            )
                          }
                        >
                          {u.open ? t('vi_hide') : t('vi_show')}
                        </Button>
                      </div>
                      {u.open && (
                        <div className="m-stack" style={{ marginTop: 8, gap: 4 }}>
                          {u.rows.map((r, i) => (
                            <div key={`${r.word.word}-${i}`} className="m-row" style={{ gap: 8 }}>
                              <Checkbox
                                checked={r.checked}
                                onChange={() =>
                                  setUnits((us) =>
                                    us.map((x) =>
                                      x.unitNo === u.unitNo
                                        ? {
                                            ...x,
                                            rows: x.rows.map((y, j) =>
                                              j === i ? { ...y, checked: !y.checked } : y,
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                label=""
                              />
                              <span style={{ flex: 1 }}>
                                <strong>{r.word.word}</strong>
                                {r.word.partOfSpeech ? ` (${r.word.partOfSpeech})` : ''}
                                {r.word.ipa ? ` ${r.word.ipa}` : ''} — {r.word.meaningVi}
                              </span>
                              {r.word.issues.map((iss) => (
                                <Badge key={iss} color="orange">
                                  {t(iss)}
                                </Badge>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
