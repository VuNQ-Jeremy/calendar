# Phase 6 — TypeScript on the frontend (incremental)

**Goal:** the backend has been TS since Phase 2; this phase converts the remaining `.jsx` under
`src/` and turns the strictness up. Incremental by design — it can interleave with feature work;
each file conversion is an independent commit.

---

## Task 1 — Compiler baseline

1. `tsconfig.json`: `"strict": true` must already hold for `app/`, `server/`, `workers/`,
   `shared/` (it shipped with the Phase 2 template — verify). Keep `"allowJs": true` while any
   `.jsx` remains.
2. Add `"checkJs": false` (don't half-check the unconverted files; convert them properly instead).

## Task 2 — Types come from zod, not by hand

- Entity/input types: `import type { EventInput } from '~/shared/schemas'` (`z.infer`). **Never**
  hand-write an interface that duplicates a schema — if a screen needs a narrower/derived shape,
  derive it (`Pick<>`, `z.output`), don't fork it.
- Loader/action data: use RR7's generated route types (`react-router typegen` runs inside
  `npm run typecheck`; loaders type `useLoaderData` automatically via `Route.ComponentProps` —
  follow the template's pattern).

## Task 3 — Conversion order

Leaves → trunk, one commit each, suite green after each:

1. `src/lib/core.js` → `.ts` (`PALETTE` gets `as const`, `ColorId` from `shared/schemas`).
2. `src/lib/i18n.jsx` → `.tsx` — type the `STRINGS` dictionary so **both locales must have every
   key**: `const STRINGS: Record<'en' | 'vi', Record<MsgKey, string>>` where
   `type MsgKey = keyof typeof STRINGS.en` (or a two-step `satisfies` so a missing `vi` key is a
   compile error — this turns the bilingual rule from convention into a build failure).
3. `src/ds/bundle.js` → minimal `.d.ts` alongside it (`declare` the 11 component props from
   their observed usage: `variant`, `block`, `iconLeft`, `color`, `size`, `label`, `checked`,
   `onChange`, …). Do **not** rewrite the bundle itself.
4. `src/icons.jsx` → `.tsx` (icon name union type from the glyph map — typos in
   `<MIcon name="…">` become compile errors).
5. `src/ui.jsx` → `.tsx` (Modal, Select, ColorPicker, PageHeader, Empty, useConfirm).
6. Screens, in the order they're next touched by feature work — or, if done as a dedicated pass:
   `auth remnants → screens-core → screens-extra → screens-manage/ → calendar/`.
7. Tests: rename `test/**/*.test.js` → `.test.ts(x)` as their subjects convert.

Conversion rules: no `any` (use `unknown` + narrowing where genuinely dynamic); no `@ts-ignore`
(a `@ts-expect-error` with a one-line reason is the ceiling, and it needs a follow-up ticket);
event handler types from React (`React.ChangeEvent<HTMLInputElement>`); don't change runtime
behavior in the same commit as a type conversion.

## Task 4 — Finish line

1. Remove `"allowJs"` once `git ls-files 'src/**/*.js' 'src/**/*.jsx'` (excluding `ds/bundle.js`)
   is empty.
2. CI already runs `npm run typecheck` (Phase 2); confirm it fails the build on type errors
   (introduce one locally, watch it fail, revert).
3. Update `APP.md`'s file map to the final layout (`app/`, `server/`, `shared/`, `src/` residue).

---

## Acceptance criteria

- [ ] `npx tsc --noEmit` clean with `strict: true` and no `allowJs`.
- [ ] Zero `any`, zero `@ts-ignore` (`grep -rn ": any\|@ts-ignore" app/ src/ server/ shared/`).
- [ ] Deleting any `vi` translation key breaks the build (proves the i18n typing works).
- [ ] A wrong `<MIcon name>` or DS prop is a compile error.
- [ ] Full suite + build green; manual click-through unchanged.
