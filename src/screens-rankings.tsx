import React from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { DS } from './ds/index.js';
import { PageHeader, Empty, MSelect } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { scoreColorId } from './lib/assess.js';
import { monthLabel, shiftMonth } from '../shared/logic/month.js';
import {
  computeMonthRankings,
  computeClassRankings,
  groupByCohort,
} from '../shared/logic/rankings.js';
import type {
  RankRowInput,
  RankingWeights,
  StudentRanking,
  ClassRankingInput,
} from '../shared/logic/rankings.js';
import type {
  RankAttendanceRow,
  RankBehaviorRow,
  RankRemarkRow,
  RankScoreRow,
} from '../server/services/rankings.js';
import type { StudentRow } from '../server/services/people.js';
import type { ClassLite } from '../server/services/classes.js';
import type { GradeLevelRow } from '../server/services/grade-levels.js';
import type { ClassLevelRow } from '../server/services/class-levels.js';
import type { TuiMuMonthTally } from '../shared/logic/checkin.js';

const { Card, Avatar, Tabs } = DS;

/** Months either side of the viewed one offered in the picker — a school year's worth each way. */
const MONTH_WINDOW = 12;

interface RankingsLoaderData {
  month: string;
  /** The live ICT month, from the server clock — the newest month the picker offers. */
  currentMonth: string;
  attendance: RankAttendanceRow[];
  scores: RankScoreRow[];
  behavior: RankBehaviorRow[];
  remarks: RankRemarkRow[];
  students: StudentRow[];
  classes: ClassLite[];
  weights: RankingWeights;
  gradeLevels: GradeLevelRow[];
  classLevels: ClassLevelRow[];
  /**
   * classId -> studentId -> that class's check-in tally for the month, or null when the admin
   * toggle (`checkin-settings.showRankings`) is off — in which case rankings are byte-identical
   * to the feature not existing. Each class's tally is the exact, correctly-scoped number
   * `classMonthTallies` computes; a student in several classes gets those tallies SUMMED for the
   * 'all'/cohort boards (sessions/fullCheckins/misses are additive across disjoint class rosters)
   * except `bags`, which is a whole-student total already and would double-count if summed — see
   * `aggregateCheckin` below.
   */
  checkinByClass: Record<string, Record<string, TuiMuMonthTally>> | null;
}

/** Fold several classes' tallies for one student into one, per the note above. */
function aggregateCheckin(tallies: TuiMuMonthTally[]): TuiMuMonthTally | null {
  if (!tallies.length) return null;
  return {
    bags: Math.max(...tallies.map((t) => t.bags)),
    misses: tallies.reduce((n, t) => n + t.misses, 0),
    fullCheckins: tallies.reduce((n, t) => n + t.fullCheckins, 0),
    streak: Math.max(...tallies.map((t) => t.streak)),
    sessions: tallies.reduce((n, t) => n + t.sessions, 0),
  };
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

/**
 * Group month records by class, then by student. Records with no class of their own are dropped:
 * the class board attributes everything to exactly one class, and an ad-hoc record belongs to none.
 */
function bucketByClass<T, V>(
  rows: T[],
  classIdOf: (r: T) => string | null,
  studentIdOf: (r: T) => string,
  valueOf: (r: T) => V,
): Map<string, Map<string, V[]>> {
  const out = new Map<string, Map<string, V[]>>();
  for (const r of rows) {
    const classId = classIdOf(r);
    if (!classId) continue;
    let byStudent = out.get(classId);
    if (!byStudent) {
      byStudent = new Map<string, V[]>();
      out.set(classId, byStudent);
    }
    const studentId = studentIdOf(r);
    const list = byStudent.get(studentId);
    if (list) list.push(valueOf(r));
    else byStudent.set(studentId, [valueOf(r)]);
  }
  return out;
}

export function RankingsScreen() {
  const {
    month,
    currentMonth,
    attendance,
    scores,
    behavior,
    remarks,
    students,
    classes,
    weights,
    gradeLevels,
    classLevels,
    checkinByClass,
  } = useLoaderData() as RankingsLoaderData;
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<'students' | 'classes'>('students');
  /** 'all' | `class:<id>` | `cohort:<gradeLevelId>::<classLevelId>` */
  const [scope, setScope] = React.useState('all');

  const cohorts = React.useMemo(() => groupByCohort(classes), [classes]);

  const cohortLabel = React.useCallback(
    (key: string) => {
      const [gradeId, levelId] = key.split('::');
      // Labels are resolved without checking `active`: a cohort keeps its name on the board even
      // after the level is retired from the pickers. '?' only shows if the row was deleted.
      const grade = gradeLevels.find((g) => g.id === gradeId)?.name ?? '?';
      const level = classLevels.find((c) => c.id === levelId)?.name ?? '?';
      return `${grade} · ${level}`;
    },
    [gradeLevels, classLevels],
  );

  const cohortKeys = React.useMemo(
    () => [...cohorts.keys()].sort((a, b) => cohortLabel(a).localeCompare(cohortLabel(b))),
    [cohorts, cohortLabel],
  );

  const { ranked, unranked, byId } = React.useMemo(() => {
    // 'all' keeps every record, including those with no class. Under a class or cohort scope a
    // record without a class of its own is dropped: it cannot be attributed to the scope.
    const scopeClassIds: Set<string> | null =
      scope === 'all'
        ? null
        : scope.startsWith('class:')
          ? new Set([scope.slice('class:'.length)])
          : new Set((cohorts.get(scope.slice('cohort:'.length)) ?? []).map((c) => c.id));
    const inScope = (rowClassId: string | null) =>
      scopeClassIds === null || (rowClassId != null && scopeClassIds.has(rowClassId));

    const roster = students
      .filter((s) => scopeClassIds === null || s.classIds.some((id) => scopeClassIds.has(id)))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));

    const attendanceBy = new Map<string, string[]>();
    for (const r of attendance) {
      if (!inScope(r.classId)) continue;
      const list = attendanceBy.get(r.studentId);
      if (list) list.push(r.status);
      else attendanceBy.set(r.studentId, [r.status]);
    }

    const behaviorBy = new Map<string, string[]>();
    for (const r of behavior) {
      if (!inScope(r.classId)) continue;
      const list = behaviorBy.get(r.studentId);
      if (list) list.push(r.type);
      else behaviorBy.set(r.studentId, [r.type]);
    }

    const scoresBy = new Map<string, number[]>();
    for (const r of scores) {
      if (!inScope(r.classId)) continue;
      const list = scoresBy.get(r.studentId);
      if (list) list.push(r.score);
      else scoresBy.set(r.studentId, [r.score]);
    }

    // Remarks have no class column — the teacher's monthly rating is of the student, so it
    // follows them into every class view rather than disappearing under a filter.
    const remarksBy = new Map<string, Record<string, number>>();
    for (const r of remarks) remarksBy.set(r.studentId, r.ratings);

    // Each class's tally is exact (classMonthTallies scopes it); a multi-class student's
    // several classes are summed by aggregateCheckin — see the loader-data doc comment.
    const checkinBy = new Map<string, TuiMuMonthTally>();
    if (checkinByClass) {
      for (const cls of classes) {
        if (!inScope(cls.id)) continue;
        const byStudent = checkinByClass[cls.id];
        if (!byStudent) continue;
        for (const [studentId, tally] of Object.entries(byStudent)) {
          const existing = checkinBy.get(studentId);
          checkinBy.set(studentId, existing ? aggregateCheckin([existing, tally])! : tally);
        }
      }
    }

    const rows: RankRowInput[] = roster.map((s) => ({
      studentId: s.id,
      attendanceStatuses: attendanceBy.get(s.id) ?? [],
      behaviorTypes: behaviorBy.get(s.id) ?? [],
      scores: scoresBy.get(s.id) ?? [],
      remarkRatings: remarksBy.get(s.id) ?? null,
      checkin: checkinBy.get(s.id) ?? null,
    }));

    const result = computeMonthRankings(rows, weights);
    return {
      ranked: result.filter((s) => s.rank != null),
      unranked: result.filter((s) => s.rank == null),
      byId: new Map(students.map((s) => [s.id, s])),
    };
  }, [attendance, behavior, scores, remarks, students, weights, scope, cohorts, classes, checkinByClass]);

  /**
   * One board per cohort. Each class's score is the mean of its students' totals computed under
   * THAT class's filter — the same number the per-class student board shows — so a student in two
   * classes contributes to both. Classes whose students have no data this month stay unranked.
   */
  const classBoards = React.useMemo(() => {
    const attendanceBy = bucketByClass(
      attendance,
      (r) => r.classId,
      (r) => r.studentId,
      (r) => r.status,
    );
    const behaviorBy = bucketByClass(
      behavior,
      (r) => r.classId,
      (r) => r.studentId,
      (r) => r.type,
    );
    const scoresBy = bucketByClass(
      scores,
      (r) => r.classId,
      (r) => r.studentId,
      (r) => r.score,
    );
    const remarksBy = new Map(remarks.map((r) => [r.studentId, r.ratings]));

    return cohortKeys.map((key) => {
      const cohortClasses = (cohorts.get(key) ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)); // tie-break order for equal averages
      const rosterSize = new Map<string, number>();

      const inputs: ClassRankingInput[] = cohortClasses.map((cls) => {
        const roster = students
          .filter((s) => s.classIds.includes(cls.id))
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        rosterSize.set(cls.id, roster.length);
        const rows: RankRowInput[] = roster.map((s) => ({
          studentId: s.id,
          attendanceStatuses: attendanceBy.get(cls.id)?.get(s.id) ?? [],
          behaviorTypes: behaviorBy.get(cls.id)?.get(s.id) ?? [],
          scores: scoresBy.get(cls.id)?.get(s.id) ?? [],
          remarkRatings: remarksBy.get(s.id) ?? null,
          checkin: checkinByClass?.[cls.id]?.[s.id] ?? null,
        }));
        return {
          classId: cls.id,
          totals: computeMonthRankings(rows, weights).map((r) => r.total),
        };
      });

      return {
        key,
        label: cohortLabel(key),
        rosterSize,
        byId: new Map(cohortClasses.map((c) => [c.id, c])),
        rows: computeClassRankings(inputs),
      };
    });
  }, [
    attendance,
    behavior,
    scores,
    remarks,
    students,
    weights,
    cohorts,
    cohortKeys,
    cohortLabel,
    checkinByClass,
  ]);

  /**
   * A rolling window ending at the current month. The loader only ever fetches one month, so
   * unlike the assessments picker there is no history here to enumerate the real options from.
   *
   * Nothing after the current month is offered: a future month can only ever be empty, and an
   * empty board reads as "everyone lost their marks" rather than "this hasn't happened yet". A
   * month reached by URL is kept even when it is in the future, so the select is never blank.
   */
  const monthOptions = React.useMemo(() => {
    const set = new Set<string>([month]);
    for (let i = 0; i <= MONTH_WINDOW; i++) set.add(shiftMonth(currentMonth, -i));
    // Newest first: 'YYYY-MM' sorts lexicographically, so a descending compare is the whole job.
    return [...set]
      .filter((m) => m <= currentMonth || m === month)
      .sort((a, b) => b.localeCompare(a))
      .map((m) => ({ value: m, label: monthLabel(m, lang) }));
  }, [month, currentMonth, lang]);

  const breakdown = (s: StudentRanking) => {
    const parts: string[] = [];
    if (s.attendance != null) parts.push(t('rank_breakdown_attendance', { v: s.attendance }));
    if (s.behavior != null) parts.push(t('rank_breakdown_behavior', { v: s.behavior }));
    if (s.remark != null) parts.push(t('rank_breakdown_remark', { v: s.remark }));
    if (s.checkin != null) parts.push(t('rank_breakdown_checkin', { v: s.checkin }));
    if (s.testCount > 0) parts.push(t('rank_tests_n', { n: s.testCount }));
    return parts.join(' · ');
  };

  const rankNumClass = (rank: number | null) =>
    'rank-num' + (rank != null && rank <= 3 ? ` rank-num--${rank}` : '');

  const row = (s: StudentRanking) => {
    const student = byId.get(s.studentId);
    if (!student) return null;
    return (
      <div key={s.studentId} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
        <span className={rankNumClass(s.rank)}>{s.rank ?? '—'}</span>
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
        <div style={{ marginBottom: 12 }}>
          <Tabs
            value={tab}
            onChange={(v: string) => setTab(v as 'students' | 'classes')}
            tabs={[
              { id: 'students', label: t('rank_tab_students') },
              { id: 'classes', label: t('rank_tab_classes') },
            ]}
          />
        </div>
        <div className="assess-filters rank-filters">
          {tab === 'students' && (
            <MSelect
              label={t('assess_class')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: t('assess_all_classes') },
                ...cohortKeys.map((key) => ({ value: `cohort:${key}`, label: cohortLabel(key) })),
                ...classes.map((c) => ({ value: `class:${c.id}`, label: c.name })),
              ]}
            />
          )}
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

      {tab === 'students' ? (
        !hasStudents ? (
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
        )
      ) : classBoards.length === 0 ? (
        <Card style={{ padding: 18 }}>
          <Empty icon="grad" title={t('rank_class_empty_title')} sub={t('rank_class_empty_sub')} />
        </Card>
      ) : (
        classBoards.map((board) => {
          const rankedClasses = board.rows.filter((c) => c.rank != null);
          const unrankedClasses = board.rows.filter((c) => c.rank == null);
          const classRow = (c: (typeof board.rows)[number]) => {
            const cls = board.byId.get(c.classId);
            if (!cls) return null;
            return (
              <div key={c.classId} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
                <span className={rankNumClass(c.rank)}>{c.rank ?? '—'}</span>
                <Avatar name={cls.name} color={cls.color} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{cls.name}</div>
                  <div className="lrow__meta rank-breakdown">
                    {t('rank_class_students_n', {
                      a: c.rankedCount,
                      b: board.rosterSize.get(c.classId) ?? 0,
                    })}
                  </div>
                </div>
                <span
                  className="rank-total"
                  style={
                    c.average != null ? { color: colorOf(scoreColorId(c.average)).ink } : undefined
                  }
                >
                  {c.average ?? '—'}
                </span>
              </div>
            );
          };
          return (
            <Card key={board.key} style={{ padding: 18, marginTop: 16 }}>
              <div className="mochi-eyebrow" style={{ marginBottom: 10 }}>
                {board.label}
              </div>
              <div className="m-stack" style={{ gap: 8 }}>
                {rankedClasses.map(classRow)}
                {unrankedClasses.length > 0 && (
                  <>
                    <div className="rank-section-head">{t('rank_no_data_section')}</div>
                    {unrankedClasses.map(classRow)}
                  </>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
