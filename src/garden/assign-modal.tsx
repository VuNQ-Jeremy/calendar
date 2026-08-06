import React from 'react';
import { DS } from '../ds/index.js';
import { Modal, MSelect, MDatePicker } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { addDaysVn } from '../../shared/logic/garden';
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
 */

const { Button } = DS;

/** A week is the default ask: long enough to fit a weekend, short enough to still be homework. */
const DEFAULT_DAYS_AHEAD = 7;
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
  const [required, setRequired] = React.useState(
    String(existing?.requiredCount ?? DEFAULT_REQUIRED),
  );
  const [minScore, setMinScore] = React.useState(
    String(existing?.minScorePct ?? DEFAULT_MIN_SCORE),
  );
  const [note, setNote] = React.useState(existing?.note ?? '');

  const valid = Boolean(classId && deadline);

  const submit = () => {
    if (!valid) return;
    const fd = new FormData();
    fd.set('intent', existing ? 'assign-update' : 'assign-create');
    if (existing) fd.set('id', existing.id);
    fd.set('classId', classId);
    fd.set('topicId', topic.id);
    fd.set('deadline', deadline);
    // Coerced and bounded by VocabAssignmentInput on the server; clamped here only so an empty
    // field posts a usable number instead of a 400.
    fd.set('requiredCount', String(Math.min(Math.max(parseInt(required, 10) || 1, 1), 20)));
    fd.set('minScorePct', String(Math.min(Math.max(parseInt(minScore, 10) || 0, 0), 100)));
    fd.set('note', note.trim());
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
      <MDatePicker
        label={t('garden_deadline')}
        value={deadline}
        onChange={(v: string) => setDeadline(v)}
      />
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
