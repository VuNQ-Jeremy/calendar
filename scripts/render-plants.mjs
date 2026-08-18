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

if (!baseline) process.exit(0);

if (!existsSync(baseline)) {
  console.error(`baseline directory '${baseline}' does not exist — capture one first`);
  process.exit(2);
}

// Compare only the files the baseline actually holds: capturing a baseline for one species and
// then rendering all ten must not read as ten regressions.
const expected = (await readdir(baseline)).filter((f) => f.endsWith('.svg'));
const drift = [];
for (const name of expected) {
  const before = await readFile(join(baseline, name), 'utf8');
  const path = join(outDir, name);
  if (!existsSync(path)) {
    drift.push(`${name}: missing from the new render`);
    continue;
  }
  const after = await readFile(path, 'utf8');
  if (before !== after) drift.push(`${name}: ${before.length} bytes -> ${after.length} bytes`);
}

if (drift.length) {
  console.error(`\nPARITY FAILED — ${drift.length}/${expected.length} file(s) changed:`);
  for (const d of drift) console.error(`  ${d}`);
  process.exit(1);
}
console.log(`parity OK — ${expected.length} file(s) byte-identical to ${baseline}`);
