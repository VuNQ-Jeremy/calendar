# Garden plant species — variety, unlocks, and the shared art registry

## Context

The vocabulary garden has exactly one plant drawing: a hand-authored parametric SVG
([src/garden/plant-art.tsx](f:\code\calendar\src\garden\plant-art.tsx)) with six stages plus
wilted/dead variants, hand-ported byte-for-byte to react-native-svg
([mobile/components/garden/PlantArt.tsx](f:\code\calendar\mobile\components\garden\PlantArt.tsx)).
The user wants **a variety of tree species** students can collect, and later **pets**. Decisions
made during brainstorming (all confirmed by the user):

- **No 3rd-party assets, no AI image generation** (paid path — untouchable per CLAUDE.md). All art
  stays hand-authored SVG in-repo.
- **Unlock by progress**: species unlock at **lifetime `fruitsTotal`** thresholds — already stored
  per plant, never resets, so unlock state is **derived at read time, zero new bookkeeping**.
- **~10 species, big collection**, flavours: VN garden & fruit plants + all three Tết plants
  (đào, mai vàng, quất) + classic houseplants. No fantasy tier.
- **Current drawing = starter species `classic`**; existing rows migrate to it, nothing changes
  visually on update day.
- **Species chosen at planting** (no plant / empty pot / dead plant), plus a one-time
  **"replant as…" prompt in the harvest celebration** — harvest re-seeds the plant to stage 1,
  so that's the natural re-plant moment (and the moment a new unlock lands). A growing plant
  (stage ≥ 2) keeps its species.
- **Smooth ramp thresholds**: 0, 1, 2, 4, 6, 9, 12, 16, 20, 25 fruits.
- **Picker with locked previews**: grey stage-5 silhouette + name + "còn X quả", inside the
  existing "Name your plant" modal on both clients. No new screen.
- **Unlock celebrated at harvest** (the moment it's earned) on both clients. No push.
- **Class tree unchanged.**
- **Web + mobile ship together**; geometry moves to `shared/` as plain data with a thin renderer
  per platform, so each species (and future pets) is drawn **once**.
- **One generic dead drawing** for all species (current snapped stalk). Wilt is already generic
  (transforms + desaturation).
- **Pets: reserve schema now** — dormant `companion TEXT` column in the same migration; no pet
  UI/logic.

## The species set (10, with thresholds)

| # | id | Name (vi / en) | Unlock at | Art notes |
|---|----|----|----|----|
| 1 | `classic` | Cây cổ điển / Classic | 0 (starter) | Existing drawing, untouched |
| 2 | `cachua` | Cà chua / Tomato | 1 | Vine-ish stem, yellow flowers → red round fruits |
| 3 | `huongduong` | Hướng dương / Sunflower | 2 | Tall stem, one giant yellow head as the "flower", seeds head at 5 |
| 4 | `ot` | Ớt / Chili | 4 | Small white flowers → slim red pods pointing up |
| 5 | `dautay` | Dâu tây / Strawberry | 6 | Low mound habit, white flowers → hanging red berries |
| 6 | `xuongrong` | Xương rồng / Cactus | 9 | Pads instead of leaves, one pink crown flower, small red fruits |
| 7 | `xoai` | Xoài / Mango | 12 | Small tree silhouette, panicle blossom → two hanging mangoes |
| 8 | `quat` | Quất / Kumquat | 16 | Tết tier — round canopy dense with small oranges |
| 9 | `dao` | Đào / Peach blossom | 20 | Tết tier — bare elegant branches, pink blossom clusters (stage 5 = full bloom; "fruit" = blossoms) |
| 10 | `mai` | Mai vàng / Apricot blossom | 25 | Top prestige — golden five-petal blossoms |

Stage semantics identical for all species (1 seed → 2 sprout → 3 young → 4 flowering →
5 fruit/full bloom); only the art varies. Harvest/lifecycle rules unchanged.

## Architecture

### 1. Migration `0050_garden_species.sql`
- `ALTER TABLE garden_plants ADD COLUMN species TEXT NOT NULL DEFAULT 'classic';`
- `ALTER TABLE garden_plants ADD COLUMN companion TEXT;` — dormant, reserved for pets.
- Mirror in [server/db/schema.ts:1217](f:\code\calendar\server\db\schema.ts) (gardenPlants).
- No `scripts/test-accounts.sql` change (no new table).
- Per memory: after push, verify `d1 migrations list mochi-class --remote` and apply by hand if
  the Actions run was cancelled.

### 2. Shared species registry — `shared/garden-art.ts` (new)
Plain-data registry both renderers consume (the pattern `shared/logic/garden.ts` set for rules):
- `SPECIES`: ordered array `{ id, unlockAt, palette, stages }`.
- Pure helpers: `speciesOf(id)` (unknown id → `classic`), `unlockedSpecies(fruitsTotal)`,
  `nextUnlock(fruitsTotal)`, `newlyUnlocked(before, after)` (for the harvest celebration).
- Geometry as part-primitive lists per stage; pot/soil/mound/empty-pot hint/dead drawing stay
  platform chrome outside the registry (dead is generic by decision anyway).
- Part primitives (validated against the current drawing by the Plan agent):
  `path` (d, stroke/fill color-roles, width, opacity, dash) · `circle` · `ellipse` (optional
  rotate with explicit cx/cy) · `leaf` (x, y, dir, shape round|pointed, scale, `baseAngle` +
  `droopAngle` — encodes the current conditional as data) · `petalRing` (centre, count, petal
  rx/ry/dy — classic flower = count 5; sunflower = one big ring; đào/mai = several tiny rings on
  branch paths) · `fruit` (cx, cy, r, stalk — gloss stays renderer-computed from r and
  `palette.gloss`) · `group` (parts, transform, droop).
  Droop is a union `{rotate, cx, cy} | {translate}` attached per part/group — explicit origins
  are what make the RN mapping trivial (`<G rotation origin>` vs web's 3-arg rotate string); the
  fruits' `translate(1 3)` droop is why rotate-only doesn't suffice.
- `SpeciesArt = { id, threshold, palette (literal hexes + gloss), stages: Record<1..5, PartSpec[]> }`;
  paint order = array order; stage 5 reuses stage 4's stem/leaves by spreading arrays at module
  definition (plain data, no inherit machinery).
- Renderer chrome that stays out of the data: whole-plant droop rotate, web CSS desaturation vs
  mobile baked WILTED palette, sway/pop animations.
- Locked silhouette = same geometry with every color role mapped to one grey pair + `gloss: 0`
  (exactly how DEAD already works) — zero extra drawings.
- Authoring note: stage-4 flower/bud anchors and droop pivots are hand-tuned to the stem curve
  (no derivable "stem tip") — each species author places them by hand; document in the registry.

### 3. Thin renderers
- Web [src/garden/plant-art.tsx](f:\code\calendar\src\garden\plant-art.tsx): `PlantSvg` gains
  `species` prop, maps PartSpecs → DOM SVG. Colors stay literal hexes (html-to-image constraint).
- Mobile [mobile/components/garden/PlantArt.tsx](f:\code\calendar\mobile\components\garden\PlantArt.tsx):
  same mapping → react-native-svg (explicit `fill="none"`, `<G rotation origin>` for 3-arg
  rotates, baked WILTED palette). Reanimated wrapper untouched.
- **Gate: the `classic` port must be pixel-identical before any new species is drawn** (screenshot
  compare web; the RN twin re-reads the same data).

### 4. Species selection & guard
Lifecycle facts the guard leans on (verified in shared/logic/garden.ts): no row IS the empty pot
(the first qualifying play or a teacher's watering creates the row at stage 1); death keeps the
row (`stage 0, isDead`) and the next play *revives* it — `fruitsTotal`, `plantName`, `potColor`
(and now `species`) all survive death.

- **No upsert.** With no row, lifetime fruit is provably 0, so only `classic` is unlocked, and
  `DEFAULT 'classic'` stamps it when the first play creates the row — nothing to persist. (This
  breaks if a second threshold-0 species is ever added — noted in the registry.)
- `PlantPatchInput` ([shared/schemas.ts:1286](f:\code\calendar\shared\schemas.ts)) gains
  `species: z.string().min(1).max(20).optional()`, validated against the registry id list.
- `updatePlant` ([server/services/garden.ts:917](f:\code\calendar\server\services\garden.ts)),
  when `species` present: settle **in memory** via `plantView` (a plant that died weeks ago but
  whose row still says stage 3 must count as dead), then allow iff
  **`!record || view.dead || view.stage === 1`** — stage 1 is exactly the post-harvest re-seed
  and post-revive window, and it closes on the next qualifying play (which grows 1 → 2). Unlock
  check `threshold(species) <= (row?.fruitsTotal ?? 0)` — always the stored row's value, never
  client-sent. UX intent: the choice is *surfaced* at the harvest celebration (and in the modal
  when empty/dead); the modal picker shows as locked-in during stages 2–5 with a hint.
- `transitionOps` must keep excluding `species` from its values (as it already excludes
  `plantName`/`potColor`) so revive/grow never clobbers it.
- Touch points: web action `plant-update` in
  [app/routes/flashcards.tsx:199](f:\code\calendar\app\routes\flashcards.tsx),
  [app/routes/api.garden.plant.tsx](f:\code\calendar\app\routes\api.garden.plant.tsx) (same guard
  for both), OpenAPI registry
  [server/api/docs/registry.ts:966](f:\code\calendar\server\api\docs\registry.ts) + docs/api.md.
- Web note: the edit button hides when `!hasPlant` ([garden-widget.tsx:203](f:\code\calendar\src\garden\garden-widget.tsx));
  for an empty pot the modal opens as a browsable roster (classic selected, rest locked) without
  a PATCH. Mobile mirrors.

### 5. Serialization ride-along (`species` field)
- `GardenPlantResponse`, `GardenMemberRow`, `GardenSnapshotMember` in
  [shared/api-contract.ts](f:\code\calendar\shared\api-contract.ts) (+ `shared/logic/garden.ts:683`).
- `snapshotMonth()` explicit member map ([server/services/garden.ts:1313](f:\code\calendar\server\services\garden.ts))
  — albums silently lose the field otherwise.
- `classGarden()` projection (leftJoin miss → `'classic'`), `GardenMonthSummary` /
  `emptyGardenMonth`, `loadPlant` in the flashcards route and api.garden.plant.
- Hand-written mobile mirrors [mobile/lib/types.ts:388-410](f:\code\calendar\mobile\lib\types.ts).
- **Pre-0050 frozen album blobs lack the field**: every consumer defaults `species ?? 'classic'`
  — correct, since classic is what those plants were.

### 6. Picker UI (both clients, same modal)
- Web [src/garden/garden-widget.tsx:334](f:\code\calendar\src\garden\garden-widget.tsx) and mobile
  [mobile/components/garden/GardenWidget.tsx:276](f:\code\calendar\mobile\components\garden\GardenWidget.tsx):
  species grid above the pot ColorPicker — unlocked: mini stage-5 art, selected ring; locked:
  grey silhouette + name + "còn X quả"; section disabled (explanatory hint) while a live plant is
  growing.
- Read-only render sites just pass `species` through: class-garden, share-card,
  screens-assessments, MemberCard, RoundGardenNote, album.

### 7. Unlock celebration + replant prompt
- Harvest already returns `fruitsTotal`; client computes `newlyUnlocked(before, after)` and adds
  an unlock beat (new species art + name) to the existing harvest celebration on both clients.
- The celebration also offers **"replant as…"**: a compact species row (unlocked ones, newly
  unlocked highlighted); choosing one sends the normal species PATCH, which the stage-1 guard
  accepts. Skippable — dismissing keeps the current species. No server change beyond §4.

### 8. i18n
- `garden_species_<id>` ×10 + picker strings (`garden_species`, locked-count template, unlock
  toast) in [shared/i18n/strings.ts](f:\code\calendar\shared\i18n\strings.ts), en + vi (vi typed
  against MsgKey, so missing = type error). Dynamic-key precedent: `garden_title_${id}`.

### 9. Tests (write in-commit; suites run only on user request per CLAUDE.md)
- `test-worker/garden.test.js`: species round-trip, guard (growing plant rejects change; locked
  species rejects), snapshot carries species.
- Unit test for `shared/garden-art.ts` helpers (thresholds, newlyUnlocked edges).
- e2e: extend [e2e/crud-garden2.spec.ts](f:\code\calendar\e2e\crud-garden2.spec.ts) plant
  lifecycle — picker visible in dialog, starter selected, locked previews present; drive stages
  via dev tools (crud-garden3 pattern). Helper kit `e2e/crud-helpers.ts` conventions apply.
- Mobile: `cd mobile && npm test` additions only if `mobile/lib/` logic changes (types are
  type-only).

## Phasing (each commit pushes to main + changelog + OTA verify; phases 2–4 order-free after 1; 5 precedes 6–8)

1. **Migration 0050** (`species` default `'classic'`, dormant `companion`) + schema.ts +
   `PlantRecord`/`rowToState` passthrough. Commitable: nothing reads it yet.
2. **Shared registry** (`shared/garden-art.ts`): PartSpec types, classic port, thresholds,
   `speciesOf`/`unlockedSpecies`/`nextUnlock`/`newlyUnlocked` + unit tests. Unused module.
3. **Web renderer refactor** onto the registry, with an SVG-output parity test for classic.
   Pure refactor.
4. **Mobile renderer refactor** likewise (+ OTA verification ritual).
5. **API/service**: `PlantPatchInput.species`, `updatePlant` guard, ride-along in
   `loadPlant`/`classGarden`/month summary, OpenAPI registry + docs/api.md. Clients ignore
   unknown fields.
6. **New species art** as registry entries (batched commits: garden plants → houseplants →
   Tết tier), each verified via screenshots on both renderers.
7. **Pickers** in both name modals + i18n names + **unlock celebration** off the harvest reply's
   `fruitsTotal` crossing — with the e2e specs in the same commit (CLAUDE.md rule).
8. **Snapshots/album/share-card/assessments** ride-along with `?? 'classic'` defaults for
   pre-0050 blobs. Independently commitable.

## Verification
- `npm run typecheck`, `npm run lint`, `npm run check:i18n` freely.
- Visual: screenshot compare classic before/after the data port (web); live-verify authed pages
  per memory (cookie recipe) for the widget; mobile via `cd mobile && npm test` (free) — device
  suite only if the user asks.
- After each push: EAS workflow `workflow:runs` SUCCESS or manual
  `eas update --branch preview --environment preview`; `d1 migrations list mochi-class --remote`
  after the migration push.
- E2e suites: written in-commit, run only when the user asks (say so in one line at the end).

## Out of scope (explicitly)
- Class tree variety, pets mechanics/UI (only the dormant column ships), collection sticker-book
  screen (noted as a possible follow-up), push notification for unlocks.
