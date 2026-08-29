import { and, asc, count, eq, like, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { logoLibrary } from '../db/schema';

/** How many tiles one page of the catalogue shows. */
export const LOGO_PAGE_SIZE = 120;

export type LogoRow = {
  id: string;
  storageKey: string;
  slug: string;
  category: string;
  subject: string;
  variant: number;
  backgroundColor: string;
};

export type LogoPage = {
  rows: LogoRow[];
  /** Rows matching the current filter, across every page. */
  total: number;
  /** Every category with at least one row, and how many — drives the filter chips. */
  categories: { category: string; n: number }[];
  /** Distinct subjects in the whole library, filter-independent: a stable "size of it" number. */
  subjects: number;
  page: number;
  pageSize: number;
};

/**
 * One page of the logo catalogue.
 *
 * `db` here is the RAW handle, not a TenantDb: logo_library has no tenant_id because it is shared
 * reference art (see migrations/0056_logo_library.sql). That is the one deliberate exception on
 * this screen — everything else an admin reads is scoped.
 *
 * Filtering happens in SQL rather than in the component because the library is ~3.4k rows: shipping
 * all of them to filter client-side would make the loader payload larger than the images on screen.
 */
export async function listLogos(
  db: Db,
  opts: { category?: string | null; q?: string | null; page?: number } = {},
): Promise<LogoPage> {
  const category = opts.category?.trim() || null;
  const q = opts.q?.trim().toLowerCase() || null;
  const page = Math.max(1, Math.floor(opts.page ?? 1));

  const term = q ? `%${q.replace(/[%_]/g, '')}%` : null;
  const where = and(
    category ? eq(logoLibrary.category, category) : undefined,
    term ? or(like(logoLibrary.subject, term), like(logoLibrary.slug, term)) : undefined,
  );

  const [rows, totalRow, categories, subjectRow] = await Promise.all([
    db
      .select({
        id: logoLibrary.id,
        storageKey: logoLibrary.storageKey,
        slug: logoLibrary.slug,
        category: logoLibrary.category,
        subject: logoLibrary.subject,
        variant: logoLibrary.variant,
        backgroundColor: logoLibrary.backgroundColor,
      })
      .from(logoLibrary)
      .where(where)
      // Subject then variant, so every drawing of the same animal sits together.
      .orderBy(asc(logoLibrary.category), asc(logoLibrary.subject), asc(logoLibrary.variant))
      .limit(LOGO_PAGE_SIZE)
      .offset((page - 1) * LOGO_PAGE_SIZE),
    db.select({ n: count() }).from(logoLibrary).where(where),
    // Chip counts ignore the search box but respect nothing else: they are the shape of the whole
    // library, so switching category never shows a count that then turns out to be zero.
    db
      .select({ category: logoLibrary.category, n: count() })
      .from(logoLibrary)
      .groupBy(logoLibrary.category)
      .orderBy(asc(logoLibrary.category)),
    db.select({ n: sql<number>`count(distinct ${logoLibrary.subject})` }).from(logoLibrary),
  ]);

  return {
    rows,
    total: totalRow[0]?.n ?? 0,
    categories,
    subjects: subjectRow[0]?.n ?? 0,
    page,
    pageSize: LOGO_PAGE_SIZE,
  };
}
