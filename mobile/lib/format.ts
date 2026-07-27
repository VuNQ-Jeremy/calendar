type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * "just now" / "5 min ago" / "3 h ago" / "2 d ago".
 *
 * Four separate strings rather than one interpolated pattern, because Vietnamese's zero case
 * ("vừa xong") has no number in it at all — a single `{n} {unit} ago` template cannot express it.
 */
export function agoLabel(t: T, iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (mins < 1) return t('m_ago_now');
  if (mins < 60) return t('m_ago_min', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('m_ago_hour', { n: hours });
  return t('m_ago_day', { n: Math.round(hours / 24) });
}

/** Short date for a results row — `Mar 4`. Matches the web's toLocaleDateString options. */
export function shortDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
