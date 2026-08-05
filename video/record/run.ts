import { Recorder } from './recorder';
import type { Walkthrough } from './types';
import { calendarBasics } from './walkthroughs/calendar-basics';

const WALKTHROUGHS: Record<string, Walkthrough> = {
  [calendarBasics.id]: calendarBasics,
};

const BASE = process.env.E2E_BASE_URL ?? 'https://calendar.ngqv0712.workers.dev';

/**
 * Remove the rows the walkthrough created. Recordings run against the live app —
 * there is no local dev server for this project — so every guide that writes has to
 * clean up after itself or the demo calendar fills with takes.
 */
async function cleanup(marker: string): Promise<void> {
  const email = process.env.MOCHI_EMAIL!;
  const password = process.env.MOCHI_PASSWORD!;
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) {
    console.warn(`[cleanup] login failed (${login.status}); "${marker}" left in place`);
    return;
  }
  const token: string = (await login.json()).data.token;
  const auth = { authorization: `Bearer ${token}` };

  const res = await fetch(`${BASE}/api/events`, { headers: auth });
  const payload = await res.json();
  const events: { id: string; title: string }[] = payload.data?.events ?? payload.data ?? [];
  const mine = events.filter((e) => e.title === marker);

  for (const e of mine) {
    const del = await fetch(`${BASE}/api/events?id=${encodeURIComponent(e.id)}`, {
      method: 'DELETE',
      headers: auth,
    });
    console.log(`[cleanup] delete ${e.id} "${e.title}" → ${del.status}`);
  }
  if (mine.length === 0) console.log(`[cleanup] nothing titled "${marker}" to remove`);
}

async function main(): Promise<void> {
  const id = process.argv[2];
  const walkthrough = id ? WALKTHROUGHS[id] : undefined;
  if (!walkthrough) {
    console.error(
      `Usage: npm run record -- <id>\nKnown walkthroughs: ${Object.keys(WALKTHROUGHS).join(', ')}`,
    );
    process.exit(1);
  }

  console.log(`[record] ${walkthrough.id} against ${BASE}`);
  const rec = await Recorder.launch({ id: walkthrough.id, baseUrl: BASE, lang: 'vi' });
  let recorded = false;
  try {
    await rec.login();
    await rec.syncFlash();
    await walkthrough.run(rec);
    recorded = true;
  } finally {
    const { manifest, videoPath } = await rec.finish();
    console.log(`[record] ${videoPath}`);
    console.log(
      `[record] ${manifest.steps.length} steps, ${(manifest.durationMs / 1000).toFixed(1)}s`,
    );
    for (const s of manifest.steps) {
      console.log(
        `         ${s.id.padEnd(16)} ${(s.tStartMs / 1000).toFixed(2)}s → ${(s.tEndMs / 1000).toFixed(2)}s` +
          (s.target ? ' [target]' : '') +
          (s.click ? ' [click]' : ''),
      );
    }
    if (walkthrough.marker) await cleanup(walkthrough.marker);
    if (!recorded) console.error('[record] walkthrough threw — footage is likely incomplete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
