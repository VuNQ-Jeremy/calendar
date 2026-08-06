import React from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { DS } from './ds/index.js';
import { PageHeader, Empty, MSelect } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { scoreColorId } from './lib/assess.js';
import { monthLabel, shiftMonth } from '../shared/logic/month.js';
import { computeMonthRankings } from '../shared/logic/rankings.js';
import type {
  RankRowInput,
  RankingWeights,
  StudentRanking,
} from '../shared/logic/rankings.js';
import type {
  RankAttendanceRow,
  RankBehaviorRow,
  RankRemarkRow,
  RankScoreRow,
} from '../server/services/rankings.js';
import type { StudentRow } from '../server/services/people.js';
import type { ClassLite } from '../server/services/classes.js';

const { Card, Avatar } = DS;

/** Months either side of the viewed one offered in the picker — a school year's worth each way. */
const MONTH_WINDOW = 12;

interface RankingsLoaderData {
  month: string;
  attendance: RankAttendanceRow[];
  scores: RankScoreRow[];
  behavior: RankBehaviorRow[];
  remarks: RankRemarkRow[];
  students: StudentRow[];
  classes: ClassLite[];
  weights: RankingWeights;
}

/** A labelled score chip. `null` shows an em dash rather than a misleading zero. */
function ScoreChip({ label, value }: { label: string; value: number | null }) {
  const c = value == null ? null : colorOf(scoreColorId(value));
  return (
    <span className="rank-chip">
      <span className="rank-chip__label">{label}</span>
      <span
        className="mchip"
        style={c ? { background: c.soft, color: c.ink, fontWeight: 700 } : { fontWeight: 700 }}
      >
        {value ?? '—'}
      </span>
    </span>
  );
}

export function RankingsScreen() {
  const { month, attendance, scores, behavior, remarks, students, classes, weights } =
    useLoaderData() as RankingsLoaderData;
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [classFilter, setClassFilter] = React.useState('all');

  const { ranked, unranked, byId } = React.useMemo(() => {
    const roster = students
      .filter((s) => classFilter === 'all' || s.classIds.includes(classFilter))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    // Under a class filter, a record with no class of its own is dropped: it cannot be
    // attributed to this class. Remarks are the exception below.
    const inClass = (rowClassId: string | null) =>
      classFilter === 'all' || rowClassId === classFilter;

    const attendanceBy = new Map<string, string[]>();
    for (const r of attendance) {
      if (!inClass(r.classId)) continue;
      const list = attendanceBy.get(r.studentId);
      if (list) list.push(r.status);
      else attendanceBy.set(r.studentId, [r.status]);
    }

    const behaviorBy = new Map<string, string[]>();
    for (const r of behavior) {
      if (!inClass(r.classId)) continue;
      const list = behaviorBy.get(r.studentId);
      if (list) list.push(r.type);
      else behaviorBy.set(r.studentId, [r.type]);
    }

    const scoresBy = new Map<string, number[]>();
    for (const r of scores) {
      if (!inClass(r.classId)) continue;
      const list = scoresBy.get(r.studentId);
      if (list) list.push(r.score);
      else scoresBy.set(r.studentId, [r.score]);
    }

    // Remarks have no class column — the teacher's monthly rating is of the student, so it
    // follows them into every class view rather than disappearing under a filter.
    const remarksBy = new Map<string, Record<string, number>>();
    for (const r of remarks) remarksBy.set(r.studentId, r.ratings);

    const rows: RankRowInput[] = roster.map((s) => ({
      studentId: s.id,
      attendanceStatuses: attendanceBy.get(s.id) ?? [],
      behaviorTypes: behaviorBy.get(s.id) ?? [],
      scores: scoresBy.get(s.id) ?? [],
      remarkRatings: remarksBy.get(s.id) ?? null,
    }));

    const result = computeMonthRankings(rows, weights);
    return {
      ranked: result.filter((s) => s.rank != null),
      unranked: result.filter((s) => s.rank == null),
      byId: new Map(students.map((s) => [s.id, s])),
    };
  }, [attendance, behavior, scores, remarks, students, weights, classFilter]);

  /**
   * A rolling window centred on the month being viewed. The loader only ever fetches one month,
   * so unlike the assessments picker there is no history here to enumerate the real options from;
   * a window keeps every neighbouring month one click away and always contains the current value.
   */
  const monthOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (let i = MONTH_WINDOW; i >= -MONTH_WINDOW; i--) set.add(shiftMonth(month, i));
    // Newest first: 'YYYY-MM' sorts lexicographically, so a descending compare is the whole job.
    return [...set]
      .sort((a, b) => b.localeCompare(a))
      .map((m) => ({ value: m, label: monthLabel(m, lang) }));
  }, [month, lang]);

  const breakdown = (s: StudentRanking) => {
    const parts: string[] = [];
    if (s.attendance != null) parts.push(t('rank_breakdown_attendance', { v: s.attendance }));
    if (s.behavior != null) parts.push(t('rank_breakdown_behavior', { v: s.behavior }));
    if (s.remark != null) parts.push(t('rank_breakdown_remark', { v: s.remark }));
    if (s.testCount > 0) parts.push(t('rank_tests_n', { n: s.testCount }));
    return parts.join(' · ');
  };

  const row = (s: StudentRanking) => {
    const student = byId.get(s.studentId);
    if (!student) return null;
    return (
      <div key={s.studentId} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
        <span className={'rank-num' + (s.rank != null && s.rank <= 3 ? ` rank-num--${s.rank}` : '')}>
          {s.rank ?? '—'}
        </span>
        <Avatar name={student.name} color={student.color} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{student.name}</div>
          <div className="lrow__meta rank-breakdown">{breakdown(s)}</div>
        </div>
        <ScoreChip label={t('rank_col_attitude')} value={s.attitude} />
        <ScoreChip label={t('rank_col_avg')} value={s.avgScore} />
        <span
          className="rank-total"
          style={s.total != null ? { color: colorOf(scoreColorId(s.total)).ink } : undefined}
        >
          {s.total ?? '—'}
        </span>
      </div>
    );
  };

  const hasStudents = ranked.length > 0 || unranked.length > 0;

  return (
    <div className="content">
      <PageHeader title={t('rank_title')} subtitle={t('rank_sub')} />

      <Card style={{ padding: 14 }}>
        <div className="assess-filters rank-filters">
          <MSelect
            label={t('assess_class')}
            value={classFilter}
            onChange={setClassFilter}
            options={[
              { value: 'all', label: t('assess_all_classes') },
              ...classes.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <MSelect
            label={t('assess_month')}
            value={month}
            onChange={(m) => navigate(`/rankings/${m}`)}
            options={monthOptions}
          />
          <span className="m-muted rank-weights-note">
            {t('rank_weights_note', { a: weights.attitude, s: weights.score })}
          </span>
        </div>
      </Card>

      {!hasStudents ? (
        <Card style={{ padding: 18 }}>
          <Empty icon="grad" title={t('rank_empty_title')} sub={t('rank_empty_sub')} />
        </Card>
      ) : (
        <Card style={{ padding: 18 }}>
          <div className="m-stack" style={{ gap: 8 }}>
            {ranked.map(row)}
            {unranked.length > 0 && (
              <>
                <div className="rank-section-head">{t('rank_no_data_section')}</div>
                {unranked.map(row)}
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
