import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, Modal, MSelect, MDatePicker, useConfirm } from './ui.jsx';
import { colorOf, iso, TODAY } from './lib/core.js';
import { useLang, locale } from './lib/i18n.jsx';
import { ProgressLineChart, StackedBarChart } from './components/charts.jsx';
import {
  BEHAVIOR_META,
  BEHAVIOR_TYPES,
  NEGATIVE_TYPES,
  bucketBehaviorByWeek,
  scoreStats,
  type BehaviorTypeId,
} from './lib/assess.js';
import type { ScoreRow, BehaviorRow } from '../server/services/assessments.js';
import type { StudentRow } from '../server/services/people.js';
import type { ClassLite } from '../server/services/classes.js';

const { Card, Button, IconButton, Tabs } = DS;

const INCIDENT_WEEKS = 12;

interface AssessLoaderData {
  scores: ScoreRow[];
  behavior: BehaviorRow[];
  students: StudentRow[];
  classes: ClassLite[];
}

type ScoreDraft = {
  id?: string;
  studentId: string;
  date: string;
  score: number | '';
  classId: string;
  label: string;
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

function ScoreBadge({ score }: { score: number }) {
  const colorId = score >= 8 ? 'green' : score >= 6.5 ? 'blue' : score >= 5 ? 'orange' : 'rose';
  const c = colorOf(colorId);
  return (
    <span className="mchip" style={{ background: c.soft, color: c.ink, fontWeight: 700 }}>
      {score}
    </span>
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

function AssessmentsScreen() {
  const { scores, behavior, students, classes } = useLoaderData() as AssessLoaderData;
  const fetcher = useFetcher();
  const { t, lang } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [classFilter, setClassFilter] = React.useState('all');
  const [studentId, setStudentId] = React.useState<string>(students[0]?.id ?? '');
  const [tab, setTab] = React.useState<'scores' | 'behavior'>('scores');
  const [scoreModal, setScoreModal] = React.useState<ScoreDraft | null>(null);
  const [behaviorModal, setBehaviorModal] = React.useState<BehaviorDraft | null>(null);
  const today = iso(TODAY);

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

  const studentScores = scores.filter(
    (r) => r.studentId === activeStudentId && (classFilter === 'all' || r.classId === classFilter),
  );
  const studentBehavior = behavior.filter(
    (r) => r.studentId === activeStudentId && (classFilter === 'all' || r.classId === classFilter),
  );

  const stats = scoreStats(studentScores);
  const buckets = bucketBehaviorByWeek(studentBehavior, INCIDENT_WEEKS, today);
  const windowStart = buckets[0]?.key;
  const inWindow = (r: BehaviorRow) => !windowStart || r.date >= windowStart;
  const typeCounts: Record<string, number> = {};
  for (const b of buckets) {
    for (const ty of NEGATIVE_TYPES) typeCounts[ty] = (typeCounts[ty] || 0) + (b.counts[ty] || 0);
  }
  const praiseCount = studentBehavior.filter((r) => r.type === 'praise' && inWindow(r)).length;

  const classById = (id: string | null) => classes.find((c) => c.id === id);
  const defaultClassId = () => {
    if (classFilter !== 'all') return classFilter;
    const st = students.find((s) => s.id === activeStudentId);
    return st?.classIds[0] ?? '';
  };

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
      label: '',
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
    if (f.label) fd.set('label', f.label);
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

  return (
    <div className="content">
      <PageHeader
        title={t('assess_title')}
        subtitle={t('assess_sub')}
        actions={
          <Button
            variant="primary"
            iconLeft={<MIcon name="plus" size={18} />}
            onClick={tab === 'scores' ? openNewScore : openNewBehavior}
          >
            {tab === 'scores' ? t('assess_add_score') : t('assess_add_behavior')}
          </Button>
        }
      />
      <Card style={{ padding: 18 }}>
        <div className="m-grid cols-2" style={{ gap: 14 }}>
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
        </div>
      </Card>
      <Tabs
        value={tab}
        onChange={(id) => setTab(id as 'scores' | 'behavior')}
        tabs={[
          { id: 'scores', label: t('assess_tab_scores') },
          { id: 'behavior', label: t('assess_tab_behavior') },
        ]}
      />

      {tab === 'scores' ? (
        <>
          <div className="m-grid cols-3">
            <Stat num={stats.average ?? '—'} label={t('assess_avg')} color="blue" />
            <Stat num={stats.latest ?? '—'} label={t('assess_latest')} color="green" />
            <Stat
              num={
                stats.delta == null ? (
                  '—'
                ) : (
                  <span style={{ color: stats.delta >= 0 ? 'var(--cat-green)' : 'var(--danger)' }}>
                    {stats.delta > 0 ? '▲ +' : stats.delta < 0 ? '▼ ' : ''}
                    {stats.delta}
                  </span>
                )
              }
              label={t('assess_trend')}
              color="orange"
            />
          </div>
          <Card style={{ padding: 18 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-xl)' }}>
              {t('assess_progress_chart')}
            </h2>
            <ProgressLineChart
              points={studentScores.map((r) => ({
                x: r.date,
                y: r.score,
                label: r.label ?? undefined,
              }))}
              formatX={fmtShort}
              ariaLabel={t('assess_progress_chart')}
              emptyLabel={t('assess_no_scores')}
            />
          </Card>
          <div className="m-stack">
            {studentScores.length ? (
              studentScores.toReversed().map((r) => (
                <div key={r.id} className="lrow">
                  <div style={{ flex: 1 }}>
                    <div className="m-row" style={{ gap: 8 }}>
                      <ScoreBadge score={r.score} />
                      {r.label && <div className="lrow__title">{r.label}</div>}
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
                          label: r.label ?? '',
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
        </>
      ) : (
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
              {t('assess_incidents_chart', { n: INCIDENT_WEEKS })}
            </h2>
            <StackedBarChart
              ariaLabel={t('assess_incidents_chart', { n: INCIDENT_WEEKS })}
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
            <div className="mochi-field">
              <label className="mochi-field__label">{t('assess_score_label')}</label>
              <input
                className="mochi-input"
                placeholder={t('assess_score_label_ph')}
                value={scoreModal.label}
                onChange={(e) => setScoreModal((m) => (m ? { ...m, label: e.target.value } : m))}
              />
            </div>
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
