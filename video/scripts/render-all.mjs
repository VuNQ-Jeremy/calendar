/**
 * Render catalog entries to `out/<series>/<id>--<format>.mp4`.
 *
 *   npm run render                       # everything in the catalog
 *   npm run render -- guide-calendar     # substring filter on the composition id
 *   npm run render -- --format landscape
 *
 * Bundles once and reuses it, which is most of the wall-clock saving when several
 * compositions share the same code.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');

const args = process.argv.slice(2);
const formatFlag = args.indexOf('--format');
const wantFormat = formatFlag >= 0 ? args[formatFlag + 1] : null;
const filters = args.filter((a, i) => !a.startsWith('--') && i !== formatFlag + 1);

console.log('[render] bundling…');
const serveUrl = await bundle({
  entryPoint: path.join(ROOT, 'src', 'index.ts'),
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: { ...config.resolve?.alias, '@shared': path.resolve(ROOT, '..', 'shared') },
    },
  }),
});

const compositions = await getCompositions(serveUrl);
const selected = compositions.filter((c) => {
  if (wantFormat && !c.id.endsWith(`--${wantFormat}`)) return false;
  if (filters.length === 0) return true;
  return filters.some((f) => c.id.includes(f));
});

if (selected.length === 0) {
  console.error(
    `[render] nothing matched. Available: ${compositions.map((c) => c.id).join(', ') || '(none)'}`,
  );
  process.exit(1);
}

for (const composition of selected) {
  const series = composition.id.startsWith('guide-')
    ? 'guides'
    : composition.id.startsWith('short-')
      ? 'shorts'
      : 'other';
  const dir = path.join(OUT, series);
  await fs.mkdir(dir, { recursive: true });
  const outputLocation = path.join(dir, `${composition.id}.mp4`);

  const seconds = (composition.durationInFrames / composition.fps).toFixed(1);
  console.log(
    `[render] ${composition.id} — ${composition.width}×${composition.height}, ` +
      `${composition.durationInFrames} frames (${seconds}s)`,
  );

  let lastLogged = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 18,
    outputLocation,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= lastLogged + 10) {
        lastLogged = pct;
        process.stdout.write(`         ${pct}%\r`);
      }
    },
  });
  const { size } = await fs.stat(outputLocation);
  console.log(`         → ${outputLocation} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

console.log(`[render] ${selected.length} video(s) written to ${OUT}`);
