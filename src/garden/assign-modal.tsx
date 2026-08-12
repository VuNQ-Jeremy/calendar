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

export function AssignModal({
  topic,
  classes,
  existing,
  today,
  onClose,
  onSubmit,
}: {
  topic: { id: string; name: string };
  classes: { id: string; name: string }[];
  existing?: VocabAssignmentRow | null;
  today: string;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  const { t } = useLang();
  const [classId, setClassId] = React.useState(existing?.classId ?? classes[0]?.id ?? '');
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
  const [note, setNote] = React.useState(existing?.note ?? '');
  // Which game modes count. Empty = any mode, the meaning of a NULL modes column — so the
  // all-unchecked state is not an error, it is the default every assignment had before 0034.
  const [modes, setModes] = React.useState<Set<GameMode>>(
    () => new Set(parseModes(existing?.modes) ?? []),
  );

  const valid = Boolean(classId && deadline);

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
    fd.set('topicId', topic.id);
    fd.set('deadline', deadline);
    // '' reaches the row as NULL ("end of the deadline day") through the schema's transform.
    fd.set('deadlineTime', deadlineTime);
    // Coerced and bounded by VocabAssignmentInput on the server; clamped here only so an empty
    // field posts a usable number instead of a 400.
    fd.set('requiredCount', String(Math.min(Math.max(parseInt(required, 10) || 1, 1), 20)));
    fd.set('minScorePct', String(Math.min(Math.max(parseInt(minScore, 10) || 0, 0), 100)));
    fd.set('note', note.trim());
    // '' reaches the row as NULL ("any mode") through the schema's transform.
    fd.set('modes', normalizeModesCsv([...modes]) ?? '');
    onSubmit(fd);
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={existing ? t('garden_assign_edit') : t('garden_assign_title')}
      subtitle={topic.name}
      width={480}
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
      <MSelect
        label={t('class')}
        value={classId}
        onChange={setClassId}
        options={classes.map((c) => ({ value: c.id, label: c.name }))}
      />
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
      <div className="m-grid cols-2" style={{ gap: 14 }}>
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
      </div>
      <div className="mochi-field">
        <label className="mochi-field__label">{t('garden_modes')}</label>
        <div
          className="m-row"
          style={{ gap: '6px 14px', flexWrap: 'wrap', alignItems: 'center' }}
          data-testid="assign-modes"
        >
          {ALL_MODES.map((id) => (
            <Checkbox
              key={id}
              label={t(`fc_mode_${id}`)}
              checked={modes.has(id)}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleMode(id, e.target.checked)}
            />
          ))}
        </div>
        {modes.size === 0 && <span className="mochi-field__hint">{t('garden_modes_any')}</span>}
      </div>
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
