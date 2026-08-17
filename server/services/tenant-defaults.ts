import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db';
import { assessmentTypes, classLevels, gradeLevels, remarkCriteria } from '../db/schema';

/**
 * What a brand-new school starts with.
 *
 * These lists are lifted from the migrations that introduced each managed enum, not from
 * `seed.sql` (which is demo data). They live in TypeScript rather than SQL because a migration
 * runs once for the whole deployment, while a school is created at runtime — and because
 * having them here makes "every new school gets exactly these rows" a testable claim.
 *
 * Ids are fresh per school: these are ordinary editable rows the school owns, not shared
 * references. The original school keeps its historical short ids ('at1', 'rc_attitude', …) and
 * nothing joins across schools, so the two coexist happily.
 *
 * Two enums are deliberately NOT seeded:
 *
 *   * `subjects` — migration 0030 derived them from whatever free text the school had already
 *     typed, so there has never been a canonical list. A language centre's subjects are not a
 *     state school's.
 *   * `checkin_activity_types` — migration 0038 shipped the table empty for the same reason;
 *     the original school authored its own.
 *
 * Guessing a curriculum for someone else's school would be worse than an empty list with an
 * obvious "add one" button, so both start empty.
 */

/** migrations/0007_assessment_types_attendance_grades.sql */
export const DEFAULT_ASSESSMENT_TYPES = [
  'Kiểm tra miệng',
  'Kiểm tra 15 phút',
  'Kiểm tra 1 tiết',
  'Giữa kỳ',
  'Essay draft',
  'Essay final',
] as const;

/** migrations/0025_remark_criteria.sql */
export const DEFAULT_REMARK_CRITERIA = [
  'Thái độ học tập',
  'Bài tập về nhà',
  'Tham gia phát biểu',
  'Tiến bộ',
] as const;

/** Khối — migrations/0017_tests.sql */
export const DEFAULT_GRADE_LEVELS = ['Khối 6', 'Khối 7', 'Khối 8', 'Khối 9'] as const;

/** Trình độ — migrations/0029_class_cohort.sql */
export const DEFAULT_CLASS_LEVELS = ['Cơ bản', 'Nâng cao'] as const;

/** How many rows `seedTenantDefaults` inserts, so a test can assert the whole set at once. */
export const DEFAULT_ROW_COUNT =
  DEFAULT_ASSESSMENT_TYPES.length +
  DEFAULT_REMARK_CRITERIA.length +
  DEFAULT_GRADE_LEVELS.length +
  DEFAULT_CLASS_LEVELS.length;

/**
 * Batch items seeding one school's starter rows. Returned rather than executed so the caller
 * can put them in the same `db.batch` as the school itself — a half-seeded school should not
 * be reachable.
 *
 * Takes a raw `Db` because it runs inside `createTenant`, before any session exists for the
 * school being built; `tenantId` is passed explicitly for the same reason.
 */
export function seedTenantDefaults(db: Db, tenantId: string): BatchItem<'sqlite'>[] {
  const rows = (names: readonly string[]) =>
    names.map((name, i) => ({
      id: crypto.randomUUID(),
      tenantId,
      name,
      active: true,
      sortOrder: i + 1,
    }));

  return [
    db.insert(assessmentTypes).values(rows(DEFAULT_ASSESSMENT_TYPES)),
    db.insert(remarkCriteria).values(rows(DEFAULT_REMARK_CRITERIA)),
    db.insert(gradeLevels).values(rows(DEFAULT_GRADE_LEVELS)),
    db.insert(classLevels).values(rows(DEFAULT_CLASS_LEVELS)),
  ];
}
