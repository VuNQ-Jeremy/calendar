# Universal scrollbar styling with 4 selectable presets on the System Config page

## Context

The app (Mochi LMS — React Router 8 SSR on Cloudflare Workers + D1, Tailwind v4, warm cream/orange "Mochi" design system) currently has **zero scrollbar styling** — every panel shows the stock OS scrollbar. The user chose to implement **all four** proposed scrollbar presets (**Slim**, **Inset track**, **Brand orange**, **Auto-hide/Ghost**), applied **universally** to every scroll container, and **switchable from the System Config page** (`/config`, admin-only), with visual preview cards.

**Mechanism:** a `data-scrollbar="slim|inset|brand|ghost"` attribute on `<html>`, set by a `useEffect` in the `_app` layout from loader data. `slim` is the default — the base CSS rules ARE the slim style and need no attribute; the other three are attribute-scoped overrides. The pref is stored as a new global `settings` table row `key='ui-prefs'` (JSON blob, extensible for future UI prefs), mirroring how the calendar theme is stored (`server/services/theme.ts`, row `key='theme'`).

Why these choices (verified against the codebase):

- Scrolling happens in many internal containers, not the body (`html, body` are height-locked in `src/styles/app.css` lines 3–10): `.main`, `.sb`, `.month`, `.tgrid`, `.agenda`, `.m-dialog__body`, `.drawer__body`, `.m-select__menu`, plus inline `style={{ overflow: 'auto' }}` divs. Universal selectors + an attribute on `<html>` cover all of them, including portaled modals/menus that render outside the `.app` div.
- The `settings` table already exists (`server/db/schema.ts` lines 172–175: `settings { key PK, value TEXT }`) — **no DB migration needed**.
- The config route mutation pattern is `fetcher.submit(fd, { action: '/config', method: 'post' })` with an `intent` FormData field.
- Reusable visual-picker CSS already exists: `.theme-preset`, `.preset`, `.preset.is-active`, `.preset__name` in `src/styles/app.css` (~line 1650).
- No dark mode exists anywhere — design one light theme only.

Design tokens used (defined in `src/ds/styles/tokens/colors.css`): `--taupe-400` #B8A893, `--taupe-500` #8C7C68, `--sand-300` #ECE0CF, `--sand-400` #DBCBB4, `--surface-sunken` #F6EDDF, `--surface-raised` #FDF6EC, `--brand` #F79A4E, `--brand-hover` #EF8434.

Execute the steps **in order** (later steps import symbols created in earlier ones). Run `npm run typecheck` after step 4 and again after step 6.

---

## Step 1 — Validation schema: `shared/schemas.ts`

The file currently ends at line 288 with:

```ts
export type ThemeInput = z.infer<typeof ThemeInput>;
```

**Append after that line** (end of file):

```ts

export const SCROLLBAR_STYLES = ['slim', 'inset', 'brand', 'ghost'] as const;
export type ScrollbarStyle = (typeof SCROLLBAR_STYLES)[number];

export const UiPrefsInput = z.object({
  scrollbar: z.enum(SCROLLBAR_STYLES).optional(),
});
export type UiPrefsInput = z.infer<typeof UiPrefsInput>;
```

Note: Zod objects are non-strict by default, so the extra `intent` key present in the parsed FormData is ignored — same as every other intent in this codebase.

## Step 2 — New service: `server/services/ui-prefs.ts` (new file)

Create with exactly this content (structure copied from `server/services/theme.ts`):

```ts
import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import type { Db } from '../db/index';
import type { ScrollbarStyle } from '../../shared/schemas';

export type UiPrefs = { scrollbar: ScrollbarStyle };

export const DEFAULT_UI_PREFS: UiPrefs = { scrollbar: 'slim' };

export async function getUiPrefs(db: Db): Promise<UiPrefs> {
  const rows = await db.select().from(settings).where(eq(settings.key, 'ui-prefs'));
  const row = rows[0];
  if (!row) return { ...DEFAULT_UI_PREFS };
  try {
    return { ...DEFAULT_UI_PREFS, ...(JSON.parse(row.value) as Partial<UiPrefs>) };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export async function setUiPrefs(db: Db, patch: Partial<UiPrefs>): Promise<UiPrefs> {
  const current = await getUiPrefs(db);
  const next = { ...current, ...patch };
  await db
    .insert(settings)
    .values({ key: 'ui-prefs', value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } });
  return next;
}
```

## Step 3 — Config route: `app/routes/config.tsx`

**Edit 3a — imports.** Change line 12:

```ts
import { AssessmentTypeInput, AssessmentTypeReorder, parsePatch } from '../../shared/schemas';
```

to:

```ts
import {
  AssessmentTypeInput,
  AssessmentTypeReorder,
  UiPrefsInput,
  parsePatch,
} from '../../shared/schemas';
```

and after line 11 (`import * as typesSvc from '../../server/services/assessment-types';`) add:

```ts
import * as uiPrefsSvc from '../../server/services/ui-prefs';
```

**Edit 3b — loader.** Replace (lines 21–22):

```ts
  const types = await typesSvc.list(db);
  return { types };
```

with:

```ts
  const [types, uiPrefs] = await Promise.all([typesSvc.list(db), uiPrefsSvc.getUiPrefs(db)]);
  return { types, uiPrefs };
```

**Edit 3c — action.** Inside the `try` block, insert a new intent branch immediately after the closing `}` of the `if (intent === 'reorder-types') { ... }` block (after line 89, before the `catch`):

```ts

    if (intent === 'ui-prefs') {
      const parsed = UiPrefsInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      const uiPrefs = await uiPrefsSvc.setUiPrefs(db, parsed.data);
      return { ok: true, uiPrefs };
    }
```

**Do NOT touch `clientLoader` or `clientAction`** — the existing `clientAction`'s `invalidate('route:')` already flushes the `route:config` cache after this mutation (see "Cache registration" below).

## Step 4 — Apply globally: `app/routes/_app.tsx`

**Edit 4a — import.** After line 22 (`import * as invitesSvc from '../../server/services/invites';`) add:

```ts
import * as uiPrefsSvc from '../../server/services/ui-prefs';
```

**Edit 4b — loader.** Replace the entire loader body (lines 73–92), which currently reads:

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  if (kind === 'student') {
    return {
      homeworkDueCount: 0,
      unusedInviteCount: 0,
      newFeedbackCount: 0,
      user: { ...user, kind },
    };
  }
  const db = createDb(env);
  const today = iso(TODAY);
  const [homeworkDueCount, unusedInviteCount, newFeedbackCount] = await Promise.all([
    homeworkSvc.countDue(db, today),
    invitesSvc.countUnused(db),
    feedbackSvc.countNew(db),
  ]);
  return { homeworkDueCount, unusedInviteCount, newFeedbackCount, user: { ...user, kind } };
}
```

with (db is now created before the student early-return so students get the pref too):

```ts
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  const db = createDb(env);
  if (kind === 'student') {
    const uiPrefs = await uiPrefsSvc.getUiPrefs(db);
    return {
      homeworkDueCount: 0,
      unusedInviteCount: 0,
      newFeedbackCount: 0,
      uiPrefs,
      user: { ...user, kind },
    };
  }
  const today = iso(TODAY);
  const [homeworkDueCount, unusedInviteCount, newFeedbackCount, uiPrefs] = await Promise.all([
    homeworkSvc.countDue(db, today),
    invitesSvc.countUnused(db),
    feedbackSvc.countNew(db),
    uiPrefsSvc.getUiPrefs(db),
  ]);
  return { homeworkDueCount, unusedInviteCount, newFeedbackCount, uiPrefs, user: { ...user, kind } };
}
```

**Edit 4c — component.** In `AppLayout` (line 190), change:

```ts
  const { user } = useLoaderData<typeof loader>();
```

to:

```ts
  const { user, uiPrefs } = useLoaderData<typeof loader>();
```

and immediately after the existing `React.useEffect` that handles `SEEN_INTRO_KEY` (after line 203), add:

```tsx

  React.useEffect(() => {
    document.documentElement.dataset.scrollbar = uiPrefs.scrollbar;
  }, [uiPrefs.scrollbar]);
```

No SSR attribute is needed: with the attribute absent, the base CSS renders the `slim` style, so the default case has zero flash and non-default cases get only a brief first-paint fallback to slim.

Because `_app`'s loader is a plain server loader, React Router automatically revalidates it after the `/config` fetcher POST — the attribute updates with no extra wiring.

## Step 5 — CSS: `src/styles/app.css` (two additions)

**Edit 5a — picker-card CSS.** Find this existing block (~line 1680):

```css
.preset__name {
  font-size: var(--text-xs);
  font-weight: 800;
  color: var(--text-strong);
}
```

Insert **immediately after it**:

```css

/* scrollbar-style picker on /config */
.preset--sb {
  width: 128px;
}
.sbmock {
  display: flex;
  gap: 4px;
  height: 44px;
  padding: 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  margin-bottom: 6px;
}
.sbmock__lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  justify-content: center;
}
.sbmock__lines span {
  height: 5px;
  border-radius: 3px;
  background: var(--sand-300);
}
.sbmock__lines span:nth-child(2) {
  width: 70%;
}
.sbmock__bar {
  border-radius: 999px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.sbmock__bar span {
  display: block;
  width: 100%;
  height: 55%;
  border-radius: 999px;
}
```

**Edit 5b — the scrollbar styles.** Append at the **very end of the file**. Browser strategy: Chrome/Edge/Safari use `::-webkit-scrollbar`; Firefox (which doesn't support that selector) gets the `@supports not selector(...)` fallback with the standard `scrollbar-width`/`scrollbar-color` properties. **Gotcha: do NOT set `scrollbar-color` outside that guard** — Chrome 121+ supports it, and once set it disables all `::-webkit-scrollbar` styling.

```css

/* ===================== Scrollbars (universal) =====================
   Preset selected on /config, applied as data-scrollbar on <html>.
   Base rules = 'slim' (the default, no attribute needed). */

*::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-corner {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: var(--taupe-400);
  border-radius: 999px;
}
*::-webkit-scrollbar-thumb:hover,
*::-webkit-scrollbar-thumb:active {
  background: var(--taupe-500);
}

/* --- inset: visible sunken track, padded sand thumb --- */
html[data-scrollbar='inset'] *::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}
html[data-scrollbar='inset'] *::-webkit-scrollbar-track {
  background: var(--surface-sunken);
  border-radius: 999px;
}
html[data-scrollbar='inset'] *::-webkit-scrollbar-thumb {
  background: var(--sand-400);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
html[data-scrollbar='inset'] *::-webkit-scrollbar-thumb:hover,
html[data-scrollbar='inset'] *::-webkit-scrollbar-thumb:active {
  background: var(--taupe-400);
  background-clip: padding-box;
}

/* --- brand: orange accent thumb --- */
html[data-scrollbar='brand'] *::-webkit-scrollbar-thumb {
  background: var(--brand);
}
html[data-scrollbar='brand'] *::-webkit-scrollbar-thumb:hover,
html[data-scrollbar='brand'] *::-webkit-scrollbar-thumb:active {
  background: var(--brand-hover);
}

/* --- ghost: invisible until the scroll container is hovered --- */
html[data-scrollbar='ghost'] *::-webkit-scrollbar-thumb {
  background: transparent;
}
html[data-scrollbar='ghost'] *:hover::-webkit-scrollbar-thumb {
  background: var(--taupe-400);
}
html[data-scrollbar='ghost'] *:hover::-webkit-scrollbar-thumb:hover,
html[data-scrollbar='ghost'] *:hover::-webkit-scrollbar-thumb:active {
  background: var(--taupe-500);
}

/* Firefox (no ::-webkit-scrollbar support): standard properties. */
@supports not selector(::-webkit-scrollbar) {
  * {
    scrollbar-width: thin;
    scrollbar-color: var(--taupe-400) transparent;
  }
  html[data-scrollbar='inset'] * {
    scrollbar-width: auto;
    scrollbar-color: var(--sand-400) var(--surface-sunken);
  }
  html[data-scrollbar='brand'] * {
    scrollbar-color: var(--brand) transparent;
  }
  /* ghost: hover-reveal isn't possible with standard properties;
     Firefox falls back to the slim style (already covered by the base rule). */
}
```

Placement matters: `app.css` is imported last in `app/root.tsx` and is unlayered, so these rules beat Tailwind's layered preflight.

## Step 6 — Picker UI: `src/screens-config.tsx`

**Edit 6a — import.** After line 7 (`import type { AssessmentTypeRow } from '../server/services/assessment-types.js';`) add:

```ts
import type { ScrollbarStyle } from '../shared/schemas.js';
```

(Note the `.js` extension on a `.ts` source — that's this repo's import convention, see the `assessment-types.js` import right above.)

**Edit 6b — loader data type + preset metadata.** Replace (lines 11–13):

```ts
interface ConfigLoaderData {
  types: AssessmentTypeRow[];
}
```

with:

```ts
interface ConfigLoaderData {
  types: AssessmentTypeRow[];
  uiPrefs: { scrollbar: ScrollbarStyle };
}

// Mock colors are hardcoded hex (same values as the DS tokens) so each card
// always previews its own style regardless of the currently active preset.
const SB_PRESETS: Record<ScrollbarStyle, { tk: string; track: string; thumb: string; barW: number }> = {
  slim: { tk: 'cfg_sb_slim', track: 'transparent', thumb: '#B8A893', barW: 6 },
  inset: { tk: 'cfg_sb_inset', track: '#F6EDDF', thumb: '#DBCBB4', barW: 9 },
  brand: { tk: 'cfg_sb_brand', track: 'transparent', thumb: '#F79A4E', barW: 6 },
  ghost: { tk: 'cfg_sb_ghost', track: 'transparent', thumb: 'rgba(184,168,147,0.35)', barW: 6 },
};
```

**Edit 6c — component state.** Change line 18:

```ts
  const { types } = useLoaderData() as ConfigLoaderData;
```

to:

```ts
  const { types, uiPrefs } = useLoaderData() as ConfigLoaderData;
```

Then, immediately after the `submit` helper (line 24, `const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });`), insert:

```ts

  const [sbLocal, setSbLocal] = React.useState<ScrollbarStyle | null>(null);
  const scrollbar = sbLocal ?? uiPrefs.scrollbar;

  const pickScrollbar = (key: ScrollbarStyle) => {
    setSbLocal(key);
    document.documentElement.dataset.scrollbar = key; // instant whole-app preview
    const fd = new FormData();
    fd.set('intent', 'ui-prefs');
    fd.set('scrollbar', key);
    submit(fd);
  };
```

**Edit 6d — render the picker card.** Between the closing `</Card>` of the assessment-types card (line 174) and the `{modal && (` block (line 176), insert:

```tsx

      <Card style={{ padding: 18, marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_sb_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('cfg_sb_sub')}
          </p>
        </div>
        <div className="theme-preset">
          {(Object.keys(SB_PRESETS) as ScrollbarStyle[]).map((key) => {
            const p = SB_PRESETS[key];
            return (
              <button
                key={key}
                type="button"
                className={'preset preset--sb' + (scrollbar === key ? ' is-active' : '')}
                onClick={() => pickScrollbar(key)}
              >
                <div className="sbmock">
                  <div className="sbmock__lines">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="sbmock__bar" style={{ background: p.track, width: p.barW }}>
                    <span style={{ background: p.thumb }} />
                  </div>
                </div>
                <div className="preset__name">{t(p.tk)}</div>
              </button>
            );
          })}
        </div>
      </Card>
```

## Step 7 — i18n strings: `src/lib/i18n.tsx`

Two dictionaries: English at the top level (2-space indent), Vietnamese nested (4-space indent). Anchor on `cfg_no_types` in each.

**Edit 7a — English.** After line 219 (`  cfg_no_types: 'No assessment types yet',`) insert:

```ts
  cfg_sb_title: 'Scrollbar style',
  cfg_sb_sub: 'Applies to every scrollable panel in the app',
  cfg_sb_slim: 'Slim',
  cfg_sb_inset: 'Inset track',
  cfg_sb_brand: 'Brand orange',
  cfg_sb_ghost: 'Auto-hide',
```

**Edit 7b — Vietnamese.** After line 743 (`    cfg_no_types: 'Chưa có loại bài kiểm tra',`) insert (note 4-space indent):

```ts
    cfg_sb_title: 'Kiểu thanh cuộn',
    cfg_sb_sub: 'Áp dụng cho mọi vùng cuộn trong ứng dụng',
    cfg_sb_slim: 'Mảnh',
    cfg_sb_inset: 'Có rãnh',
    cfg_sb_brand: 'Cam thương hiệu',
    cfg_sb_ghost: 'Tự ẩn',
```

(Line numbers are as of the current file; 7a shifts 7b's anchor by 6 lines — match on the anchor text, not the number.)

---

## Cache registration (required by the client-cache architecture)

All data reads/writes must go through the hand-rolled cache layer (`src/lib/cache.ts`) — do **not** add raw `fetcher.load` calls or any new caching mechanism.

| Data | Read path | Write path | Invalidation |
| --- | --- | --- | --- |
| `uiPrefs` (config page selection state) | `/config` loader → cached under existing key `route:config` via its existing `clientLoader` | `/config` action, `intent='ui-prefs'` | existing `clientAction` → `invalidate('route:')` — already covers it, **no new keys or wiring** |
| `uiPrefs` (global apply on `<html>`) | `_app.tsx` layout loader | — | none — `_app`'s loader is deliberately **UNCACHED** (no `clientLoader`) so React Router's post-action revalidation keeps it fresh (same reason its sidebar badges stay uncached). **Do not add a `clientLoader` to `_app.tsx`.** |

## Known caveats (accepted — do not try to "fix" these)

- **Ghost on Firefox** falls back to the always-visible slim style (standard scrollbar properties can't do hover-reveal).
- **Inset's 2px thumb padding** only renders on WebKit/Blink; Firefox gets the right colors but stock geometry.
- The setting is **global** (all users share it), consistent with how the calendar `theme` works; the editing page is admin-only.
- The optimistic `sbLocal` state is never reset — that's fine: it always equals the last clicked value, which after revalidation also equals `uiPrefs.scrollbar`.

## Verification

**workerd crashes on this machine** — `npm run dev`, `vite preview`, and `wrangler d1 --local` all fail; there is no local D1. The test loop is **build → deploy → test on prod**:

1. Static checks (all must pass):
   - `npm run typecheck` (runs `react-router typegen && tsc --noEmit`)
   - `npm run lint` (oxlint)
   - `npm run build` (the build itself works fine locally; only workerd is broken)
2. *(Optional, for pre-deploy testing)* Local Node harness at `C:\tmp\calendar-repro\`: copy the fresh `build/` output from this repo into it, then `node --import ./cf-shim.mjs node-host.mjs` → http://localhost:8788, login `dev@mochi.edu` / `repro`. It runs the real production build with D1 shimmed onto `node:sqlite`.
3. Deploy: `npm run deploy` (runs build + `wrangler deploy`). Prod URL: **https://calendar.ngqv0712.workers.dev** (account ngqv0712@gmail.com; remote DB has the demo seed).
4. **Hard-refresh the browser tab after deploying** — an open SPA tab keeps running the pre-deploy bundle, so "no change visible" right after a deploy usually means a stale tab. To confirm the new code is actually live, the deployed client chunks are publicly fetchable (`/assets/manifest-*.js` lists them).
5. In the prod app as an admin: open **/config** → new "Scrollbar style" card shows 4 preview cards with `slim` active by default.
6. Click each preset → every scrollbar in the app (sidebar, calendar month view, modals, dropdowns) changes **instantly**; the clicked card gets the orange active ring.
7. Hard-reload the page → the chosen preset persists; verify in devtools that `<html data-scrollbar="...">` is set.
8. Check `ghost`: scrollbars invisible until hovering a scrollable panel.
9. Log in as a non-admin/student if convenient → same scrollbar style applies (the `_app` loader now fetches it for all users).

## Wrap-up

Per project rules (CLAUDE.md): when done and verified, stage the changed files, commit to `main`, and push. Suggested message: `feat: universal scrollbar styling with 4 selectable presets on /config`. End the commit message with the required `Co-Authored-By` trailer from the project instructions.
