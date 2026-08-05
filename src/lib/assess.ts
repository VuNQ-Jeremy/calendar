/**
 * Assessment vocabulary and score/behaviour maths.
 *
 * The implementation moved to shared/logic/assess.ts in phase 5 so the mobile app runs the
 * identical bucketing and statistics — the same treatment `dates`, `recurrence` and `flashcards`
 * already had. This file stays as the web's import path; the logic has no second copy.
 */
export {
  ATTENDANCE_META,
  ATTENDANCE_STATUSES,
  BEHAVIOR_META,
  BEHAVIOR_TYPES,
  NEGATIVE_TYPES,
  bucketBehaviorByWeek,
  bucketBehaviorByWeekInMonth,
  monthWeekStarts,
  scoreColorId,
  scoreStats,
  weekStart,
} from '../../shared/logic/assess';

export type {
  AttendanceStatusId,
  BehaviorTypeId,
  ScoreColorId,
  ScoreStats,
  WeekBucket,
} from '../../shared/logic/assess';
