/**
 * Render every plant drawing to standalone SVG files — the garden's art workbench.
 *
 * Two jobs, both of which used to need a browser and a logged-in student:
 *
 *   1. **Preview.** Draw a species at every stage so it can be looked at while it is being
 *      authored, without deploying anything.
 *   2. **Parity.** Diff the current renderer's output against a saved directory. The geometry
 *      moved out of `src/garden/plant-art.tsx` into `shared/garden-art.ts`, and the only way to
 *      know that refactor changed nothing is to compare bytes with a baseline captured before it.
 *
 * Run through tsx, which is already in the tree — the renderer is TSX and this script imports it
 * directly rather than duplicating any of it:
 *
 *   npx tsx scripts/render-plants.mjs --out .preview                    # every species
 *   npx tsx scripts/render-plants.mjs --out .preview --species cachua   # just one
 *   npx tsx scripts/render-plants.mjs --out .current --baseline .base   # parity gate, exits 1 on drift
 *
 * Output directories are scratch. Do not commit them.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlantSvg } from '../src/garden/plant-art.tsx';
import { SPECIES } from '../shared/garden-art.ts';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

/** Presence test, so a trailing `--png` (whose "value" is undefined) still counts. */
const flag = (name) => process.argv.includes(`--${name}`);

const outDir = arg('out');
const only = arg('species');
const baseline = arg('baseline');

if (!outDir) {
  console.error('usage: npx tsx scripts/render-plants.mjs --out <dir> [--species id] [--baseline <dir>]');
  process.exit(2);
}

/**
 * Every state one species can be seen in. Stage 0 and the dead pot are chrome rather than art,
 * but they render from the same component, so a regression in either still shows up here.
 */
function* variants() {
  for (let stage = 0; stage <= 5; stage++) {
    yield { stage, label: `s${stage}` };
    if (stage >= 1) yield { stage, wilted: true, label: `s${stage}-wilted` };
  }
  yield { stage: 0, dead: true, label: 'dead' };
  yield { stage: 5, locked: true, label: 's5-locked' };
}

const species = only ? SPECIES.filter((s) => s.id === only) : SPECIES;
if (!species.length) {
  console.error(`unknown species '${only}' — known: ${SPECIES.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

await mkdir(outDir, { recursive: true });

let written = 0;
for (const s of species) {
  for (const v of variants()) {
    const svg = renderToStaticMarkup(
      createElement(PlantSvg, {
        stage: v.stage,
        wilted: v.wilted ?? false,
        dead: v.dead ?? false,
        locked: v.locked ?? false,
        species: s.id,
        potColor: 'cocoa',
        size: 96,
      }),
    );
    await writeFile(join(outDir, `${s.id}-${v.label}.svg`), `${svg}\n`, 'utf8');
    written++;
  }
}
console.log(`rendered ${written} file(s) for ${species.length} species → ${outDir}`);

/**
 * A contact sheet: every rendered drawing on one page, labelled, at 2× so the strokes are
 * readable. `--png` additionally rasterizes it with Playwright, which is the only way to actually
 * LOOK at a new species without deploying — an SVG file is just text until something paints it.
 */
if (flag('sheet') || flag('png')) {
  const files = (await readdir(outDir)).filter((f) => f.endsWith('.svg')).sort();
  const cells = [];
  for (const name of files) {
    const svg = (await readFile(join(outDir, name), 'utf8')).replace(
      /width="96" height="96"/,
      'width="192" height="192"',
    );
    cells.push(`<figure><div>${svg}</div><figcaption>${name.replace('.svg', '')}</figcaption></figure>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #FAF7F2; font: 13px/1.4 system-ui, sans-serif; color: #2E2419; }
    .grid { display: grid; grid-template-columns: repeat(7, 192px); gap: 18px; }
    figure { margin: 0; text-align: center; }
    figure div { background: #fff; border: 1px solid #E8DFD4; border-radius: 12px; }
    figcaption { margin-top: 6px; font-size: 11px; color: #6E6259; }
  </style><div class="grid">${cells.join('')}</div>`;
  const sheet = join(outDir, 'sheet.html');
  await writeFile(sheet, html, 'utf8');
  console.log(`contact sheet → ${sheet}`);

  if (flag('png')) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewportSize: { width: 1520, height: 900 } });
    await page.goto(`file://${join(process.cwd(), sheet)}`);
    const png = join(outDir, 'sheet.png');
    await page.screenshot({ path: png, fullPage: true });
    await browser.close();
    console.log(`contact sheet PNG → ${png}`);
  }
}

if (!baseline) process.exit(0);

if (!existsSync(baseline)) {
  console.error(`baseline directory '${baseline}' does not exist — capture one first`);
  process.exit(2);
}

/**
 * Reduce an SVG to what a browser actually paints: every drawing element, in order, tagged with
 * the transforms it inherits.
 *
 * Bytes are the wrong unit for this comparison. A `<g>` carrying no attributes paints nothing and
 * changes nothing — it is an artifact of how the renderer happens to decompose its components —
 * so a refactor that regroups elements would fail a byte diff while being pixel-identical. What
 * must NOT change is any element's geometry, its colours, or the transform stack above it, and
 * all three survive into this form.
 */
function canonical(svg) {
  const tokens = svg.match(/<[^>]+>/g) ?? [];
  const stack = [];
  const out = [];
  for (const tok of tokens) {
    if (tok.startsWith('</g')) {
      stack.pop();
      continue;
    }
    if (tok.startsWith('<g')) {
      stack.push(/transform="([^"]*)"/.exec(tok)?.[1] ?? '');
      continue;
    }
    if (tok.startsWith('</') || tok.startsWith('<svg')) continue;
    out.push(`${stack.filter(Boolean).join(' | ')}  ${tok}`);
  }
  return out;
}

// Compare only the files the baseline actually holds: capturing a baseline for one species and
// then rendering all ten must not read as ten regressions.
const expected = (await readdir(baseline)).filter((f) => f.endsWith('.svg'));
const drift = [];
for (const name of expected) {
  const before = canonical(await readFile(join(baseline, name), 'utf8'));
  const path = join(outDir, name);
  if (!existsSync(path)) {
    drift.push(`${name}: missing from the new render`);
    continue;
  }
  const after = canonical(await readFile(path, 'utf8'));
  if (before.length !== after.length) {
    drift.push(`${name}: ${before.length} drawn element(s) -> ${after.length}`);
    continue;
  }
  const at = before.findIndex((line, i) => line !== after[i]);
  if (at !== -1) drift.push(`${name}: element ${at} changed\n      was: ${before[at]}\n      now: ${after[at]}`);
}

if (drift.length) {
  console.error(`\nPARITY FAILED — ${drift.length}/${expected.length} file(s) changed:`);
  for (const d of drift) console.error(`  ${d}`);
  process.exit(1);
}
console.log(`parity OK — ${expected.length} file(s) paint exactly what ${baseline} painted`);
