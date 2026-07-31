import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MSelect, Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { TestAttemptRow } from '../../server/services/tests.js';
import type { StudentRow } from '../../server/services/people.js';

const { Card: MC, Avatar: MAv } = DS;

// Blank (ungraded) plus 0–10 in
// 0.25 steps, so no stored score is unpickable.
const SCORE_OPTIONS = [
  { value: '', label: '—' },
  ...Array.from({ length: 41 }, (_, i) => {
    const v = String(i * 0.25);
    return { value: v, label: v };
  }),
];

interface PaperScoreGridProps {
  testId: string;
  roster: StudentRow[];
  attempts: TestAttemptRow[];
  action: string;
}

export function PaperScoreGrid({ testId, roster, attempts, action }: PaperScoreGridProps) {
  const { t } = useLang();
  const saveFetcher = useFetcher<{ ok?: boolean; attempts?: TestAttemptRow[]; error?: string }>();

  // Local copy of the attempts:
  // autosaving POSTs to this route, whose clientAction invalidates the tests cache in a
  // `finally`. Without our own copy the grid would blank out mid-save until a refetch lands.
  const [saved, setSaved] = React.useState<TestAttemptRow[]>(attempts);
  React.useEffect(() => {
    if (attempts) setSaved(attempts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts]);
  React.useEffect(() => {
    if (saveFetcher.data?.ok && saveFetcher.data.attempts) setSaved(saveFetcher.data.attempts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data]);

  const [rows, setRows] = React.useState<Record<string, { score: string; comment: string }>>({});

  React.useEffect(() => {
    const seeded: Record<string, { score: string; comment: string }> = {};
    for (const s of roster) {
      const a = saved.find((x) => x.studentId === s.id);
      seeded[s.id] = {
        score: a?.normalizedScore != null ? String(a.normalizedScore) : '',
        comment: a?.comment ?? '',
      };
    }
    setRows(seeded);
    // Reseed only on a test switch / roster change — not on every autosave round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, roster.length]);

  const persist = (next: Record<string, { score: string; comment: string }>) => {
    const records = roster.map((s) => ({
      studentId: s.id,
      score: next[s.id]?.score === '' || next[s.id] == null ? null : Number(next[s.id].score),
      comment: next[s.id]?.comment || null,
    }));
    const fd = new FormData();
    fd.set('intent', 'save-paper-scores');
    fd.set('records', JSON.stringify(records));
    saveFetcher.submit(fd, { action, method: 'post' });
  };

  const setScore = (sid: string, score: string) => {
    const next = { ...rows, [sid]: { ...rows[sid], score } };
    setRows(next);
    persist(next);
  };
  const setComment = (sid: string, comment: string) =>
    setRows((p) => ({ ...p, [sid]: { ...p[sid], comment } }));
  const commitComment = () => persist(rows);

  if (!roster.length) return <Empty icon="users" title={t('att_empty_roster')} />;

  return (
    <MC style={{ padding: 16 }}>
      <div className="m-row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="mochi-eyebrow" style={{ flex: 1 }}>
          {t('tests_tab_results')}
        </span>
        {saveFetcher.data?.ok && saveFetcher.state === 'idle' && (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('paper_saved')}
          </span>
        )}
      </div>
      <div className="m-stack" style={{ gap: 6 }}>
        {roster.map((s) => (
          <div key={s.id} className="lrow" style={{ gap: 10 }}>
            <MAv name={s.name} color={s.color} size="sm" />
            <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
              {s.name}
            </span>
            <div className="hw-grade-score" style={{ width: 90 }}>
              <MSelect
                value={rows[s.id]?.score ?? ''}
                onChange={(v) => setScore(s.id, v)}
                options={SCORE_OPTIONS}
              />
            </div>
            <input
              className="mochi-input"
              style={{ width: 220 }}
              placeholder={t('hw_comment')}
              value={rows[s.id]?.comment ?? ''}
              onChange={(e) => setComment(s.id, e.target.value)}
              onBlur={commitComment}
            />
          </div>
        ))}
      </div>
    </MC>
  );
}
