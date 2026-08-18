import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, Modal, MSelect, MDatePicker, useConfirm } from './ui.jsx';
import { colorOf, iso, TODAY } from './lib/core.js';
import { useLang, locale } from './lib/i18n.jsx';
import { ProgressLineChart, StackedBarChart } from './components/charts.jsx';
import {
  ATTENDANCE_META,
  ATTENDANCE_STATUSES,
  BEHAVIOR_META,
  BEHAVIOR_TYPES,
  NEGATIVE_TYPES,
  bucketBehaviorByWeek,
  bucketBehaviorByWeekInMonth,
  scoreColorId,
  scoreStats,
  type BehaviorTypeId,
} from './lib/assess.js';
import { monthLabel } from '../shared/logic/month.js';
import { PlantSvg, stageKey } from './garden/plant-art.jsx';
import { MAX_STAGE } from '../shared/logic/garden.js';
import type { PlantStage } from '../shared/logic/garden.js';
import type { GardenMonthSummary } from '../server/services/garden.js';
import type { ScoreRow, BehaviorRow, RemarkRow } from '../server/services/assessments.js';
import type { StudentRow } from '../server/services/people.js';
import type { ClassLite } from '../server/services/classes.js';
import type { AssessmentTypeRow } from '../server/services/assessment-types.js';
import type { RemarkCriterionRow } from '../server/services/remark-criteria.js';
import type { ClassAttendanceSummary } from '../server/services/attendance.js';
import type { StudentMonthAssignment } from '../server/services/garden.js';
import type { TuiMuMonthTally } from '../shared/logic/checkin.js';

const { Card, Button, IconButton, Tabs, Badge, Avatar, ProgressBar } = DS;

const INCIDENT_WEEKS = 12;

interface AssessLoaderData {
  scores: ScoreRow[];
  behavior: BehaviorRow[];
  remarks: RemarkRow[];
  students: StudentRow[];
  classes: ClassLite[];
  types: AssessmentTypeRow[];
  criteria: RemarkCriterionRow[];
}

type RemarkDraft = {
  /** remark_criteria id -> 1-5. */
  ratings: Record<string, number>;
  comment: string;
};

type ScoreDraft = {
  id?: string;
  studentId: string;
  date: string;
  score: number | '';
  classId: string;
  assessmentTypeId: string;
  notes: string;
};

type BehaviorDraft = {
  id?: string;
  studentId: string;
  date: string;
  type: BehaviorTypeId;
  classId: string;
  notes: string;
};

function Stat({ num, label, color }: { num: React.ReactNode; label: string; color: string }) {
  const c = colorOf(color);
  return (
    <Card style={{ padding: 0 }}>
      <div className="statcard">
        <div className="statcard__icon" style={{ background: c.soft, color: c.ink }}>
          <MIcon name="chart" size={22} />
        </div>
        <div>
          <div className="statcard__num">{num}</div>
          <div className="statcard__label">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <span className="mchip" style={{ fontWeight: 700 }}>
        —
      </span>
    );
  }
  const c = colorOf(scoreColorId(score));
  return (
    <span className="mchip" style={{ background: c.soft, color: c.ink, fontWeight: 700 }}>
      {score}
    </span>
  );
}

/** Five stars, `value` of them lit. Clicking star N sets the rating to N. */
function RatingStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const lit = colorOf('orange');
  return (
    <span className="m-row" style={{ gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={String(i)}
          aria-pressed={i === value}
          onClick={() => onChange(i)}
          style={{
            background: 'none',
            border: 'none',
            padding: 2,
            cursor: 'pointer',
            lineHeight: 0,
            color: i <= value ? lit.base : 'var(--line, #ECE0CF)',
          }}
        >
          <MIcon name={i <= value ? 'starFill' : 'star'} size={22} />
        </button>
      ))}
    </span>
  );
}

/**
 * The monthly remark form. Mounted with a `key` of student+month so switching either resets the
 * draft — the alternative, syncing state to props in an effect, is where this kind of form goes
 * wrong (a half-typed comment surviving onto another student's report).
 */
function RemarkForm({
  criteria,
  existing,
  printHref,
  onSave,
  onDelete,
  className,
}: {
  /** Active criteria, in sort order — what the form shows and what "complete" means. */
  criteria: RemarkCriterionRow[];
  existing: RemarkRow | undefined;
  printHref: string;
  onSave: (d: RemarkDraft) => void;
  onDelete: () => void;
  className?: string;
}) {
  const { t } = useLang();
  const [draft, setDraft] = React.useState<RemarkDraft>({
    ratings: existing?.ratings ?? {},
    comment: existing?.comment ?? '',
  });
  // Every rating is required: a report with a blank row reads as an oversight, not a judgement.
  // With no criteria configured there is nothing to save — the empty state below explains why.
  const complete = criteria.length > 0 && criteria.every((c) => (draft.ratings[c.id] ?? 0) >= 1);

  return (
    <Card className={className} style={{ padding: 18 }}>
      <div className="m-spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('remark_title')}</h2>
        {existing && (
          <div className="m-row" style={{ gap: 8 }}>
            <a className="m-textlink" href={printHref} target="_blank" rel="noreferrer">
              {t('remark_print')}
            </a>
            <IconButton label={t('delete')} onClick={onDelete}>
              <MIcon name="trash" size={16} />
            </IconButton>
          </div>
        )}
      </div>

      {/* The criteria rows are the one part that grows with configuration, so in the split
          layout they are what scrolls — the comment box and Save stay put. */}
      <div className="m-stack assess-remark__body" style={{ gap: 8 }}>
        {criteria.length ? (
          criteria.map((c) => (
            <div key={c.id} className="m-spread">
              <span>{c.name}</span>
              <RatingStars
                value={draft.ratings[c.id] ?? 0}
                onChange={(v) => setDraft({ ...draft, ratings: { ...draft.ratings, [c.id]: v } })}
              />
            </div>
          ))
        ) : (
          <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {t('remark_no_criteria')}
          </p>
        )}
      </div>

      <div className="mochi-field" style={{ marginTop: 14 }}>
        <label className="mochi-field__label">{t('remark_comment')}</label>
        <textarea
          className="mochi-input"
          rows={4}
          style={{ resize: 'vertical', minHeight: 92, paddingTop: 10 }}
          value={draft.comment}
          placeholder={t('remark_comment_ph')}
          onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
        />
      </div>

      <div className="m-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <Button variant="primary" disabled={!complete} onClick={() => onSave(draft)}>
          {t('remark_save')}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The month's vocabulary-garden progress, on the monthly report.
 *
 * Fetched per (student, month) rather than carried in the route loader: both of those are client
 * state on this screen, so folding them into the SWR-cached loader would mean loading every
 * student's every month to show one pair. `useFetcher().load` re-runs whenever the pair changes.
 *
 * While a fetch is in flight the previous numbers stay on screen — swapping to a spinner on every
 * student change made the rail flicker on each arrow-key press through the student dropdown.
 */
function GardenMonthCard({ studentId, month }: { studentId: string; month: string }) {
  const { t } = useLang();
  const fetcher = useFetcher<{ data?: GardenMonthSummary; error?: string }>();

  // One load per pair. `fetcher.load` is stable, and the key guard means a re-render caused by
  // anything else (a remark save re-rendering the screen) does not refetch.
  const key = `${studentId}:${month}`;
  const loaded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!studentId || loaded.current === key) return;
    loaded.current = key;
    // `/garden-month`, not `/api/garden/month/:id`: everything under /api/* is bearer-only, so
    // from a browser (cookie, no Authorization header) it 401s and the card silently vanishes.
    fetcher.load(`/garden-month?student=${encodeURIComponent(studentId)}&month=${month}`);
  }, [key, studentId, month, fetcher]);

  const g = fetcher.data?.data;
  // The garden degrades to null for the first minutes after a deploy, the same as on /vocabulary.
  // A report is still a report without it, so the card simply isn't there.
  if (fetcher.data?.error) return null;

  const plant = g?.plant ?? null;

  return (
    <Card className="assess-report__garden" style={{ padding: 14 }}>
      <div className="m-spread" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-base)' }}>
          <span className="m-row" style={{ gap: 8, alignItems: 'center' }}>
            <MIcon name="sprout" size={18} />
            {t('remark_garden_title')}
          </span>
        </h2>
        {plant && (
          <span className="m-row" style={{ gap: 8, alignItems: 'center' }}>
            <PlantSvg
              stage={Math.max(0, Math.min(MAX_STAGE, plant.stage)) as PlantStage}
              wilted={plant.wilted}
              dead={plant.dead}
              potColor={g!.potColor}
              species={g!.species}
              size={44}
            />
            <span style={{ fontSize: 'var(--text-sm)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('remark_garden_now')}: </span>
              <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
                {t(stageKey(plant.stage, plant.dead))}
              </span>
            </span>
          </span>
        )}
      </div>

      {/* Six numbers, so a 3-up grid — the same tile vocabulary as the stats card above it. */}
      <div className="m-grid cols-3">
        <Stat num={g?.activeDays ?? '—'} label={t('remark_garden_active_days')} color="green" />
        <Stat num={g?.playDays ?? '—'} label={t('remark_garden_plays')} color="blue" />
        <Stat num={g?.stagesGained ?? '—'} label={t('remark_garden_stages')} color="violet" />
        <Stat num={g?.fruits ?? '—'} label={t('remark_garden_fruit')} color="orange" />
        <Stat num={g?.fruitsTotal ?? '—'} label={t('garden_fruit_total_short')} color="brand" />
        <Stat num={g?.setbacks ?? '—'} label={t('remark_garden_setbacks')} color="rose" />
      </div>

      {g && !plant && (
        <p className="m-muted" style={{ margin: '12px 0 0', fontSize: 'var(--text-sm)' }}>
          {t('remark_garden_never')}
        </p>
      )}
      {plant && plant.streak > 0 && (
        <div
          className="m-row"
          style={{ gap: 6, alignItems: 'center', marginTop: 12, color: 'var(--text-body)' }}
        >
          <MIcon name="flame" size={16} />
          {t('garden_streak', { n: plant.streak })}
        </div>
      )}
    </Card>
  );
}

/**
 * Attendance and vocabulary homework for the shown (student, month) — the same fetch discipline
 * as GardenMonthCard above (one load per pair; the previous numbers stay on screen while a fetch
 * is in flight), against the cookie-authed /report-extras twin. Chips and rows rather than stat
 * tiles: the rail is 380px, and these are rosters, not headline numbers.
 */
function ReportExtrasCards({ studentId, month }: { studentId: string; month: string }) {
  const { t } = useLang();
  const fetcher = useFetcher<{
    data?: {
      attendance: ClassAttendanceSummary[];
      homework: StudentMonthAssignment[];
      tuiMu: TuiMuMonthTally | null;
    };
    error?: string;
  }>();

  const key = `${studentId}:${month}`;
  const loaded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!studentId || loaded.current === key) return;
    loaded.current = key;
    fetcher.load(`/report-extras?student=${encodeURIComponent(studentId)}&month=${month}`);
  }, [key, studentId, month, fetcher]);

  const d = fetcher.data?.data;
  if (fetcher.data?.error || !d) return null;

  return (
    <>
      <Card style={{ padding: 14 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 'var(--text-base)' }}>
          {t('remark_attendance_title')}
        </h2>
        {d.attendance.length ? (
          <div className="m-stack" style={{ gap: 8 }}>
            {d.attendance.map((a) => (
              <div key={a.classId} className="m-spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{a.className}</span>
                <span className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {ATTENDANCE_STATUSES.filter((s) => (a.counts[s] ?? 0) > 0).map((s) => {
                    const c = colorOf(ATTENDANCE_META[s].color);
                    return (
                      <span
                        key={s}
                        className="mchip"
                        style={{ background: c.soft, color: c.ink, fontWeight: 700 }}
                      >
                        {t(ATTENDANCE_META[s].tk)} · {a.counts[s]}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {t('remark_attendance_none')}
          </p>
        )}
      </Card>

      <Card style={{ padding: 14 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 'var(--text-base)' }}>
          {t('remark_homework_title')}
        </h2>
        {d.homework.length ? (
          <div className="m-stack" style={{ gap: 8 }}>
            {d.homework.map((h) => (
              <div key={h.id} className="m-spread" style={{ gap: 8 }}>
                <span style={{ fontSize: 'var(--text-sm)', minWidth: 0 }}>
                  {h.topicName} · {h.className}
                </span>
                <Badge color={h.completed ? 'green' : 'rose'}>
                  {h.done}/{h.requiredCount}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {t('remark_homework_none')}
          </p>
        )}
      </Card>

      {d.tuiMu && (
        <Card style={{ padding: 14 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 'var(--text-base)' }}>{t('rep_tm_title')}</h2>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {t('rep_tm_line', { bags: d.tuiMu.bags, misses: d.tuiMu.misses })}
          </p>
        </Card>
      )}
    </>
  );
}

function TypeBadge({ type, label }: { type: BehaviorTypeId; label: string }) {
  const c = colorOf(BEHAVIOR_META[type].color);
  return (
    <span className="mchip" style={{ background: c.soft, color: c.ink, fontWeight: 700 }}>
      {label}
    </span>
  );
}

/**
 * Who has this month's report and who does not — the coverage column on the report tab.
 * Pure client derivation: the loader already carries every remark and every student, so
 * written/sent needs no extra fetch. Clicking a row drives the same `studentId` state as the
 * Student dropdown; the two controls stay in agreement because they share it.
 */
function ReportRoster({
  students,
  remarkByStudent,
  activeStudentId,
  onSelect,
}: {
  students: StudentRow[];
  remarkByStudent: Map<string, RemarkRow>;
  activeStudentId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useLang();
  const written = students.filter((s) => remarkByStudent.has(s.id)).length;
  const pct = students.length ? Math.round((written / students.length) * 100) : 0;
  return (
    <Card className="assess-report__roster" style={{ padding: 14 }}>
      <div className="m-spread" style={{ marginBottom: 8, gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-base)' }}>{t('remark_roster_title')}</h2>
        <span className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
          {t('remark_coverage', { n: written, total: students.length })}
        </span>
      </div>
      <ProgressBar value={pct} color="green" />
      <div className="assess-report__roster-list">
        {students.map((s) => {
          const r = remarkByStudent.get(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`assess-report__roster-row${s.id === activeStudentId ? ' is-active' : ''}`}
              aria-pressed={s.id === activeStudentId}
              onClick={() => onSelect(s.id)}
            >
              <Avatar name={s.name} color={s.color} size="sm" />
              <span className="assess-report__roster-name">{s.name}</span>
              {r?.sentAt ? (
                <Badge color="blue">{t('remark_status_sent')}</Badge>
              ) : r ? (
                <Badge color="green">{t('remark_status_written')}</Badge>
              ) : (
                <Badge>{t('remark_status_missing')}</Badge>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function AssessmentsScreen() {
  const { scores, behavior, remarks, students, classes, types, criteria } =
    useLoaderData() as AssessLoaderData;
  const fetcher = useFetcher();
  const { t, lang } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [classFilter, setClassFilter] = React.useState('all');
  const [studentId, setStudentId] = React.useState<string>(students[0]?.id ?? '');
  const [tab, setTab] = React.useState<'scores' | 'behavior' | 'report'>('scores');
  // null = all time. The month dropdown is the only month control on the screen; the report tab,
  // which must name a concrete month, falls back to the current one while the filter is off.
  const [monthFilter, setMonthFilter] = React.useState<string | null>(null);
  const [scoreModal, setScoreModal] = React.useState<ScoreDraft | null>(null);
  const [behaviorModal, setBehaviorModal] = React.useState<BehaviorDraft | null>(null);
  const today = iso(TODAY);
  const currentMonth = today.slice(0, 7);
  const reportMonth = monthFilter ?? currentMonth;

  const visibleStudents =
    classFilter === 'all' ? students : students.filter((s) => s.classIds.includes(classFilter));
  const activeStudentId = visibleStudents.some((s) => s.id === studentId)
    ? studentId
    : (visibleStudents[0]?.id ?? '');

  if (!students.length) {
    return (
      <div className="content">
        <PageHeader title={t('assess_title')} subtitle={t('assess_sub')} />
        <Card>
          <Empty icon="users" title={t('assess_no_students')} sub={t('assess_no_students_sub')} />
        </Card>
      </div>
    );
  }

  const inMonth = (date: string) => !monthFilter || date.startsWith(monthFilter);
  const studentScores = scores.filter(
    (r) =>
      r.studentId === activeStudentId &&
      (classFilter === 'all' || r.classId === classFilter) &&
      inMonth(r.date),
  );
  const studentBehavior = behavior.filter(
    (r) =>
      r.studentId === activeStudentId &&
      (classFilter === 'all' || r.classId === classFilter) &&
      inMonth(r.date),
  );

  const stats = scoreStats(studentScores);
  // A picked month re-windows the chart to that month's weeks; otherwise it is the trailing 12.
  const buckets = monthFilter
    ? bucketBehaviorByWeekInMonth(studentBehavior, monthFilter)
    : bucketBehaviorByWeek(studentBehavior, INCIDENT_WEEKS, today);
  const windowStart = buckets[0]?.key;
  const inWindow = (r: BehaviorRow) => !windowStart || r.date >= windowStart;
  const typeCounts: Record<string, number> = {};
  for (const b of buckets) {
    for (const ty of NEGATIVE_TYPES) typeCounts[ty] = (typeCounts[ty] || 0) + (b.counts[ty] || 0);
  }
  const praiseCount = studentBehavior.filter((r) => r.type === 'praise' && inWindow(r)).length;

  const classById = (id: string | null) => classes.find((c) => c.id === id);
  const typeById = (id: string | null) => types.find((tp) => tp.id === id);
  // An active class filter IS an explicit choice, so honour it. With no filter, default to no
  // class rather than the student's first one — `ScoreRecordInput.classId` and
  // `BehaviorRecordInput.classId` are both .nullish(), and guessing files the record against a
  // class nobody picked.
  const defaultClassId = () => (classFilter === 'all' ? '' : classFilter);

  const fmtShort = (d: string) =>
    new Date(d).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short' });
  const fmtWeek = (d: string) =>
    new Date(d).toLocaleDateString(locale(lang), { day: 'numeric', month: 'numeric' });

  const openNewScore = () =>
    setScoreModal({
      studentId: activeStudentId,
      date: today,
      score: '',
      classId: defaultClassId(),
      assessmentTypeId: '',
      notes: '',
    });

  const openNewBehavior = () =>
    setBehaviorModal({
      studentId: activeStudentId,
      date: today,
      type: 'late',
      classId: defaultClassId(),
      notes: '',
    });

  const saveScore = (f: ScoreDraft) => {
    const fd = new FormData();
    fd.set('intent', f.id ? 'update-score' : 'create-score');
    if (f.id) fd.set('id', f.id);
    fd.set('studentId', f.studentId);
    fd.set('date', f.date);
    fd.set('score', String(f.score));
    if (f.classId) fd.set('classId', f.classId);
    fd.set('assessmentTypeId', f.assessmentTypeId);
    if (f.notes) fd.set('notes', f.notes);
    fetcher.submit(fd, { action: '/assessments', method: 'post' });
    setScoreModal(null);
  };

  const saveBehavior = (f: BehaviorDraft) => {
    const fd = new FormData();
    fd.set('intent', f.id ? 'update-behavior' : 'create-behavior');
    if (f.id) fd.set('id', f.id);
    fd.set('studentId', f.studentId);
    fd.set('date', f.date);
    fd.set('type', f.type);
    if (f.classId) fd.set('classId', f.classId);
    if (f.notes) fd.set('notes', f.notes);
    fetcher.submit(fd, { action: '/assessments', method: 'post' });
    setBehaviorModal(null);
  };

  const removeScoreRec = async (id: string) => {
    const ok = await confirm({ title: t('delete'), message: t('delete') + '?', danger: true });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-score');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/assessments', method: 'post' });
  };

  const removeBehaviorRec = async (id: string) => {
    const ok = await confirm({ title: t('delete'), message: t('delete') + '?', danger: true });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-behavior');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/assessments', method: 'post' });
  };

  // The report covers the whole student for the month — the class filter narrows the record tabs,
  // but a monthly report that silently omitted one of the student's classes would be a lie.
  const reportScores = scores.filter(
    (r) => r.studentId === activeStudentId && r.date.startsWith(reportMonth),
  );
  const reportBehavior = behavior.filter(
    (r) => r.studentId === activeStudentId && r.date.startsWith(reportMonth),
  );
  const reportStats = scoreStats(reportScores);
  const reportIncidents: Record<string, number> = {};
  for (const ty of NEGATIVE_TYPES) {
    const n = reportBehavior.filter((r) => r.type === ty).length;
    if (n > 0) reportIncidents[ty] = n;
  }
  const reportIncidentTotal = Object.values(reportIncidents).reduce((a, b) => a + b, 0);
  const reportPraise = reportBehavior.filter((r) => r.type === 'praise').length;
  // One report per (student, month): this map is both the roster's coverage source and the
  // form's "existing" lookup, so the two can never disagree.
  const reportRemarks = React.useMemo(
    () => new Map(remarks.filter((r) => r.month === reportMonth).map((r) => [r.studentId, r])),
    [remarks, reportMonth],
  );
  const existingRemark = reportRemarks.get(activeStudentId);

  const saveRemark = (d: RemarkDraft) => {
    const fd = new FormData();
    fd.set('intent', existingRemark ? 'update-remark' : 'create-remark');
    if (existingRemark) fd.set('id', existingRemark.id);
    fd.set('studentId', activeStudentId);
    fd.set('month', reportMonth);
    fd.set('ratings', JSON.stringify(d.ratings));
    if (d.comment.trim()) fd.set('comment', d.comment.trim());
    fetcher.submit(fd, { action: '/assessments', method: 'post' });
  };

  const removeRemarkRec = async () => {
    if (!existingRemark) return;
    const ok = await confirm({ title: t('delete'), message: t('delete') + '?', danger: true });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-remark');
    fd.set('id', existingRemark.id);
    fetcher.submit(fd, { action: '/assessments', method: 'post' });
  };

  /**
   * Months the dropdown offers: every month anything was recorded in, plus the current one (you
   * can always write this month's report) and whatever is selected. Built from ALL records, not
   * the active student's, so switching student never blanks the picker.
   */
  const monthOptions = React.useMemo(() => {
    const set = new Set<string>([currentMonth]);
    for (const r of scores) set.add(r.date.slice(0, 7));
    for (const r of behavior) set.add(r.date.slice(0, 7));
    if (monthFilter) set.add(monthFilter);
    // Newest first: 'YYYY-MM' sorts lexicographically, so a descending compare is the whole job.
    return [...set]
      .sort((a, b) => b.localeCompare(a))
      .map((m) => ({ value: m, label: monthLabel(m, lang) }));
  }, [scores, behavior, currentMonth, monthFilter, lang]);

  const incidentsChartTitle = monthFilter
    ? t('assess_incidents_chart_month', { month: monthLabel(monthFilter, lang) })
    : t('assess_incidents_chart', { n: INCIDENT_WEEKS });

  return (
    /* Scores and report are fixed-height splits — chart beside test list, month stats beside
       the remark form — so neither needs the page to scroll. Behavior keeps the page scroll. */
    <div className={tab === 'behavior' ? 'content' : 'content content--fill'}>
      <PageHeader
        title={t('assess_title')}
        subtitle={t('assess_sub')}
        actions={
          tab === 'report' ? undefined : (
            <Button
              variant="primary"
              iconLeft={<MIcon name="plus" size={18} />}
              onClick={tab === 'scores' ? openNewScore : openNewBehavior}
            >
              {tab === 'scores' ? t('assess_add_score') : t('assess_add_behavior')}
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={(id) => setTab(id as 'scores' | 'behavior' | 'report')}
        tabs={[
          { id: 'scores', label: t('assess_tab_scores') },
          { id: 'behavior', label: t('assess_tab_behavior') },
          { id: 'report', label: t('assess_tab_report') },
        ]}
      />
      {/* One row, not three stacked ones: the filters are a header for the data below, and every
          extra row here comes straight out of the chart and list on the scores tab. */}
      <Card style={{ padding: 14 }}>
        <div className="assess-filters">
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
            label={t('assess_student')}
            value={activeStudentId}
            onChange={setStudentId}
            options={visibleStudents.map((s) => ({ value: s.id, label: s.name }))}
          />
          {/* The month picker and its reset are two separate controls: the dropdown only ever
              names a real month, and "All time" is the one button that clears the filter. */}
          <MSelect
            label={t('assess_month')}
            value={monthFilter ?? ''}
            // '' is the no-month-picked slot, shown as a dash so the field is never a blank
            // box. It must normalise back to null — `'' ?? currentMonth` is `''`, which would
            // leave the report tab with no month at all.
            onChange={(v) => setMonthFilter(v || null)}
            options={[{ value: '', label: '—' }, ...monthOptions]}
          />
          <Button
            variant={monthFilter ? 'secondary' : 'primary'}
            disabled={!monthFilter}
            iconLeft={<MIcon name="x" size={16} />}
            onClick={() => setMonthFilter(null)}
          >
            {t('month_all')}
          </Button>
        </div>
      </Card>

      {tab === 'scores' ? (
        <div className="assess-split">
          <Card className="assess-split__chart" style={{ padding: 18 }}>
            <div className="m-spread" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>
                {t('assess_progress_chart')}
              </h2>
              <div className="m-row" style={{ gap: 10 }}>
                <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {t('assess_avg')}
                </span>
                <ScoreBadge score={stats.average} />
                <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {t('assess_latest')}
                </span>
                <ScoreBadge score={stats.latest} />
              </div>
            </div>
            <ProgressLineChart
              points={studentScores.map((r) => ({
                x: r.date,
                y: r.score,
                label: typeById(r.assessmentTypeId)?.name,
              }))}
              colorFor={(y) => colorOf(scoreColorId(y)).base}
              formatX={fmtShort}
              // Sized to the card, not to an aspect ratio — otherwise a wide window makes the
              // chart tall enough to burst out of the card and eat the page's bottom gutter.
              fit
              height={240}
              ariaLabel={t('assess_progress_chart')}
              emptyLabel={t('assess_no_scores')}
            />
          </Card>
          <div className="m-stack assess-split__list">
            {studentScores.length ? (
              studentScores.toReversed().map((r) => (
                <div key={r.id} className="lrow">
                  <div style={{ flex: 1 }}>
                    <div className="m-row" style={{ gap: 8 }}>
                      <ScoreBadge score={r.score} />
                      {r.assessmentTypeId && (
                        <div className="lrow__title">
                          {typeById(r.assessmentTypeId)?.name ?? '—'}
                        </div>
                      )}
                      {r.classId && (
                        <span
                          className="mchip"
                          style={{ background: 'var(--cream-200)', color: 'var(--text-body)' }}
                        >
                          {classById(r.classId)?.name ?? '—'}
                        </span>
                      )}
                    </div>
                    <div className="lrow__meta">
                      <span className="m-row" style={{ gap: 5 }}>
                        <MIcon name="clock" size={14} />
                        {fmtShort(r.date)}
                      </span>
                    </div>
                    {r.notes && (
                      <div
                        className="m-muted"
                        style={{ fontSize: 'var(--text-sm)', marginTop: 6 } as React.CSSProperties}
                      >
                        {r.notes}
                      </div>
                    )}
                  </div>
                  <div className="lrow__actions">
                    <IconButton
                      label={t('edit')}
                      size="sm"
                      onClick={() =>
                        setScoreModal({
                          id: r.id,
                          studentId: r.studentId,
                          date: r.date,
                          score: r.score,
                          classId: r.classId ?? '',
                          assessmentTypeId: r.assessmentTypeId ?? '',
                          notes: r.notes ?? '',
                        })
                      }
                    >
                      <MIcon name="edit" size={16} />
                    </IconButton>
                    <IconButton label={t('delete')} size="sm" onClick={() => removeScoreRec(r.id)}>
                      <MIcon name="trash" size={16} />
                    </IconButton>
                  </div>
                </div>
              ))
            ) : (
              <Card>
                <Empty icon="chart" title={t('assess_no_scores')} sub={t('assess_no_scores_sub')} />
              </Card>
            )}
          </div>
        </div>
      ) : tab === 'behavior' ? (
        <>
          <div className="m-grid cols-4">
            <Stat
              num={typeCounts.late || 0}
              label={t(BEHAVIOR_META.late.tk)}
              color={BEHAVIOR_META.late.color}
            />
            <Stat
              num={typeCounts.absent || 0}
              label={t(BEHAVIOR_META.absent.tk)}
              color={BEHAVIOR_META.absent.color}
            />
            <Stat
              num={typeCounts.missing_homework || 0}
              label={t(BEHAVIOR_META.missing_homework.tk)}
              color={BEHAVIOR_META.missing_homework.color}
            />
            <Stat num={praiseCount} label={t('assess_praise_count')} color="green" />
          </div>
          <Card style={{ padding: 18 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-xl)' }}>
              {incidentsChartTitle}
            </h2>
            <StackedBarChart
              ariaLabel={incidentsChartTitle}
              buckets={buckets.map((b) => ({
                key: b.key,
                label: fmtWeek(b.key),
                segments: NEGATIVE_TYPES.map((ty) => ({
                  type: ty,
                  count: b.counts[ty] || 0,
                  color: colorOf(BEHAVIOR_META[ty].color).base,
                  title: t(BEHAVIOR_META[ty].tk),
                })),
              }))}
            />
            <div className="m-row" style={{ gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
              {NEGATIVE_TYPES.map((ty) => (
                <span key={ty} className="m-row" style={{ gap: 6, fontSize: 'var(--text-xs)' }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: colorOf(BEHAVIOR_META[ty].color).base,
                      display: 'inline-block',
                    }}
                  />
                  {t(BEHAVIOR_META[ty].tk)}
                </span>
              ))}
            </div>
          </Card>
          <div className="m-stack">
            {studentBehavior.length ? (
              studentBehavior.toReversed().map((r) => (
                <div key={r.id} className="lrow">
                  <div style={{ flex: 1 }}>
                    <div className="m-row" style={{ gap: 8 }}>
                      <TypeBadge
                        type={r.type as BehaviorTypeId}
                        label={t(BEHAVIOR_META[r.type as BehaviorTypeId]?.tk ?? 'bh_other')}
                      />
                      {r.classId && (
                        <span
                          className="mchip"
                          style={{ background: 'var(--cream-200)', color: 'var(--text-body)' }}
                        >
                          {classById(r.classId)?.name ?? '—'}
                        </span>
                      )}
                    </div>
                    <div className="lrow__meta">
                      <span className="m-row" style={{ gap: 5 }}>
                        <MIcon name="clock" size={14} />
                        {fmtShort(r.date)}
                      </span>
                    </div>
                    {r.notes && (
                      <div
                        className="m-muted"
                        style={{ fontSize: 'var(--text-sm)', marginTop: 6 } as React.CSSProperties}
                      >
                        {r.notes}
                      </div>
                    )}
                  </div>
                  <div className="lrow__actions">
                    <IconButton
                      label={t('edit')}
                      size="sm"
                      onClick={() =>
                        setBehaviorModal({
                          id: r.id,
                          studentId: r.studentId,
                          date: r.date,
                          type: r.type as BehaviorTypeId,
                          classId: r.classId ?? '',
                          notes: r.notes ?? '',
                        })
                      }
                    >
                      <MIcon name="edit" size={16} />
                    </IconButton>
                    <IconButton
                      label={t('delete')}
                      size="sm"
                      onClick={() => removeBehaviorRec(r.id)}
                    >
                      <MIcon name="trash" size={16} />
                    </IconButton>
                  </div>
                </div>
              ))
            ) : (
              <Card>
                <Empty
                  icon="flag"
                  title={t('assess_no_behavior')}
                  sub={t('assess_no_behavior_sub')}
                />
              </Card>
            )}
          </div>
        </>
      ) : (
        /* Roster, form, summary — the same shape as the scores tab (working area centre, fixed
           rail right) with the coverage column added on the left. Source order follows the
           visual order so focus does too, which also means the narrow layout stacks in that
           order. */
        <div className="assess-report">
          <ReportRoster
            students={visibleStudents}
            remarkByStudent={reportRemarks}
            activeStudentId={activeStudentId}
            onSelect={setStudentId}
          />
          <RemarkForm
            key={`${activeStudentId}:${reportMonth}`}
            className="assess-report__form"
            criteria={criteria.filter((c) => c.active)}
            existing={existingRemark}
            printHref={`/assessments/${reportMonth}/${activeStudentId}/report`}
            onSave={saveRemark}
            onDelete={() => void removeRemarkRec()}
          />
          {/* Four cards, so the rail is a scrolling column: each block keeps its natural height
              and the next one follows it, rather than all of them fighting over the row's
              height. */}
          <div className="assess-report__rail">
            <Card className="assess-report__stats" style={{ padding: 14 }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 'var(--text-base)' }}>
                {t('remark_stats_title')} · {monthLabel(reportMonth, lang)}
              </h2>
              <div className="m-grid cols-4">
                <Stat
                  num={reportStats.average ?? '—'}
                  label={t('assess_avg')}
                  color={reportStats.average == null ? 'blue' : scoreColorId(reportStats.average)}
                />
                <Stat num={reportScores.length} label={t('remark_stat_tests')} color="violet" />
                <Stat num={reportIncidentTotal} label={t('remark_stat_incidents')} color="rose" />
                <Stat num={reportPraise} label={t('assess_praise_count')} color="green" />
              </div>
              {reportIncidentTotal > 0 && (
                <div className="m-row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                  {Object.entries(reportIncidents).map(([ty, n]) => (
                    <TypeBadge
                      key={ty}
                      type={ty as BehaviorTypeId}
                      label={`${t(BEHAVIOR_META[ty as BehaviorTypeId].tk)} · ${n}`}
                    />
                  ))}
                </div>
              )}
            </Card>
            <GardenMonthCard studentId={activeStudentId} month={reportMonth} />
            <ReportExtrasCards studentId={activeStudentId} month={reportMonth} />
          </div>
        </div>
      )}

      {scoreModal && (
        <Modal
          open
          onClose={() => setScoreModal(null)}
          title={scoreModal.id ? t('assess_edit_score') : t('assess_new_score')}
          width={480}
          footer={
            <>
              <Button variant="secondary" onClick={() => setScoreModal(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={scoreModal.score === ''}
                onClick={() => saveScore(scoreModal)}
              >
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <MDatePicker
              label={t('assess_date')}
              value={scoreModal.date}
              onChange={(v) => setScoreModal((m) => (m ? { ...m, date: v } : m))}
            />
            <div className="mochi-field">
              <label className="mochi-field__label">{t('assess_score')}</label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                className="mochi-input"
                value={scoreModal.score}
                onChange={(e) =>
                  setScoreModal((m) =>
                    m ? { ...m, score: e.target.value === '' ? '' : Number(e.target.value) } : m,
                  )
                }
              />
            </div>
          </div>
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <MSelect
              label={t('class')}
              value={scoreModal.classId}
              onChange={(v) => setScoreModal((m) => (m ? { ...m, classId: v } : m))}
              options={[
                { value: '', label: t('assess_no_class') },
                ...classes.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <MSelect
              label={t('assess_score_label')}
              value={scoreModal.assessmentTypeId}
              onChange={(v) => setScoreModal((m) => (m ? { ...m, assessmentTypeId: v } : m))}
              options={[
                { value: '', label: t('assess_type_none') },
                ...types
                  .filter((tp) => tp.active || tp.id === scoreModal.assessmentTypeId)
                  .map((tp) => ({ value: tp.id, label: tp.name })),
              ]}
            />
          </div>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('assess_notes')}</label>
            <textarea
              className="mochi-input"
              rows={3}
              style={{ resize: 'vertical', minHeight: 72, paddingTop: 10 }}
              placeholder={t('assess_notes_ph')}
              value={scoreModal.notes}
              onChange={(e) => setScoreModal((m) => (m ? { ...m, notes: e.target.value } : m))}
            />
          </div>
        </Modal>
      )}

      {behaviorModal && (
        <Modal
          open
          onClose={() => setBehaviorModal(null)}
          title={behaviorModal.id ? t('assess_edit_behavior') : t('assess_new_behavior')}
          width={480}
          footer={
            <>
              <Button variant="secondary" onClick={() => setBehaviorModal(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={() => saveBehavior(behaviorModal)}>
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <MDatePicker
              label={t('assess_date')}
              value={behaviorModal.date}
              onChange={(v) => setBehaviorModal((m) => (m ? { ...m, date: v } : m))}
            />
            <MSelect
              label={t('assess_type')}
              value={behaviorModal.type}
              onChange={(v) =>
                setBehaviorModal((m) => (m ? { ...m, type: v as BehaviorTypeId } : m))
              }
              options={BEHAVIOR_TYPES.map((ty) => ({ value: ty, label: t(BEHAVIOR_META[ty].tk) }))}
            />
          </div>
          <MSelect
            label={t('class')}
            value={behaviorModal.classId}
            onChange={(v) => setBehaviorModal((m) => (m ? { ...m, classId: v } : m))}
            options={[
              { value: '', label: t('assess_no_class') },
              ...classes.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <div className="mochi-field">
            <label className="mochi-field__label">{t('assess_notes')}</label>
            <textarea
              className="mochi-input"
              rows={3}
              style={{ resize: 'vertical', minHeight: 72, paddingTop: 10 }}
              placeholder={t('assess_notes_ph')}
              value={behaviorModal.notes}
              onChange={(e) => setBehaviorModal((m) => (m ? { ...m, notes: e.target.value } : m))}
            />
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  );
}

export { AssessmentsScreen };
