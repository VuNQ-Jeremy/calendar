import type { FeedbackRow } from './feedback';

const REPO = 'VuNQ-Jeremy/calendar';

/**
 * Fire-and-forget: open a GitHub issue for a new feedback row. The issue is the
 * relay that fires the claude.ai brainstorm routine (webhook trigger on
 * issues/opened + label `feedback`). Fail-safe like the other optional secrets:
 * no token means no-op, and a GitHub error is logged but never surfaced —
 * feedback creation must never fail or slow down because of this.
 */
export function notifyFeedbackIssue(env: Env, ctx: ExecutionContext, row: FeedbackRow): void {
  const token = env.GITHUB_FEEDBACK_TOKEN;
  if (!token) return;
  ctx.waitUntil(
    createIssue(token, row).catch((err) =>
      console.error('[feedback-issue] failed', { id: row.id, err: String(err) }),
    ),
  );
}

async function createIssue(token: string, row: FeedbackRow): Promise<void> {
  const firstLine = row.message.split('\n')[0].trim();
  const title = `Feedback: ${row.category} — ${firstLine.slice(0, 60)}${firstLine.length > 60 ? '…' : ''}`;
  const body = [
    row.message,
    '',
    '---',
    `- **Author:** ${row.author ?? 'anonymous'}`,
    `- **Category:** ${row.category}`,
    `- **App version:** ${row.appVersion ?? 'unknown'}`,
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
}
