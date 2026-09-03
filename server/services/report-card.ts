import type { TenantDb } from '../db/index';
import * as assessSvc from './assessments';
import * as criteriaSvc from './remark-criteria';
import * as peopleSvc from './people';
import * as classesSvc from './classes';
import * as gardenSvc from './garden';
import * as attendanceSvc from './attendance';
import * as subjectsSvc from './subjects';
import * as checkinSvc from './checkin';
import * as practiceSvc from './practice';
import { NEGATIVE_TYPES, scoreStats, scoreStatsByClass } from '../../shared/logic/assess';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * The monthly report (phiếu nhận xét) for one student and one month, assembled.
 *
 * Extracted from app/routes/assessments.$month.$studentId.report.tsx so the printable document,
 * that route, and the phone's parent screen all read one source. Routes carry no business logic;
 * see server/api/handler.ts.
 *
 * The ratings and the comment come from the stored remark; every number next to them is computed
 * here from the month's score and behaviour records. Nothing is denormalized, so a corrected score
 * shows up on the next read.
 *
 * @returns null when the student does not exist.
 */
export async function buildReportCard(db: TenantDb, studentId: string, month: string) {
  const vnToday = ictDateOf(new Date().toISOString());
  const checkinSettings = await checkinSvc.getCheckinSettings(db);
  const [
    students,
    classes,
    remark,
    scores,
    behavior,
    criteria,
    garden,
    attendance,
    homework,
    subjects,
    staffList,
    tuiMu,
    practice,
  ] = await Promise.all([
    peopleSvc.listStudents(db),
    classesSvc.listLite(db),
    assessSvc.getRemark(db, studentId, month),
    assessSvc.listScores(db),
    assessSvc.listBehavior(db),
    criteriaSvc.list(db),
    // The slip is a keepsake, so a garden hiccup must not 500 the whole document — it drops the
    // garden line and prints everything else.
    gardenSvc.studentGardenMonth(db, studentId, month, vnToday).catch(() => null),
    attendanceSvc.studentMonthAttendance(db, studentId, month),
    // Same degrade-do-not-die posture as the garden line above.
    gardenSvc.studentAssignmentsInMonth(db, studentId, month).catch(() => []),
    subjectsSvc.list(db),
    peopleSvc.listStaff(db),
    // Same admin toggle as report-extras.tsx; null when off keeps the slip unchanged.
    checkinSettings.showParentReport
      ? checkinSvc.studentMonthTally(db, studentId, month).catch(() => null)
      : Promise.resolve(null),
    // Same degrade-do-not-die posture as the garden line above: null just drops the block.
    practiceSvc.studentPracticeForReport(db, studentId, month).catch(() => null),
  ]);

  const student = students.find((s) => s.id === studentId);
  if (!student) return null;

  const monthScores = scores.filter((r) => r.studentId === studentId && r.date.startsWith(month));
  const monthBehavior = behavior.filter(
    (r) => r.studentId === studentId && r.date.startsWith(month),
  );

  // The real roll now prints on the slip, so the hand-logged behavior 'late'/'absent' incidents
  // stay off it — two disagreeing absence numbers on one parent document read as an error. The
  // teacher-facing rail still shows every type.
  const incidents: Record<string, number> = {};
  for (const ty of NEGATIVE_TYPES) {
    if (ty === 'late' || ty === 'absent') continue;
    const n = monthBehavior.filter((r) => r.type === ty).length;
    if (n > 0) incidents[ty] = n;
  }

  const classById = new Map(classes.map((c) => [c.id, c]));
  const subjectById = new Map(subjects.map((s) => [s.id, s.name]));
  const scoreLines = scoreStatsByClass(monthScores).map((g) => {
    const cls = g.classId ? classById.get(g.classId) : undefined;
    return {
      className: cls?.name ?? null,
      subjectName: cls?.subjectId ? (subjectById.get(cls.subjectId) ?? null) : null,
      average: g.average,
      count: g.count,
    };
  });

  return {
    month,
    student: { id: student.id, name: student.name },
    classNames: classes.filter((c) => student.classIds.includes(c.id)).map((c) => c.name),
    // null when the teacher has not written one yet — the slip renders empty stars and says so,
    // rather than 404ing on a URL that is perfectly valid.
    remark,
    // The teacher who last saved the remark, for the signature block. Null for rows that predate
    // the provenance columns (migration 0032) — the slip omits the name rather than guessing.
    teacher: remark?.staffId
      ? (staffList.find((s) => s.id === remark.staffId)?.name ?? null)
      : null,
    // Active criteria only: a retired criterion disappears from newly printed slips even for
    // months whose stored ratings still carry its key.
    criteria: criteria.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })),
    stats: {
      average: scoreStats(monthScores).average,
      testCount: monthScores.length,
      incidents,
      praiseCount: monthBehavior.filter((r) => r.type === 'praise').length,
    },
    // Per-class averages, subject resolved through the managed subjects list.
    scoreLines,
    // The real roll, per class. Empty array hides the section.
    attendance,
    // Assignments whose deadline fell in this month, done or not.
    homework,
    // Month-scoped garden numbers. Streak is "as of today", so it is only claimed while the
    // reported month is still the running month. NO setbacks on a keepsake — deliberate.
    garden:
      garden && (garden.activeDays > 0 || garden.fruits > 0)
        ? {
            activeDays: garden.activeDays,
            playDays: garden.playDays,
            stagesGained: garden.stagesGained,
            fruits: garden.fruits,
            streak: month === vnToday.slice(0, 7) ? (garden.plant?.streak ?? 0) : 0,
          }
        : null,
    // Túi mù month tally, only while the admin has switched on parent-facing check-in reporting.
    tuiMu,
    // Nhiệm vụ: done/total, the excused balance, the active warning and recent feedback lines.
    // Null when the student is in no Practice-enabled class, which hides the block entirely.
    practice,
  };
}
