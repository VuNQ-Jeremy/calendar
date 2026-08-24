import React from 'react';
import { DS } from '../ds/index.js';
import { Modal, MSelect, MDatePicker, MTimePicker } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { addDaysVn } from '../../shared/logic/garden';
import { ALL_MODES, normalizeModesCsv, parseModes } from '../../shared/logic/flashcards';
import type { GameMode } from '../../shared/logic/flashcards';
import type { VocabAssignmentRow } from '../../server/services/garden.js';

/**
 * "Giao bài" — assign one vocabulary topic to one class, with a deadline and a number of
 * qualifying rounds.
 *
 * The dialog owns its own intent (`assign-create` / `assign-update`) so the caller only has to
 * post the FormData it hands back; the topic is fixed by wherever it was opened from, which is why
 * there is no topic picker here.
 *
 * `today` is ICT today from the loader, not `new Date()` — the default deadline has to be a week
 * from the school's day, not from the device's.
 *
 * The deadline is a day plus an OPTIONAL clock time. Left unset it means end of day, which is what
 * every assignment meant before 0036; set, it is the instant after which no further round counts
 * (`deadlineEndUtc`, server/services/garden.ts).
 */

const { Button, Checkbox } = DS;

/** A week is the default ask: long enough to fit a weekend, short enough to still be homework. */
const DEFAULT_DAYS_AHEAD = 7;
/**
 * Half-hour blocks. A homework deadline is set to "six" or "half nine", never to 6:15, and the
 * shorter list is one scroll instead of four in the portalled menu.
 */
const DEADLINE_TIME_STEP = 30;
const DEFAULT_REQUIRED = 3;
const DEFAULT_MIN_SCORE = 70;
const DEFAULT_QUESTION_COUNT = 10;

export function AssignModal({
  topic,
  topics,
  classes,
  existing,
  today,
  onClose,
  onSubmit,
  rosterOf,
  hideClass,
}: {
  /** Fixed by the caller (the /vocabulary surface). Omit to show the picker built from `topics`. */
  topic?: { id: string; name: string } | null;
  /** Offered by the topic picker when `topic` is not fixed — the check-in "Giao từ vựng" surfaces. */
  topics?: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  existing?: VocabAssignmentRow | null;
  today: string;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
  /**
   * The chosen class's roster, as a function so the picker follows the class select — on
   * /vocabulary the teacher can change the class inside this dialog, and last class's students
   * must not stay tickable. Omit it entirely to hide the scope picker; `submit` then echoes back
   * whatever scope the assignment already had, so a surface without the picker cannot widen one.
   */
  rosterOf?: (classId: string) => { id: string; name: string }[];
  /** The caller already fixed the class (the event dialog / kiosk) — don't offer to change it. */
  hideClass?: boolean;
}) {
  const { t } = useLang();
  const [classId, setClassId] = React.useState(existing?.classId ?? classes[0]?.id ?? '');
  const [topicId, setTopicId] = React.useState(existing?.topicId ?? topic?.id ?? '');
  const [deadline, setDeadline] = React.useState(
    existing?.deadline ?? addDaysVn(today, DEFAULT_DAYS_AHEAD),
  );
  // '' is a real choice, not a missing one: it means the whole deadline day counts, which is what
  // every assignment meant before times existed. Only a set time narrows the window.
  const [deadlineTime, setDeadlineTime] = React.useState(existing?.deadlineTime ?? '');
  const [required, setRequired] = React.useState(
    String(existing?.requiredCount ?? DEFAULT_REQUIRED),
  );
  const [minScore, setMinScore] = React.useState(
    String(existing?.minScorePct ?? DEFAULT_MIN_SCORE),
  );
  const [questionCount, setQuestionCount] = React.useState(
    String(existing?.questionCount ?? DEFAULT_QUESTION_COUNT),
  );
  const [note, setNote] = React.useState(existing?.note ?? '');
  // Which game modes count. Empty = any mode, the meaning of a NULL modes column — so the
  // all-unchecked state is not an error, it is the default every assignment had before 0034.
  const [modes, setModes] = React.useState<Set<GameMode>>(
    () => new Set(parseModes(existing?.modes) ?? []),
  );
  // Whole class is the default AND the meaning of zero join rows; editing preloads the stored
  // narrow set so a save from a surface without the picker cannot silently widen the scope.
  const [scopeAll, setScopeAll] = React.useState(!(existing?.studentIds?.length ?? 0));
  const [picked, setPicked] = React.useState<Set<string>>(
    () => new Set(existing?.studentIds ?? []),
  );

  const rosterStudents = rosterOf?.(classId);
  // A class with nobody in it gets no picker — an empty list cannot be narrowed to, and
  // "Selected students" would be unsavable. It still posts '' (whole class) on save.
  const showScope = !!rosterStudents && rosterStudents.length > 0;

  // Switching class makes an individual selection meaningless — those students are not in the new
  // roster. Reset to whole-class rather than silently posting ids the class does not contain.
  // Skipped on the first render, so editing a narrowed assignment keeps the scope it was saved with.
  const openedWithClass = React.useRef(classId);
  React.useEffect(() => {
    if (classId === openedWithClass.current) return;
    setScopeAll(true);
    setPicked(new Set());
  }, [classId]);

  const valid = Boolean(
    classId && deadline && (topic?.id || topicId) && (scopeAll || picked.size > 0),
  );

  const toggleMode = (id: GameMode, on: boolean) =>
    setModes((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = () => {
    if (!valid) return;
    const fd = new FormData();
    fd.set('intent', existing ? 'assign-update' : 'assign-create');
    if (existing) fd.set('id', existing.id);
    fd.set('classId', classId);
    fd.set('topicId', topic?.id ?? topicId);
    fd.set('deadline', deadline);
    // '' reaches the row as NULL ("end of the deadline day") through the schema's transform.
    fd.set('deadlineTime', deadlineTime);
    // Coerced and bounded by VocabAssignmentInput on the server; clamped here only so an empty
    // field posts a usable number instead of a 400.
    fd.set('requiredCount', String(Math.min(Math.max(parseInt(required, 10) || 1, 1), 20)));
    fd.set('minScorePct', String(Math.min(Math.max(parseInt(minScore, 10) || 0, 0), 100)));
    fd.set(
      'questionCount',
      String(Math.min(Math.max(parseInt(questionCount, 10) || DEFAULT_QUESTION_COUNT, 5), 30)),
    );
    fd.set('note', note.trim());
    // '' reaches the row as NULL ("any mode") through the schema's transform.
    fd.set('modes', normalizeModesCsv([...modes]) ?? '');
    // '' reaches the row as NULL ("whole class") through the schema's transform. Surfaces with no
    // scope picker (no `rosterOf`) echo the assignment's existing scope back unchanged — this
    // dialog cannot widen a scope it has no way to show the teacher. Picks are filtered to the
    // roster actually on screen, so a stale id can never survive a class switch.
    fd.set(
      'studentIds',
      rosterStudents
        ? scopeAll
          ? ''
          : rosterStudents
              .filter((s) => picked.has(s.id))
              .map((s) => s.id)
              .join(',')
        : (existing?.studentIds ?? []).join(','),
    );
    onSubmit(fd);
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={existing ? t('garden_assign_edit') : t('garden_assign_title')}
      subtitle={topic?.name ?? topics?.find((x) => x.id === topicId)?.name ?? ''}
      // Wider once the student picker is in play: the checkbox list wraps into far fewer rows,
      // which is what keeps the whole dialog on screen without scrolling. `width` is a max-width,
      // so a phone still gets the full viewport.
      width={showScope ? 660 : 480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {t('save')}
          </Button>
        </>
      }
    >
      {!topic && (
        <MSelect
          label={t('garden_assign_topic')}
          value={topicId}
          onChange={setTopicId}
          options={(topics ?? []).map((x) => ({ value: x.id, label: x.name }))}
        />
      )}
      {!hideClass && (
        <MSelect
          label={t('class')}
          value={classId}
          onChange={setClassId}
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
        />
      )}
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MDatePicker
          label={t('garden_deadline')}
          value={deadline}
          onChange={(v: string) => setDeadline(v)}
        />
        <MTimePicker
          label={t('garden_deadline_time')}
          value={deadlineTime}
          onChange={(v: string) => setDeadlineTime(v)}
          step={DEADLINE_TIME_STEP}
          emptyLabel={t('garden_deadline_end_of_day')}
        />
      </div>
      <div className="m-grid cols-3" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('garden_required')}</label>
          <input
            className="mochi-input"
            type="number"
            min={1}
            max={20}
            value={required}
            onChange={(e) => setRequired(e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('garden_min_score')}</label>
          <input
            className="mochi-input"
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('garden_question_count')}</label>
          <input
            className="mochi-input"
            type="number"
            min={5}
            max={30}
            value={questionCount}
            onChange={(e) => setQuestionCount(e.target.value)}
          />
        </div>
      </div>
      <div className="mochi-field">
        <label className="mochi-field__label">{t('garden_modes')}</label>
        <div
          className="m-row"
          style={{ gap: '6px 14px', flexWrap: 'wrap', alignItems: 'center' }}
          data-testid="assign-modes"
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              borderRadius: 10,
              background: 'var(--brand-soft, #fdeede)',
              border: '1px solid var(--brand, #f79a4e)',
            }}
          >
            <Checkbox
              label={t('fc_mode_mix')}
              checked={modes.has('mix')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                toggleMode('mix', e.target.checked)
              }
            />
            <span
              style={{
                fontSize: 'var(--text-xs, 12px)',
                fontWeight: 700,
                color: 'var(--brand, #f79a4e)',
              }}
            >
              {t('fc_mode_mix_reco')}
            </span>
          </div>
          {ALL_MODES.filter((id) => id !== 'mix').map((id) => (
            <Checkbox
              key={id}
              label={t(`fc_mode_${id}`)}
              checked={modes.has(id)}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                toggleMode(id, e.target.checked)
              }
            />
          ))}
        </div>
        {modes.size === 0 && <span className="mochi-field__hint">{t('garden_modes_any')}</span>}
      </div>
      {showScope && (
        <div className="mochi-field">
          <label className="mochi-field__label">{t('garden_scope_label')}</label>
          <div className="m-row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <Checkbox
              label={t('garden_scope_all')}
              checked={scopeAll}
              onChange={() => setScopeAll(true)}
            />
            <Checkbox
              label={t('garden_scope_selected')}
              checked={!scopeAll}
              onChange={() => setScopeAll(false)}
            />
          </div>
          {!scopeAll && (
            <div className="m-row" style={{ gap: '4px 14px', flexWrap: 'wrap', marginTop: 6 }}>
              {rosterStudents.map((s) => (
                <Checkbox
                  key={s.id}
                  label={s.name}
                  checked={picked.has(s.id)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mochi-field">
        <label className="mochi-field__label">{t('garden_water_note')}</label>
        <textarea
          className="mochi-input"
          rows={2}
          maxLength={200}
          style={{ resize: 'vertical', minHeight: 56, paddingTop: 10 }}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
