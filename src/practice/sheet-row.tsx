import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { parseQuickAddLines } from '../../shared/logic/practice.js';
import type { SheetRow } from '../../shared/logic/practice-sheet.js';
import type { StudentTaskRow } from '../../server/services/practice.js';
import type { MaterialRow } from '../../server/services/materials.js';
import {
  materialOptions,
  NO_MATERIAL,
  proofOptions,
  StatusTag,
  type PracticeSubmit,
} from './common.jsx';

const { Button, IconButton, Tag } = DS;

/**
 * The sheet's rows. A TaskRow is one student copy with every column edited in place — the whole
 * point of the redesign is that assign / check / comment happen on one line, as they did in the
 * teacher's spreadsheet. A BlankRow is the "next empty line" of that spreadsheet.
 *
 * Rules made visible here rather than in a dialog:
 * - title / material / link / proof are editable only while the copy is `open` (the server only
 *   propagates to open copies, and a submitted title is part of the record);
 * - a `class` row posts update-task / delete-task (touches every student's open copy), a
 *   `student` row posts update-copy / remove-copy (this student only);
 * - feedback saves on blur, any status.
 *
 * `data-testid` / `aria-label` strings are e2e handles (e2e/crud-practice.spec.ts).
 */

type Confirm = (o: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}) => Promise<boolean>;

/** A text cell that looks like text until hovered; commits on blur/Enter, reverts on Escape. */
function CellInput({
  value,
  onCommit,
  disabled,
  placeholder,
  ariaLabel,
  type = 'text',
  className = '',
  allowEmpty = false,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  type?: 'text' | 'url';
  className?: string;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const cancel = React.useRef(false);
  React.useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      return;
    }
    const v = draft.trim();
    if (v === value || (!v && !allowEmpty)) {
      setDraft(value);
      return;
    }
    onCommit(v);
  };

  return (
    <input
      className={`mochi-input pr-sheet__cell ${className}`}
      type={type}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          cancel.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Feedback textarea: saves on blur when changed and flashes "Saved" for a moment. */
function FeedbackCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const { t } = useLang();
  const [draft, setDraft] = React.useState(value);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(id);
  }, [saved]);

  const commit = () => {
    if (draft.trim() === (value ?? '').trim()) return;
    onCommit(draft.trim());
    setSaved(true);
  };

  return (
    <div>
      <textarea
        className="mochi-input pr-sheet__cell pr-sheet__feedback"
        rows={1}
        value={draft}
        aria-label={t('pr_feedback')}
        placeholder={t('pr_feedback')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {saved && <div className="pr-sheet__saved">{t('pr_saved')}</div>}
    </div>
  );
}

/** Proof thumbnail; click opens the full photo/video in a Modal. */
function ProofThumb({ copy }: { copy: StudentTaskRow }) {
  const { t } = useLang();
  const [open, setOpen] = React.useState(false);
  if (!copy.mediaKey) return null;
  // The key contains slashes; the route matches a single `:key` segment, so it must be encoded.
  const src = `/practice-media/${encodeURIComponent(copy.mediaKey)}`;
  const isVideo = (copy.mediaType ?? '').startsWith('video/');
  return (
    <>
      <button
        type="button"
        className="pr-sheet__thumb"
        aria-label={t('pr_open_proof')}
        onClick={() => setOpen(true)}
      >
        {isVideo ? <video src={src} preload="metadata" muted /> : <img src={src} alt="" />}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={copy.title} width={820}>
        {isVideo ? (
          <video className="pr-sheet__media" src={src} controls autoPlay />
        ) : (
          <img className="pr-sheet__media" src={src} alt={copy.title} />
        )}
      </Modal>
    </>
  );
}

export function TaskRow({
  row,
  studentName,
  materials,
  submit,
  confirm,
}: {
  row: SheetRow<StudentTaskRow>;
  studentName: string;
  materials: MaterialRow[];
  submit: PracticeSubmit;
  confirm: Confirm;
}) {
  const { t } = useLang();
  const { copy, scope } = row;
  const editable = copy.status === 'open';
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  const patch = (fields: Record<string, string>) =>
    submit(
      scope === 'class'
        ? { intent: 'update-task', id: copy.taskId!, ...fields }
        : { intent: 'update-copy', id: copy.id, ...fields },
    );

  const review = (
    decision: 'accept' | 'reject' | 'teacher_done',
    extra: Record<string, string> = {},
  ) => submit({ intent: 'review', studentTaskId: copy.id, decision, ...extra });

  const remove = async () => {
    const ok = await confirm({
      title: t('pr_delete_task'),
      message: t('pr_delete_task_confirm'),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    submit(
      scope === 'class'
        ? { intent: 'delete-task', id: copy.taskId! }
        : { intent: 'remove-copy', id: copy.id },
    );
  };

  const materialTitle = copy.materialId
    ? (materials.find((m) => m.id === copy.materialId)?.title ?? null)
    : null;

  return (
    <div
      className={`pr-sheet__row${copy.status === 'submitted' ? ' is-review' : ''}`}
      data-testid="pr-row"
      data-copy={copy.id}
      data-title={copy.title}
    >
      <div className="pr-sheet__c">
        <CellInput
          value={copy.title}
          disabled={!editable}
          ariaLabel={t('pr_task_title')}
          className="pr-sheet__title"
          onCommit={(v) => patch({ title: v })}
        />
      </div>
      <div className="pr-sheet__c">
        {editable ? (
          <MSelect
            value={copy.materialId ?? NO_MATERIAL}
            onChange={(v) => patch({ materialId: v === NO_MATERIAL ? '' : v })}
            options={materialOptions(materials, t)}
          />
        ) : materialTitle ? (
          <Tag>{materialTitle}</Tag>
        ) : (
          <span className="pr-sheet__muted">—</span>
        )}
      </div>
      <div className="pr-sheet__c pr-sheet__link">
        {editable ? (
          <CellInput
            value={copy.url ?? ''}
            type="url"
            allowEmpty
            placeholder="https://"
            ariaLabel={t('pr_url')}
            onCommit={(v) => patch({ url: v })}
          />
        ) : null}
        {copy.url && (
          <a href={copy.url} target="_blank" rel="noreferrer" aria-label={t('pr_url')}>
            <MIcon name="link" size={16} />
          </a>
        )}
        {!editable && !copy.url && <span className="pr-sheet__muted">—</span>}
      </div>
      <div className="pr-sheet__c pr-sheet__time">
        {copy.timeFrom ? (
          `${copy.timeFrom}–${copy.timeTo ?? '—'}`
        ) : (
          <span className="pr-sheet__muted">—</span>
        )}
      </div>
      <div className="pr-sheet__c">
        <div className="pr-sheet__status">
          {editable ? (
            <>
              <MSelect
                value={copy.proofType}
                onChange={(v) => patch({ proofType: v })}
                options={proofOptions(t)}
              />
              <Button size="sm" variant="secondary" onClick={() => review('teacher_done')}>
                {t('pr_mark_done')}
              </Button>
            </>
          ) : (
            <>
              <StatusTag status={copy.status} t={t} />
              <ProofThumb copy={copy} />
              {copy.recordedByTeacher && <Tag>{t('pr_recorded_by_teacher')}</Tag>}
              {copy.status === 'rejected' && copy.rejectReason && (
                <span className="pr-sheet__muted">{copy.rejectReason}</span>
              )}
            </>
          )}
          {copy.status === 'submitted' && !rejecting && (
            <>
              <Button size="sm" onClick={() => review('accept')}>
                {t('pr_accept')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
                {t('pr_reject')}
              </Button>
            </>
          )}
          {copy.status === 'submitted' && rejecting && (
            <div className="pr-sheet__reason">
              <DS.Input
                label={t('pr_reject_reason')}
                value={reason}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
              />
              <Button
                size="sm"
                variant="danger"
                onClick={() => review('reject', { rejectReason: reason })}
              >
                {t('pr_reject')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                {t('cancel')}
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="pr-sheet__c">
        {copy.note ? copy.note : <span className="pr-sheet__muted">—</span>}
      </div>
      <div className="pr-sheet__c">
        <FeedbackCell
          value={copy.feedback ?? ''}
          onCommit={(v) =>
            submit({ intent: 'review', studentTaskId: copy.id, decision: 'feedback', feedback: v })
          }
        />
      </div>
      <div className="pr-sheet__c pr-sheet__actions">
        <span className="pr-sheet__scope">
          {scope === 'class' ? t('pr_scope_everyone') : t('pr_scope_only', { name: studentName })}
        </span>
        {(scope === 'class' || editable) && (
          <IconButton
            label={t('pr_delete_task')}
            title={scope === 'class' ? t('pr_delete_everyone') : t('pr_remove_copy')}
            onClick={() => void remove()}
          >
            <MIcon name="trash" size={15} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

export function BlankRow({
  classId,
  date,
  studentId,
  studentName,
  materials,
  defaultMaterialId,
  submit,
}: {
  classId: string;
  date: string;
  studentId: string;
  studentName: string;
  materials: MaterialRow[];
  /** The day's last row's material, so consecutive lines inherit it like the sheet did. */
  defaultMaterialId: string | null;
  submit: PracticeSubmit;
}) {
  const { t } = useLang();
  const [text, setText] = React.useState('');
  const [materialId, setMaterialId] = React.useState(defaultMaterialId ?? NO_MATERIAL);
  const [proofType, setProofType] = React.useState('either');
  const [only, setOnly] = React.useState(false);

  const save = () => {
    if (!parseQuickAddLines(text).length) return;
    // ONE post whichever scope: useFetcher aborts an in-flight submit when the next one starts, so
    // several create-task posts in a loop would lose all but the last line.
    const fields: Record<string, string> = {
      intent: 'quick-add',
      classId,
      date,
      lines: text,
      proofType,
    };
    if (materialId !== NO_MATERIAL) fields.materialId = materialId;
    if (only) fields.studentId = studentId;
    submit(fields);
    setText('');
  };

  return (
    <div className="pr-sheet__row is-blank" data-testid="pr-blank" data-date={date}>
      <div className="pr-sheet__c">
        <textarea
          className="mochi-input pr-sheet__cell pr-sheet__blank"
          rows={1}
          value={text}
          placeholder={t('pr_blank_ph')}
          aria-label={t('pr_task_title')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
      <div className="pr-sheet__c">
        <MSelect
          value={materialId}
          onChange={setMaterialId}
          options={materialOptions(materials, t)}
        />
      </div>
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c">
        <MSelect value={proofType} onChange={setProofType} options={proofOptions(t)} />
      </div>
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c" />
      <div className="pr-sheet__c pr-sheet__actions">
        <Button size="sm" variant="ghost" aria-pressed={only} onClick={() => setOnly(!only)}>
          {only ? t('pr_scope_only', { name: studentName }) : t('pr_scope_everyone')}
        </Button>
      </div>
    </div>
  );
}
