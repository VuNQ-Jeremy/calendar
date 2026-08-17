import type { TenantDb } from '../db/index';
import * as feedbackSvc from './feedback';
import type { FeedbackRow } from './feedback';

const REPO = 'VuNQ-Jeremy/calendar';

/** The handle the board and the issue title agree on, e.g. "F-12". */
export function feedbackRef(row: FeedbackRow): string | null {
  return row.ref == null ? null : `F-${row.ref}`;
}

/**
 * Fire-and-forget: open a GitHub issue for a new feedback row. The issue is the
 * relay that fires the claude.ai brainstorm routine (webhook trigger on
 * issues/opened + label `feedback`). Fail-safe like the other optional secrets:
 * no token means no-op, and a GitHub error is logged but never surfaced —
 * feedback creation must never fail or slow down because of this.
 *
 * The issue number GitHub assigns is written back onto the feedback row, which is why this
 * takes a `db`. That write is best-effort too: a report with no issue number still works, it
 * just costs a search to find its issue.
 */
export function notifyFeedbackIssue(
  env: Env,
  ctx: ExecutionContext,
  db: TenantDb,
  row: FeedbackRow,
): void {
  const token = env.GITHUB_FEEDBACK_TOKEN;
  if (!token) return;
  ctx.waitUntil(
    createIssue(token, row)
      .then((issueNumber) => feedbackSvc.setIssueNumber(db, row.id, issueNumber))
      .catch((err) => console.error('[feedback-issue] failed', { id: row.id, err: String(err) })),
  );
}

/** Returns the number of the issue it opened. */
async function createIssue(token: string, row: FeedbackRow): Promise<number> {
  const firstLine = row.message.split('\n')[0].trim();
  const ref = feedbackRef(row);
  const title =
    `Feedback${ref ? ` ${ref}` : ''}: ${row.category} — ` +
    `${firstLine.slice(0, 60)}${firstLine.length > 60 ? '…' : ''}`;
  const body = [
    row.message,
    '',
    '---',
    `- **Author:** ${row.author ?? 'anonymous'}`,
    `- **Category:** ${row.category}`,
    `- **App version:** ${row.appVersion ?? 'unknown'}`,
    `- **Feedback ref:** ${ref ?? '—'}`,
    `- **Feedback id:** \`${row.id}\``,
    `- **Created:** ${row.createdAt}`,
  ].join('\n');
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      // GitHub's API rejects requests without a User-Agent.
      'User-Agent': 'mochi-feedback-bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels: ['feedback'] }),
  });
  if (res.status !== 201) {
    throw new Error(`github ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const issue = (await res.json()) as { number?: number };
  if (typeof issue.number !== 'number') throw new Error('github: created issue has no number');
  return issue.number;
}
