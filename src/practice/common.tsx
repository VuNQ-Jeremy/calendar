import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';

/**
 * The pieces all four Practice screens share.
 *
 * Kept here rather than in src/ui.tsx because none of it is general: the textarea field exists
 * only because DS.Input has no multiline mode, and `usePracticeSubmit` exists so every screen
 * posts to the SAME path — the e2e kit arms one `posted('/practice-actions')` before a submit,
 * and a screen that invented its own endpoint would hang that wait forever.
 */

const { Tag } = DS;

export type PracticeSubmit = (fields: Record<string, string>) => void;

/**
 * Post one intent to the single Practice action route.
 *
 * ALWAYS call this in the SCREEN and pass the result down to dialogs — never inside a dialog that
 * closes itself on submit. `useFetcher`'s unmount cleanup deletes the fetcher and aborts its
 * in-flight request, so a dialog that closes optimistically and then submits from its own fetcher
 * loses the write about half the time. (It cost one e2e run to find; see the fix in practice-week.)
 */
export function usePracticeSubmit(): PracticeSubmit {
  const fetcher = useFetcher();
  return React.useCallback(
    (fields: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      fetcher.submit(fd, { action: '/practice-actions', method: 'post' });
    },
    [fetcher],
  );
}

/**
 * A labelled textarea in the same DOM shape DS.Input produces.
 *
 * The class names are load-bearing: `e2e/crud-helpers.ts` locates a field by
 * `.mochi-field:has(> label.mochi-field__label)` and then `textarea.mochi-input`.
 */
export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}) {
  const id = `pf-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="mochi-field">
      <label className="mochi-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="mochi-input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="mochi-field__hint">{hint}</span>}
    </div>
  );
}

export type ProofType = 'photo' | 'video' | 'either' | 'none';

/** The four proof options, in the order the teacher thinks about them. */
export function proofOptions(t: (k: string) => string) {
  return [
    { value: 'either', label: t('pr_proof_either') },
    { value: 'photo', label: t('pr_proof_photo') },
    { value: 'video', label: t('pr_proof_video') },
    { value: 'none', label: t('pr_proof_none') },
  ];
}

const STATUS_TAG: Record<string, { tk: string; color: 'neutral' | 'green' | 'orange' | 'violet' }> =
  {
    open: { tk: 'pr_status_open', color: 'neutral' },
    submitted: { tk: 'pr_status_submitted', color: 'orange' },
    accepted: { tk: 'pr_status_accepted', color: 'green' },
    rejected: { tk: 'pr_status_rejected', color: 'violet' },
    teacher_done: { tk: 'pr_status_teacher_done', color: 'green' },
  };

export function StatusTag({ status, t }: { status: string; t: (k: string) => string }) {
  const meta = STATUS_TAG[status] ?? STATUS_TAG.open;
  return <Tag color={meta.color}>{t(meta.tk)}</Tag>;
}

/** 'YYYY-MM-DD' → 'dd/MM'; the column headers and every badge use this form. */
export const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Monday of the ISO week containing `date`, as 'YYYY-MM-DD'. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function shiftDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
