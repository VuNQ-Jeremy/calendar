# Garden Plant Species Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the vocabulary garden ~10 collectible plant species, unlocked by lifetime harvested fruit, with the art authored once as shared data and rendered by thin web/mobile renderers.

**Architecture:** A new plain-data species registry in `shared/garden-art.ts` (part-primitive lists per stage + palette) replaces the geometry tables currently duplicated in `src/garden/plant-art.tsx` and `mobile/components/garden/PlantArt.tsx`; both files shrink to thin renderers. A `species` column (default `'classic'`) rides everywhere `potColor` already rides. Unlock state is derived at read time from `fruitsTotal` — no new bookkeeping. Species changes are guarded server-side to empty/dead/stage-1 plants.

**Tech Stack:** React + DOM SVG (web), react-native-svg + Reanimated (mobile), Drizzle/D1 (server), Zod (contracts), Playwright (e2e, written not run), vitest-in-node (mobile logic tests).

**Spec:** `docs/superpowers/specs/2026-08-18-garden-species-design.md` (already on disk, committed in Task 0). Read it first — it holds the full decision record (thresholds, species table, switch-window rationale, snapshot rules).

## Context (why)

The garden has exactly one plant drawing, hand-kept as twin files (web + RN). The user wants a species collection to deepen motivation, and pets later. Every decision below was confirmed with the user during brainstorming; the lifecycle facts (no-row = empty pot; death keeps the row; revive/harvest re-seed to stage 1) were verified against `shared/logic/garden.ts` by a planning agent.

## Global Constraints (from CLAUDE.md + spec — every task inherits these)

- **Push to `main` only.** Each task ends with commit + push + `node scripts/changelog.mjs "…"` (it stages CHANGELOG.md). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Never trigger paid APIs** (Anthropic enrich/generate, Workers AI images, Azure speech). All art is hand-authored SVG data in this repo.
- **Test suites are manual-trigger only.** WRITE `test-worker/*.test.js`, `test/*.test.ts`, and `e2e/*.spec.ts` additions in the same commit as the code they cover, but NEVER run `npm test` / `npm run test:worker` / `npm run test:e2e*`. Free checks you MUST run before each commit: `npm run typecheck`, `npm run lint`, `npm run check:i18n`. `cd mobile && npm test` is also free (~1s, Node 24) and MUST run for mobile-touching tasks.
- **TDD shape under that rule:** write the failing test first, implement, then verify with the free checks + the local render-harness diffs described below; suite execution is the user's call — say so in one line when a task lands.
- **After the migration push:** `npx wrangler d1 migrations list mochi-class --remote` (account ngqv0712@gmail.com, `CLOUDFLARE_API_TOKEN` env — never `wrangler login`). Apply by hand if the Actions run was cancelled (see memory: prod D1 migration isn't automatic).
- **After every push:** verify the EAS OTA workflow fired (`cd mobile && npx eas-cli workflow:runs` → top entry = your commit, `Status SUCCESS`). Known issue: free-tier CI quota may be exhausted — fall back to `cd mobile && npx eas-cli update --branch preview --platform android --environment preview --message "..."` (never drop `--environment preview`). `runtimeVersion` is NOT bumped by this feature (no native dep changes).
- **Colors in art data are literal hexes** — never CSS vars (html-to-image rasterizes the share card from a detached clone).
- **Prettier CRLF caveat:** `prettier --check` false-flags the whole tree; only hand-fix your own hunks.
- **i18n:** every new key needs en + vi (vi is typed against `MsgKey`, so a miss is a type error; `npm run check:i18n` guards it).

## File Structure

```
migrations/0050_garden_species.sql        NEW  species + companion columns
shared/garden-art.ts                      NEW  species registry: types, palettes, geometry, unlock helpers
test/garden-art.test.ts                   NEW  unit tests for the registry helpers
scripts/render-plants.mjs                 NEW  local SVG render harness (parity diff + species preview)
server/db/schema.ts                       MOD  gardenPlants columns
server/services/garden.ts                 MOD  PlantRecord.species, updatePlant guard, projections, snapshotMonth
shared/schemas.ts                         MOD  PlantPatchInput.species
shared/logic/garden.ts                    MOD  GardenSnapshotMember.species
shared/api-contract.ts                    MOD  species on 3 response schemas
server/api/docs/registry.ts               MOD  PATCH /api/garden/plant docs
docs/api.md                               MOD  garden section
app/routes/flashcards.tsx                 MOD  loader payload + plant-update action guard errors
app/routes/api.garden.plant.tsx           MOD  loadPlant payload + PATCH errors
src/garden/plant-art.tsx                  MOD  thin renderer over registry, species prop
src/garden/garden-widget.tsx              MOD  species picker + unlock celebration + replant prompt
src/garden/class-garden.tsx               MOD  pass species through (members, album)
src/garden/share-card.tsx                 MOD  pass species through
src/screens-assessments.tsx               MOD  pass species through
mobile/components/garden/PlantArt.tsx     MOD  thin RN renderer over registry, species prop
mobile/components/garden/GardenWidget.tsx MOD  species picker + celebration
mobile/components/garden/MemberCard.tsx   MOD  pass species through
mobile/lib/types.ts                       MOD  mirror species on 2 interfaces
shared/i18n/strings.ts                    MOD  species names + picker strings (en+vi)
test-worker/garden.test.js                MOD  guard + ride-along tests
e2e/crud-garden2.spec.ts                  MOD  picker + celebration lifecycle
```

Species data lives INSIDE `shared/garden-art.ts` as one module (10 entries × 5 stages of plain data — large but one responsibility: "what each species looks like"). If it passes ~1200 lines during implementation, split to `shared/garden-art/` with one file per species and an index — decide at Task 7, not before.

---

### Task 0: Commit the spec and this plan

**Files:**
- Create: `docs/superpowers/specs/2026-08-18-garden-species-design.md` (already on disk from the planning session — verify content, do not rewrite)
- Create: `docs/superpowers/plans/2026-08-18-garden-species.md` (copy of this plan file)

- [ ] **Step 1:** Copy this plan into the repo: `cp <this plan file> docs/superpowers/plans/2026-08-18-garden-species.md`
- [ ] **Step 2:** Commit + push:
```bash
git add docs/superpowers
node scripts/changelog.mjs "docs: garden species design spec + implementation plan"
git commit -m "docs(garden): species design spec + implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```
- [ ] **Step 3:** Verify OTA workflow per Global Constraints (docs-only push still triggers it; a SUCCESS or a manual publish keeps the invariant "every push ends published").

---

### Task 1: Migration 0050 + schema + service passthrough

**Files:**
- Create: `migrations/0050_garden_species.sql`
- Modify: `server/db/schema.ts` (gardenPlants, ~line 1217)
- Modify: `server/services/garden.ts` (`PlantRecord` ~line 133, `getPlant` ~line 155)
- Test: `test-worker/garden.test.js`

**Interfaces:**
- Produces: `garden_plants.species TEXT NOT NULL DEFAULT 'classic'`, dormant `garden_plants.companion TEXT`; `PlantRecord.species: string`.

- [ ] **Step 1: Write the failing test.** In `test-worker/garden.test.js`, next to the existing default-potColor assertion (~line 71), assert the new default after a first qualifying play creates the row:
```js
// species defaults to 'classic' on the row the first play creates
assert.equal(plant.species, 'classic');
```
And extend the existing updatePlant round-trip test (~line 173) — species is NOT part of that patch yet; just assert it survives a name/pot patch unchanged (`'classic'`).
- [ ] **Step 2: Migration.**
```sql
-- 0050: personal plant species (vườn cây từ vựng). 'classic' is the pre-species drawing,
-- so every existing plant keeps its exact look on deploy day.
ALTER TABLE garden_plants ADD COLUMN species TEXT NOT NULL DEFAULT 'classic';
-- Reserved for the future pets feature; nothing reads or writes it yet.
ALTER TABLE garden_plants ADD COLUMN companion TEXT;
```
- [ ] **Step 3: Schema.** In `server/db/schema.ts` gardenPlants, after `potColor`:
```ts
/** Species id from shared/garden-art.ts; 'classic' is the original drawing. */
species: text('species').notNull().default('classic'),
/** Reserved for pets — dormant, see docs/superpowers/specs/2026-08-18-garden-species-design.md. */
companion: text('companion'),
```
- [ ] **Step 4: Service passthrough.** `PlantRecord` gains `species: string`; `getPlant` returns `species: row.species`. Do NOT touch `rowToState` (species is appearance, not lifecycle state — same as `potColor`). Do NOT add species to `transitionOps`' values (grow/revive must never clobber it — it already excludes plantName/potColor the same way).
- [ ] **Step 5: Free checks.** `npm run typecheck && npm run lint`. Expected: clean. (Worker suite: written, not run — note that in the landing message.)
- [ ] **Step 6: Commit + push** (changelog: `feat(garden): species + companion columns (0050)`), then verify remote migration per Global Constraints:
```bash
npx wrangler d1 migrations list mochi-class --remote
```
Expected: 0050 listed as applied; if pending, apply by hand (`npx wrangler d1 migrations apply mochi-class --remote`). Verify OTA workflow as always.

---

### Task 2: Species registry — types, helpers, unit tests (no art yet)

**Files:**
- Create: `shared/garden-art.ts`
- Test: `test/garden-art.test.ts`

**Interfaces (later tasks consume these exact names):**
```ts
export type ColorRole =
  | 'stem' | 'leaf' | 'leafInk' | 'petal' | 'petalInk' | 'eye' | 'eyeInk'
  | 'fruit' | 'fruitInk' | 'seed' | 'soilInk' | 'white';
export type SpeciesPalette = Record<ColorRole, string> & { gloss: number };
export type Droop = { rotate: number; cx: number; cy: number } | { translate: [number, number] };
export type PartSpec =
  | { kind: 'path'; d: string; stroke?: ColorRole; strokeWidth?: number; fill?: ColorRole; opacity?: number; dash?: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: ColorRole; stroke?: ColorRole; strokeWidth?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: ColorRole; stroke?: ColorRole; strokeWidth?: number; rotate?: { deg: number; cx: number; cy: number } }
  | { kind: 'leaf'; x: number; y: number; dir: 1 | -1; shape: 'round' | 'pointed'; scale?: number; baseAngle: number; droopAngle: number }
  | { kind: 'petalRing'; cx: number; cy: number; count: number; rx: number; ry: number; dy: number; petalStrokeWidth?: number }
  | { kind: 'fruit'; cx: number; cy: number; r: number; stalk: string }
  | { kind: 'group'; parts: PartSpec[]; transform?: string; droop?: Droop };
export type PlantStageNum = 1 | 2 | 3 | 4 | 5;
export interface SpeciesArt { id: string; unlockAt: number; palette: SpeciesPalette; stages: Record<PlantStageNum, PartSpec[]> }
export const SPECIES: SpeciesArt[];                      // ordered by unlockAt; SPECIES[0].id === 'classic'
export function speciesOf(id: string | null | undefined): SpeciesArt;   // unknown/null → classic
export function unlockedSpecies(fruitsTotal: number): SpeciesArt[];
export function nextUnlock(fruitsTotal: number): SpeciesArt | null;     // null when all unlocked
export function newlyUnlocked(before: number, after: number): SpeciesArt[];
export const LOCKED_PALETTE: SpeciesPalette;             // grey silhouette: every fill '#C9C2B9', every ink '#8C857D', white '#FFFFFF', gloss 0
export function mix(a: string, b: string, t: number): string;           // moved here verbatim from plant-art.tsx
export const softOf: (hex: string) => string;            // mix(hex, '#FFFFFF', 0.72)
export const inkOf: (hex: string) => string;             // mix(hex, '#2E2419', 0.42)
```
- Consumes: `categoryColor` from `shared/tokens.ts` (the same call `mobile/components/garden/PlantArt.tsx` uses today, so hexes are guaranteed identical to both current renderers).

- [ ] **Step 1: Write the failing tests** in `test/garden-art.test.ts` (vitest style, mirror `test/quiz-image-questions.test.ts` imports):
```ts
import { describe, expect, it } from 'vitest';
import { SPECIES, speciesOf, unlockedSpecies, nextUnlock, newlyUnlocked } from '../shared/garden-art';

describe('garden-art registry', () => {
  it('classic is first, threshold 0, and the only threshold-0 species', () => {
    expect(SPECIES[0].id).toBe('classic');
    expect(SPECIES.filter((s) => s.unlockAt === 0)).toHaveLength(1); // the no-row guard in updatePlant depends on this
  });
  it('thresholds are the agreed ramp, strictly ascending', () => {
    expect(SPECIES.map((s) => s.unlockAt)).toEqual([0, 1, 2, 4, 6, 9, 12, 16, 20, 25]);
  });
  it('speciesOf falls back to classic on unknown/null', () => {
    expect(speciesOf('nope').id).toBe('classic');
    expect(speciesOf(null).id).toBe('classic');
  });
  it('unlock helpers agree with each other', () => {
    expect(unlockedSpecies(0).map((s) => s.id)).toEqual(['classic']);
    expect(nextUnlock(0)?.unlockAt).toBe(1);
    expect(nextUnlock(25)).toBeNull();
    expect(newlyUnlocked(0, 1)).toHaveLength(1);
    expect(newlyUnlocked(1, 1)).toHaveLength(0);
    expect(newlyUnlocked(3, 6).map((s) => s.unlockAt)).toEqual([4, 6]);
  });
  it('every species has all five stages with at least one part', () => {
    for (const s of SPECIES) for (const st of [1, 2, 3, 4, 5] as const) expect(s.stages[st].length).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2: Implement** the module: types + helpers above, the `mix/softOf/inkOf` trio moved verbatim from `src/garden/plant-art.tsx:37-60`, and — to make the tests meaningful before art exists — the 10 `SpeciesArt` entries with ids/thresholds `classic 0, cachua 1, huongduong 2, ot 4, dautay 6, xuongrong 9, xoai 12, quat 16, dao 20, mai 25`, where `classic` gets the REAL port (Step 3) and the other nine get a temporary copy of classic's stages with their own palettes (replaced in Tasks 7–9 — mark each with `// ART PENDING (Task 7|8|9)`).
- [ ] **Step 3: Port classic exactly.** Source of truth `src/garden/plant-art.tsx` — copy literals, do not retype from memory:
  - Palette: from `categoryColor` green/violet/orange hexes → `stem: inkOf(GREEN), leaf: GREEN, leafInk: inkOf(GREEN), petal: VIOLET, petalInk: inkOf(VIOLET), eye: '#F5C24B', eyeInk: inkOf('#F5C24B'), fruit: ORANGE, fruitInk: inkOf(ORANGE), seed: '#E3C08C', soilInk: '#6E472C', white: '#FFFFFF', gloss: 0.7`.
  - `stages[1]`: one `group` `{ transform: 'rotate(-14 48 51)' }` containing the seed ellipse `(48, 51, rx 5.8, ry 6.8, fill seed, stroke soilInk, strokeWidth 3.2)` and the crease path `M48 46.2 C46.5 48.4 46.5 52.4 47.8 55` (stroke soilInk, width 2, opacity 0.6).
  - `stages[2]`: stem path `M48 57 C46.4 52 49.2 47 48.6 42.4` (stroke stem, width 4.2) + two round leaves `(46.5, 42, dir -1)` and `(49.6, 43, dir 1)`, `baseAngle: -8, droopAngle: 40`.
  - `stages[3]`: stem `M48 57 C46 47.5 50.2 37 48.6 28.5` + four pointed leaves `(47,50,-1) (48.4,44,1) (49.6,37,-1) (49,31,1)`, `baseAngle: -20, droopAngle: 40`.
  - `stages[4]`: stem `M48 57 C50 47 46.5 36 42.5 27` + leaves `(47,51,-1) (48.6,45,1) (48.6,38,-1) (50,32,1)` (pointed, -20/40) + flower `group` `{ droop: { rotate: 24, cx: 42.5, cy: 27 } }` holding `petalRing (cx 41, cy 19, count 5, rx 5.4, ry 7.4, dy 7.2, petalStrokeWidth 3.2)` + eye `circle (41, 19, r 4.6, fill eye, stroke eyeInk, strokeWidth 3)` + bud `group` `{ droop: { rotate: 14, cx: 47.5, cy: 39.5 } }` holding stalk path `M47.5 39.5 C52.5 37 58.5 33.5 61.5 29` (stroke stem, 3.6), bud ellipse `(62.5, 25, rx 4.4, ry 5.8, fill petal, stroke petalInk, strokeWidth 3, rotate {16, 62.5, 25})`, sepals `M60.2 30 C58.4 28.8 57.8 27 58 25.6` and `M64.6 30.2 C66.6 29.2 67.4 27.4 67.2 26` (stroke stem, 2.6).
  - `stages[5]`: `[...stage4 stem+leaves, fruitGroup, flowerGroup, budGroup]` — fruits BEFORE flower (paint order is the array), fruit `group` `{ droop: { translate: [1, 3] } }` holding `fruit (27.5, 42, r 7, stalk 'M47 47 C41 42 33 37.5 28 35.5')` and `fruit (67, 44, r 6.5, stalk 'M48.6 43 C55 38.5 62.5 36.5 67 37.8')`. Build by spreading shared consts, not duplicating strings.
- [ ] **Step 4: Free checks.** `npm run typecheck && npm run lint`. (Unit test file written; suite run is the user's call.)
- [ ] **Step 5: Commit + push** (changelog: `feat(garden): shared species registry with classic port + unlock helpers`). Verify OTA.

---

### Task 3: Local SVG render harness (parity gate for everything after)

**Files:**
- Create: `scripts/render-plants.mjs`

**Interfaces:**
- Produces: `node scripts/render-plants.mjs --out <dir> [--species id] [--baseline <dir>]` → writes `<species>-s<stage>[-wilted|-dead|-locked].svg` files via `react-dom/server` `renderToStaticMarkup(PlantSvg(...))`, and with `--baseline` diffs current output against a saved directory, exiting 1 on any byte difference.

- [ ] **Step 1: Implement.** Node ESM script; import `PlantSvg` from `src/garden/plant-art.tsx` via `tsx` loader if plain node can't (check how other `scripts/*.mjs` load TS — `scripts/changelog.mjs` is plain; if no precedent, run through `npx tsx scripts/render-plants.mjs`). Render every species × stages 0–5 × {normal, wilted, dead} + locked palette, `size 96`.
- [ ] **Step 2: Capture the BASELINE from the CURRENT renderer before Task 4 touches it:**
```bash
npx tsx scripts/render-plants.mjs --out .baseline-plants --species classic
```
(`.baseline-plants/` is throwaway — do not commit; add nothing to .gitignore, just keep it out of `git add`.)
- [ ] **Step 3: Commit the script only** (changelog: `chore(garden): SVG render harness for plant art parity`). Free checks first. Verify OTA.

---

### Task 4: Web renderer → registry (classic pixel-identical)

**Files:**
- Modify: `src/garden/plant-art.tsx`
- Test: byte parity via the Task 3 harness (this IS the test for a pure refactor)

**Interfaces:**
- Produces: `PlantSvg({ stage, wilted, dead, potColor, species = 'classic', size, animateStageUp, className })` — new optional `species: string`, plus export `renderPartWeb` is NOT exposed (internal). `ClassTreeSvg`, `stageKey` unchanged.

- [ ] **Step 1: Refactor.** Delete the local `STEM/LEAVES/FRUITS/FLOWER_AT/STEM_TIP_4` tables, `LIVE` palette and `mix/softOf/inkOf` (import from `shared/garden-art`). Keep ALL chrome: `Pot, Soil, Mound, SoilLip, Sparkle`, the empty-pot hint, the entire dead drawing, wilt CSS classes, sway/pop class logic, whole-plant droop `rotate(7 48 57)`. Add an internal `renderPart(part: PartSpec, p: SpeciesPalette, droop: boolean): ReactElement` switch:
  - `path/circle/ellipse` → direct elements (ellipse `rotate` → `transform="rotate(deg cx cy)"`).
  - `leaf` → the existing `Leaf` component with `angle = droop ? part.droopAngle : part.baseAngle`, `round = shape === 'round'`, colors from roles `leaf`/`leafInk`.
  - `petalRing` → the existing `Flower` petal loop generalized: `count` petals at `rotate(i*360/count cx cy)`, each `ellipse (cx, cy - dy, rx, ry, fill petal, stroke petalInk, strokeWidth petalStrokeWidth ?? 3.2)`. (Eye is a separate `circle` part in the data — remove the eye from the old `Flower`.)
  - `fruit` → existing `Fruit` component (keeps the computed gloss path, `p.gloss`).
  - `group` → `<g>` with `transform` always applied and droop transform applied only when drooping: `{rotate,cx,cy}` → `rotate(r cx cy)`, `{translate:[x,y]}` → `translate(x y)`; both compose after the group's own `transform`.
  - DEAD palette: keep as-is (chrome); dead drawing ignores species by design.
- [ ] **Step 2: Parity gate.**
```bash
npx tsx scripts/render-plants.mjs --out .current-plants --species classic --baseline .baseline-plants
```
Expected: exit 0, zero diffs across stages 0–5 × normal/wilted/dead. Any diff = fix the renderer, not the baseline.
- [ ] **Step 3: Free checks** (`npm run typecheck && npm run lint`).
- [ ] **Step 4: Commit + push** (changelog: `refactor(garden): web plant art renders from the shared registry`). Verify OTA. Note to user: worker/e2e suites untouched by this task; nothing to offer.

---

### Task 5: Mobile renderer → registry

**Files:**
- Modify: `mobile/components/garden/PlantArt.tsx`

**Interfaces:**
- Produces: mobile `PlantSvg` gains the same optional `species: string` prop. WILTED palette becomes a function `wiltedOf(p: SpeciesPalette): SpeciesPalette` using the same bake it applies to LIVE today.

- [ ] **Step 1: Refactor.** Same shape as Task 4 with the RN mappings the file already documents (header comment, lines 16–41): explicit `fill="none"` on stroke-only shapes, explicit `strokeWidth`, `{rotate,cx,cy}` → `<G rotation={deg} origin={"cx, cy"}>`, translate/scale transform strings pass through. Delete the duplicated geometry tables and color math; import from `@mochi/shared/garden-art` (same alias `use-garden.ts` uses for shared imports). Keep chrome + Reanimated wrapper untouched.
- [ ] **Step 2: Free checks.** `cd mobile && npm test` (must pass — it exercises lib logic that imports shared) and `npx tsc --noEmit` in mobile if configured (check `mobile/package.json` scripts; use the existing script name).
- [ ] **Step 3: Commit + push** (changelog: `refactor(mobile): plant art renders from the shared registry`). Verify OTA workflow — this one MATTERS (phones re-render the garden from this bundle); if the workflow fails, publish manually per Global Constraints.

---

### Task 6: API + guard (species is now settable)

**Files:**
- Modify: `shared/schemas.ts` (PlantPatchInput ~1286), `server/services/garden.ts` (updatePlant ~917), `app/routes/api.garden.plant.tsx`, `app/routes/flashcards.tsx` (loader + `plant-update` action), `shared/api-contract.ts` (GardenPlantResponse), `mobile/lib/types.ts` (GardenPlantResponse mirror), `server/api/docs/registry.ts` (~966), `docs/api.md` (garden section)
- Test: `test-worker/garden.test.js`

**Interfaces:**
- Produces: `PlantPatchInput.species?: string`; `updatePlant` returns `{ ok: true } | { ok: false; error: 'growing' | 'locked' | 'unknown_species' }` (was `void` — update BOTH existing callers to ignore/propagate); `GardenPlantResponse.species: string`.

- [ ] **Step 1: Failing tests** in `test-worker/garden.test.js`, using the file's own helpers (`db()`, `seedTopic`, `seedClassWithStudent`, `play`) — note `play` twice in one day reaches stage 2 (the cap test at ~line 97 proves it), and `devSetPlant` needs a staff id:
```js
describe('species patch guard', () => {
  it('seed accepts unlocked, rejects locked; growing rejects outright', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { student } = await seedClassWithStudent(d);
    await play(d, student.id, topic.id); // creates the row at stage 1 (seed)
    expect(await gardenSvc.updatePlant(d, student.id, { species: 'cachua' })) // 0 fruit
      .toMatchObject({ ok: false, error: 'locked' });
    expect(await gardenSvc.updatePlant(d, student.id, { species: 'classic' })).toMatchObject({ ok: true });
    await play(d, student.id, topic.id); // stage 2 — window closed
    expect(await gardenSvc.updatePlant(d, student.id, { species: 'classic' }))
      .toMatchObject({ ok: false, error: 'growing' });
  });

  it('harvest re-seeds to stage 1 and the new fruit unlocks a switch', async () => {
    const d = db();
    const { student } = await seedClassWithStudent(d);
    const staff = await peopleSvc.createStaff(d, {
      name: 'Dev', email: `s${crypto.randomUUID()}@test.com`, role: 'Teacher',
    });
    await gardenSvc.devSetPlant(d, staff.id, { studentId: student.id, stage: 5, idleDays: 0 });
    const h = await gardenSvc.harvest(d, student.id);
    expect(h).toMatchObject({ ok: true, fruitsTotal: 1 }); // plant is back at stage 1
    expect(await gardenSvc.updatePlant(d, student.id, { species: 'cachua' })).toMatchObject({ ok: true });
    expect((await gardenSvc.getPlant(d, student.id)).species).toBe('cachua');
    expect(await gardenSvc.updatePlant(d, student.id, { species: 'mai' })) // needs 25
      .toMatchObject({ ok: false, error: 'locked' });
  });

  it('dead accepts, unknown id rejects, and no row means no write', async () => {
    const d = db();
    const { student } = await seedClassWithStudent(d);
    const staff = await peopleSvc.createStaff(d, {
      name: 'Dev2', email: `s${crypto.randomUUID()}@test.com`, role: 'Teacher',
    });
    await gardenSvc.devSetPlant(d, staff.id, { studentId: student.id, stage: 0, idleDays: 0 }); // dead pot
    expect(await gardenSvc.updatePlant(d, student.id, { species: 'classic' })).toMatchObject({ ok: true });
    expect(await gardenSvc.updatePlant(d, student.id, { species: 'khong-co' }))
      .toMatchObject({ ok: false, error: 'unknown_species' });
    const { student: fresh } = await seedClassWithStudent(d); // never played: no row
    expect(await gardenSvc.updatePlant(d, fresh.id, { species: 'classic' })).toMatchObject({ ok: true });
    expect(await gardenSvc.updatePlant(d, fresh.id, { species: 'cachua' }))
      .toMatchObject({ ok: false, error: 'locked' });
    expect(await gardenSvc.getPlant(d, fresh.id)).toBeNull(); // still no row — 'classic' was a no-op
  });
});
```
- [ ] **Step 2: Schema.** `species: z.string().min(1).max(20).optional()` in PlantPatchInput (id validity is a registry concern, checked in the service — same philosophy as potColor's free-form string).
- [ ] **Step 3: Guard in `updatePlant`.**
```ts
if (patch.species !== undefined) {
  const art = speciesOf(patch.species);
  if (art.id !== patch.species) return { ok: false, error: 'unknown_species' };
  const record = await getPlant(db, studentId);
  if (!record) {
    // No row = empty pot = provably 0 lifetime fruit: only 'classic' is unlocked, and the
    // DEFAULT stamps it when the first play creates the row — nothing to persist.
    return patch.species === 'classic' ? { ok: true } : { ok: false, error: 'locked' };
  }
  const settings = await getGardenSettings(db);
  const view = plantView(record.state, settings, ictDateOf(new Date().toISOString())); // settle in memory: a long-neglected row must count as dead
  if (!view.dead && view.stage >= 2) return { ok: false, error: 'growing' };            // stage 1 = the planting/replant window
  if (art.unlockAt > record.state.fruitsTotal) return { ok: false, error: 'locked' };   // stored value, never client-sent
  set.species = patch.species;
}
```
(Existing plantName/potColor branches unchanged; return `{ ok: true }` at the end.)
- [ ] **Step 4: Routes.** `api.garden.plant.tsx` PATCH: map `{ok:false}` to 400 with the error code in the body (match the harvest route's error shape); success returns `loadPlant()` which now includes `species: plant?.species ?? 'classic'`. `flashcards.tsx` `plant-update` action: same mapping; loader's garden payload gains `species`.
- [ ] **Step 5: Contracts + docs.** `GardenPlantResponse.species: z.string()` in api-contract; mirror `species: string` in `mobile/lib/types.ts` GardenPlantResponse; OpenAPI registry PATCH op notes the three error codes; `docs/api.md` garden section gains two lines (field + guard rule).
- [ ] **Step 6: Free checks**, then **commit + push** (changelog: `feat(garden): species is patchable with seed/dead/unlock guard`). One-line note to user: `npm run test:worker` now has new specs if they want a run. Verify OTA.

---

### Task 7: Species art — garden tier (cà chua, hướng dương, ớt)

**Files:**
- Modify: `shared/garden-art.ts` (replace the three `// ART PENDING (Task 7)` stage sets)

This is creative authoring — the deliverable is judged visually, not by unit test. Hard constraints carried from the classic drawing: 96×96 box, root at (48, 57), everything clears the pot rim (y ≥ 56 only near the root), left/right never exact mirrors (the hand-drawn look), stage silhouettes must GROW (each stage strictly adds/extends), strokeLinecap round, weights ~3.2–4.2 like classic.

- [ ] **Step 1: Palettes.** Real hexes via the registry's own `mix/inkOf` from `categoryColor` bases:
  - `cachua`: leaf green, petal `#FFF3C9` w/ yellow eye, fruit RED `#E0533D` (ink via inkOf), gloss 0.8.
  - `huongduong`: petal `#F5C24B` (yellow IS the point), eye `#6E472C` (brown disc), fruit = the seed head (same disc, bigger), gloss 0.
  - `ot`: petal white `#F7F3EC`, fruit `#D93A2B`, slim pods drawn as `path` parts (filled, stroked) pointing up — the one species whose "fruit" primitive is `path`, not `fruit` (no gloss on pods).
- [ ] **Step 2: Stages.** Author each species' stages 2–5 (stage 1 = classic's seed group with the species' `seed` hex, spread from a shared `SEED_PARTS(palette-agnostic)` const). Keep classic's stage-2 cotyledon pattern where sensible (a sprout is a sprout) but vary leaf counts/curves from stage 3 on. Flower/bud anchors and droop pivots are hand-placed per the spec's authoring note.
- [ ] **Step 3: Render + eyeball.**
```bash
npx tsx scripts/render-plants.mjs --out .preview --species cachua
npx tsx scripts/render-plants.mjs --out .preview --species huongduong
npx tsx scripts/render-plants.mjs --out .preview --species ot
```
Send the SVGs to the user for approval (SendUserFile, render). Iterate on feedback before committing. Classic parity re-run (`--species classic --baseline .baseline-plants`) must still pass — the registry edit must not touch classic.
- [ ] **Step 4: Free checks, commit + push** (changelog: `feat(garden): tomato, sunflower, chili species art`). Verify OTA.

### Task 8: Species art — houseplant tier (dâu tây, xương rồng, xoài)

Same steps as Task 7 (files, constraints, harness, user eyeball, classic parity, free checks, commit `feat(garden): strawberry, cactus, mango species art`, OTA). Composition notes:
- `dautay`: LOW habit — widest silhouette, no tall stem; trifoliate leaves near the soil, white 5-petal rings, stage 5 = three small hanging berries (`fruit` r ~4) with visible achene dots (tiny `circle` parts, `eyeInk`).
- `xuongrong`: NO `leaf` parts at all — a fat main pad (filled `path`, stroke leafInk) growing side pads per stage; stage 4 = one `petalRing` crown (rose/pink) on the top pad; stage 5 adds 2 small round red fruits sitting ON pads (no stalks — `circle` parts, not `fruit`, since cactus fruit has no hanging stalk). Droop for a cactus: pads use `{rotate}` droops with pivots at their base joints (a wilted cactus leans, it doesn't droop leaves).
- `xoai`: tree silhouette — trunk (stem-colored path, weight 5) forking into 2–3 branches, long slender leaves (pointed, scale ~1.1), stage 4 = a panicle (cluster of tiny `circle`s, petal color) instead of one flower, stage 5 = two hanging mangoes (`fruit` with rx-ish look: use `ellipse` fill fruit + separate stalk `path`, since mango isn't round — accept `ellipse` + `path` over the `fruit` primitive, gloss skipped).

### Task 9: Species art — Tết tier (quất, đào, mai)

Same steps (commit `feat(garden): kumquat, peach and apricot blossom species art`). Composition notes:
- `quat`: dense round canopy (overlapping `circle`s leaf/leafInk like ClassTreeSvg's outline-then-fill trick — order strokes first, fills after, within the parts array), stage 5 = MANY small oranges (`circle` r 2.5–3, fruit color, ~7 of them) studding the canopy — abundance is the point.
- `dao`: elegance by restraint — bare dark branches (stem paths, weight 3.4), few leaves, stage 4 = first pink `petalRing`s (count 5, rx 2.2), stage 5 = full bloom, 6–8 blossom rings + buds; NO fruit primitive at all ("fruit" stage = full bloom, per spec).
- `mai`: same skeleton as đào (shared consts fine, different branch curves — never byte-identical) with golden `#F5C24B` five-petal blossoms.

---

### Task 10: Snapshot / album / share-card / assessments ride-along

**Files:**
- Modify: `shared/logic/garden.ts` (GardenSnapshotMember ~683), `server/services/garden.ts` (classGarden ~1258, GardenMember ~1166, snapshotMonth map ~1313, GardenMonthSummary + emptyGardenMonth ~1058/1086, gardenMonthByStudent fill ~1153), `shared/api-contract.ts` (GardenMemberRow, GardenSnapshotMember), `mobile/lib/types.ts` (GardenMemberRow mirror), `src/garden/class-garden.tsx` (member card ~363, album mapping ~843), `src/garden/share-card.tsx` (~342), `src/screens-assessments.tsx` (~266), `mobile/components/garden/MemberCard.tsx` (~99), `mobile/components/garden/RoundGardenNote.tsx`
- Test: `test-worker/garden.test.js`

**Interfaces:**
- Produces: `species: string` on `GardenMember`, `GardenSnapshotMember`, `GardenMemberRow`, `GardenMonthSummary`; every `PlantSvg` call site passes `species`.

- [ ] **Step 1: Failing test:** extend the existing snapshot test in `test-worker/garden.test.js` (find the `snapshotMonth` describe):
```js
// inside the existing snapshot round-trip test, after getSnapshot():
expect(snap.data.members[0].species).toBe('classic'); // snapshotMonth must map the field explicitly

// new case — a pre-0050 blob (no species key) reads as classic through classGarden's projection:
it('classGarden defaults species to classic on the leftJoin miss', async () => {
  const d = db();
  const { cls, student } = await seedClassWithStudent(d); // never played: no plant row
  const garden = await gardenSvc.classGarden(d, cls.id, ictDateOf(new Date().toISOString()));
  expect(garden.members[0]).toMatchObject({ studentId: student.id, species: 'classic' });
});
```
The pre-0050 album blobs themselves are defended at the CONSUMER boundary (`?? 'classic'` where snapshot JSON is read in `class-garden.tsx`/album), not in the DB.
- [ ] **Step 2: Implement** the field everywhere listed, with `?? 'classic'` at every leftJoin/JSON-parse boundary (`classGarden`'s member map, album/snapshot consumers, `emptyGardenMonth`). UI sites: add `species={...}` to each `PlantSvg` call (grep for `<PlantSvg` on both platforms — every call site must pass it or the plant silently reverts to classic).
- [ ] **Step 3: Free checks** (+ `cd mobile && npm test`), **commit + push** (changelog: `feat(garden): species rides through class garden, albums, share card, reports`). Verify OTA.

---

### Task 11: Web picker + i18n + e2e

**Files:**
- Modify: `src/garden/garden-widget.tsx` (modal ~334, edit-button gating ~203), `shared/i18n/strings.ts`
- Test: `e2e/crud-garden2.spec.ts`

**Interfaces:**
- Consumes: `SPECIES`, `unlockedSpecies`, `nextUnlock`, `LOCKED_PALETTE`, `speciesOf`; `StudentGardenData.species` (Task 6 loader).
- Produces: i18n keys `garden_species` ("Loài cây" / "Plant species"), `garden_species_locked_n` ("Còn {n} quả nữa" / "{n} more fruits"), `garden_species_growing_hint` ("Cây đang lớn — đổi loài khi trồng lại" / "Growing — switch species when you replant"), `garden_species_<id>` ×10 (vi/en names from the spec's species table).

- [ ] **Step 1: Failing e2e** (written, not run): in `crud-garden2.spec.ts`'s plant lifecycle test, after opening the "Name your plant" dialog assert: the species section is visible, `classic`'s card is selected, a locked card shows the fruits-remaining text; then (using the dev-tools pattern from `crud-garden3.spec.ts` to reach a seed-stage plant with ≥1 fruit) pick the second species, save, `await posted('/vocabulary')` per `e2e/crud-helpers.ts`, and assert the widget re-rendered. Follow the helper kit — locate structurally, no `name=` attributes.
- [ ] **Step 2: i18n** keys above, en + vi, `{n}` interpolation matching the file's existing count-string convention (copy whichever pattern `garden_drop_warning` uses). `npm run check:i18n` must pass.
- [ ] **Step 3: Picker UI.** In the modal, above the pot `ColorPicker`: a wrapping grid of species cards (~56px `PlantSvg stage=5` minis). Unlocked: normal palette, ring on selected (reuse the `.m-swatch` selected treatment for consistency). Locked: `LOCKED_PALETTE` render + name + `garden_species_locked_n` with `n = unlockAt - fruitsTotal`. Section enabled iff `!hasPlant || view.dead || view.stage === 1`, else render the same grid disabled with `garden_species_growing_hint`. Submitting adds `species` to the existing `plant-update` FormData. Also: when `!hasPlant`, the modal must now be reachable (adjust the ~203 gating) as a browsable roster — classic selected, no PATCH sent on save without changes.
- [ ] **Step 4: Free checks, commit + push** (changelog: `feat(garden): species picker with locked previews (web)`). One line to user: e2e spec added — staging run is yours to trigger. Verify OTA.

### Task 12: Mobile picker

**Files:**
- Modify: `mobile/components/garden/GardenWidget.tsx` (modal ~276), `mobile/lib/use-garden.ts` (pass species in patch — type-only if the patch type already flows)

Same UI contract as Task 11 (grid above the mobile `ColorPicker`, locked silhouettes, growing hint, strings come from the shared i18n added in Task 11). React Query mutation already sends `PlantPatchInput` — just include `species`.

- [ ] **Step 1: Implement** the picker section (RN `Pressable` grid, 56dp minis, hitSlop like `ColorPicker`'s 48dp rule).
- [ ] **Step 2:** `cd mobile && npm test` + mobile typecheck, **commit + push** (changelog: `feat(garden): species picker (mobile)`). Verify OTA carefully — this is the user-facing mobile change; publish manually if the workflow quota is out.

### Task 13: Unlock celebration + replant prompt (both clients)

**Files:**
- Modify: `src/garden/garden-widget.tsx` (harvest handler), `mobile/components/garden/GardenWidget.tsx` (same), `shared/i18n/strings.ts` (`garden_unlock_title` "Mở khóa cây mới!" / "New plant unlocked!", `garden_replant_as` "Trồng lại thành…" / "Replant as…", `garden_replant_skip` "Để sau" / "Not now")
- Test: `e2e/crud-garden2.spec.ts`

**Interfaces:**
- Consumes: `newlyUnlocked(before, after)` — `before` = the plant's `fruitsTotal` in client state pre-harvest, `after` = the harvest response's `fruitsTotal` (both endpoints already return it).

- [ ] **Step 1: Failing e2e:** extend the harvest section of the lifecycle test — harvesting the first fruit (0 → 1 crosses the `cachua` threshold) must show the unlock beat (species name visible) and a "replant as" affordance; choosing it sends the species PATCH (`await posted(...)`) and the widget shows the new species; dismissing keeps classic (second scenario via dev-reset).
- [ ] **Step 2: Implement web:** in the existing harvest celebration UI, when `newlyUnlocked(...).length > 0` add the unlock beat (each new species' stage-5 mini + name) and a compact replant row: unlocked species minis (newly-unlocked highlighted), tap → the normal `plant-update` PATCH with `species` (the stage-1 guard accepts it — harvest just re-seeded), skip button dismisses. No server changes.
- [ ] **Step 3: Implement mobile:** same beat in the mobile harvest flow, PATCH via `useUpdatePlant`.
- [ ] **Step 4: Free checks (+ mobile test), commit + push** (changelog: `feat(garden): harvest unlock celebration + replant prompt`). Verify OTA. Final one-liner to user: full feature is live pending your suite runs (`test:worker`, `test:e2e:staging`) whenever you want them.

---

## Self-Review (run after writing, fixed inline)

- **Spec coverage:** thresholds/species table → Tasks 2, 7–9; registry+helpers → 2; renderers → 4, 5; guard+API → 6; ride-along+albums (`?? 'classic'`) → 10; picker+locked previews → 11, 12; celebration+replant → 13; i18n → 11, 13; migration+dormant companion → 1; e2e/tests in-commit → 6, 10, 11, 13; out-of-scope list respected (no class-tree task, no pets UI, no sticker-book). ✓
- **Placeholder scan:** the nine `// ART PENDING` stubs in Task 2 are explicitly temporary with named replacing tasks (7–9) — allowed; art tasks specify palettes, primitives, composition constraints and an approval loop rather than fake coordinates. No TBDs elsewhere. ✓
- **Type consistency:** `speciesOf/unlockedSpecies/nextUnlock/newlyUnlocked/LOCKED_PALETTE/SpeciesArt/PartSpec` used identically in Tasks 4–13 as defined in Task 2; `updatePlant`'s new return shape is consumed in Task 6's routes; `GardenPlantResponse.species` (Task 6) precedes picker use (Task 11). ✓
- **Ordering:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → {7,8,9 any order} → 10 → 11 → 12 → 13. Tasks 4/5 depend on 2+3; 10–13 depend on 6; 11's e2e uses dev tools that exist today. ✓

## Verification (end-to-end)

- Per task: `npm run typecheck`, `npm run lint`, `npm run check:i18n`, `cd mobile && npm test` (mobile tasks), classic parity via `scripts/render-plants.mjs --baseline`, species previews eyeballed by the user before each art commit.
- Live web check after Task 11: cookie-auth recipe from memory (`live-verify-authed-pages`) against the student account `vunq@mochi.edu / mochi123` — load `/vocabulary`, confirm the picker renders and a locked card shows the remaining-fruit count.
- Mobile delivery after Tasks 5/12/13: the `curl -s -H "expo-platform: android" …` manifest check from CLAUDE.md — `gitSha` must equal the pushed commit (read runtimeVersion from `shared/version.json`).
- Suites (user-triggered only): `npm run test:worker` for the guard/snapshot tests; `npm run test:e2e:staging` for the two extended garden specs. Baseline is ZERO failures (memory), so any red is real.
- Prod D1: `npx wrangler d1 migrations list mochi-class --remote` after Task 1.
