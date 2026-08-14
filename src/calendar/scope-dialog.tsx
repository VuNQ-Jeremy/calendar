import React from 'react';
import type { FetcherWithComponents } from 'react-router';
import { DS } from '../ds/index.js';
import { iso, TODAY } from '../lib/core.js';
import { Modal } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { eventFormData } from './utils.js';
import type { EventDraft, ExpandedEvent } from './utils.js';

const { Button: CBtn } = DS;

export type RecurScope = 'single' | 'following' | 'all';

interface RecurScopeDialogProps {
  open: boolean;
  title: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (scope: RecurScope) => void;
}

/**
 * The Google-style question a recurring event asks before it changes: does this apply to the one
 * occurrence, to it and everything after, or to the whole series?
 */
export function RecurScopeDialog({
  open,
  title,
  danger,
  onCancel,
  onConfirm,
}: RecurScopeDialogProps) {
  const { t } = useLang();
  const [scope, setScope] = React.useState<RecurScope>('single');
  // Reset per opening: the safe answer should never be inherited from a previous decision.
  React.useEffect(() => {
    if (open) setScope('single');
  }, [open]);
  if (!open) return null;

  const OPTS: { id: RecurScope; tk: string }[] = [
    { id: 'single', tk: 'recur_scope_this' },
    { id: 'following', tk: 'recur_scope_following' },
    { id: 'all', tk: 'recur_scope_all' },
  ];
  return (
    <Modal
      open={true}
      onClose={onCancel}
      title={title}
      width={420}
      footer={
        <>
          <CBtn variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </CBtn>
          <CBtn variant={danger ? 'danger' : 'primary'} onClick={() => onConfirm(scope)}>
            {danger ? t('delete') : t('confirm')}
          </CBtn>
        </>
      }
    >
      <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {OPTS.map((o) => (
          <label
            key={o.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="recur-scope"
              checked={scope === o.id}
              onChange={() => setScope(o.id)}
            />
            <span style={{ color: 'var(--text-body)' }}>{t(o.tk)}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

type Pending =
  | { kind: 'move'; ev: ExpandedEvent; newDate: string; ns?: string; ne?: string }
  | { kind: 'save'; draft: EventDraft; occurrenceDate: string }
  | { kind: 'delete'; id: string; occurrenceDate: string };

interface EventWritesOpts {
  fetcher: FetcherWithComponents<unknown>;
  editor: EventDraft | null;
  setEditor: (e: EventDraft | null) => void;
  /**
   * Called for moves that commit straight away, so the caller can hold the event at its new slot
   * until the loader catches up. Not called for recurring moves — those wait on an answer, and
   * only the server knows what a split or a detach does to the series.
   */
  onDirectMove?: (m: { id: string; date: string; start?: string; end?: string }) => void;
}

/**
 * Every write the event dialog and the calendar grids make, with the recurring ones routed
 * through the scope chooser first. Shared by the calendar screen and the dashboard, which show
 * the same dialog and post to the same route.
 *
 * Returns the three handlers plus the dialog node — render it after the event modal so it stacks
 * above, both visually and in Modal's Escape ordering.
 */
export function useEventWrites({ fetcher, editor, setEditor, onDirectMove }: EventWritesOpts) {
  const { t } = useLang();
  const [pending, setPending] = React.useState<Pending | null>(null);

  const post = (fd: FormData) => fetcher.submit(fd, { action: '/calendar', method: 'post' });

  const submitMove = (p: Extract<Pending, { kind: 'move' }>, scope?: RecurScope) => {
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('id', p.ev.id!);
    fd.set('date', p.newDate);
    // Omitted by the month view, which has no time axis: a date-only move must not stamp times
    // onto an event that had none.
    if (p.ns) fd.set('start', p.ns);
    if (p.ne) fd.set('end', p.ne);
    if (scope) {
      fd.set('scope', scope);
      // expandEvents rewrites `date` to the occurrence's own day, so a dragged instance already
      // carries the date the server needs to split or detach at.
      fd.set('occurrenceDate', p.ev.date!);
    }
    post(fd);
  };

  const move = (ev: ExpandedEvent, newDate: string, ns?: string, ne?: string) => {
    if (!ev.id) return;
    if (newDate === ev.date && (!ns || ns === (ev.start ?? '00:00'))) return;
    const req = { kind: 'move' as const, ev, newDate, ns, ne };
    if ((ev.recurrence ?? 'none') !== 'none') {
      // Moving an occurrence that has already happened records what actually took place that day;
      // it says nothing about the pattern going forward. The other two answers would rewrite
      // history, so don't offer them — detach the one occurrence and leave the series alone. It
      // becomes a standalone event, which is also why deleting it later asks nothing.
      if (ev.date && ev.date < iso(TODAY)) {
        submitMove(req, 'single');
        return;
      }
      setPending(req); // ask first; nothing is submitted until the chooser is answered
      return;
    }
    onDirectMove?.({ id: ev.id, date: newDate, start: ns, end: ne });
    submitMove(req);
  };

  const save = (f: EventDraft) => {
    const wasRecurring = !!f.id && (editor?.recurrence ?? 'none') !== 'none';
    const stillRecurring = (f.recurrence ?? 'none') !== 'none';
    const KEYS = [
      'title',
      'date',
      'start',
      'end',
      'color',
      'classId',
      'location',
      'recurrence',
      'notes',
    ] as const;
    const changed = !!editor && KEYS.some((k) => (f[k] ?? '') !== (editor[k] ?? ''));
    if (wasRecurring && stillRecurring && changed) {
      // The editor stays open underneath: cancelling the chooser returns the teacher to it with
      // their edits intact.
      setPending({ kind: 'save', draft: f, occurrenceDate: editor!.date! });
      return;
    }
    // `editor` still holds the draft as it was opened — the modal edits its own copy — so it is
    // the occurrence date the teacher started from.
    post(eventFormData(f, t('ev_untitled'), editor?.date));
    setEditor(null);
  };

  const del = (id: string) => {
    if ((editor?.recurrence ?? 'none') !== 'none') {
      setPending({ kind: 'delete', id, occurrenceDate: editor!.date! });
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', id);
    post(fd);
    setEditor(null);
  };

  const onConfirm = (scope: RecurScope) => {
    const p = pending;
    if (!p) return;
    if (p.kind === 'move') {
      submitMove(p, scope);
    } else if (p.kind === 'save') {
      // No `fromDate` here — `scope` plus `occurrenceDate` is the newer, fuller spelling of it.
      const fd = eventFormData(p.draft, t('ev_untitled'));
      fd.set('scope', scope);
      fd.set('occurrenceDate', p.occurrenceDate);
      post(fd);
      setEditor(null);
    } else {
      const fd = new FormData();
      fd.set('intent', 'delete');
      fd.set('id', p.id);
      fd.set('scope', scope);
      fd.set('occurrenceDate', p.occurrenceDate);
      post(fd);
      setEditor(null);
    }
    setPending(null);
  };

  const dialog = (
    <RecurScopeDialog
      open={!!pending}
      title={t(pending?.kind === 'delete' ? 'recur_scope_title_del' : 'recur_scope_title')}
      danger={pending?.kind === 'delete'}
      onCancel={() => setPending(null)}
      onConfirm={onConfirm}
    />
  );

  return { move, save, del, dialog };
}
