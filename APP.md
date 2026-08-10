# Mochi — application build

> **Obsolete — do not trust the previous contents of this file.**
>
> It described the original Vite single-page app: `index.html` loading React from unpkg as
> UMD globals, `src/store.js` as a React context over `localStorage`, mock auth, and a build
> into `dist/`. **None of that has existed since refactor phase 2.**
>
> It was replaced rather than updated because a stale architecture doc is worse than no doc:
> it sends the next reader — human or agent — down a path that no longer exists.

## Where to look instead

| For | Read |
|---|---|
| Current architecture | [`docs/mobile/README.md`](./docs/mobile/README.md) → *Repo orientation* |
| How it got here | [`docs/refactor/`](./docs/refactor/) |
| The JSON API | [`docs/api.md`](./docs/api.md) |
| How parents are reached | [`docs/zalo.md`](./docs/zalo.md) — the Zalo channel |
| Project rules | [`CLAUDE.md`](./CLAUDE.md) |
| Original design intent | [`README.md`](./README.md) — a design handoff, not current state |

## What it actually is now

React Router v8 in framework mode (SSR) on Cloudflare Workers, React 19, Vite 7, D1 via
Drizzle, R2 for material files. Routes in `app/`, UI in `src/`, domain logic in
`server/services/`, Zod contracts and cross-client code in `shared/`. Fully bilingual
(EN / Tiếng Việt) via `shared/i18n/strings.ts`.

```bash
npm run dev        # local dev — needs a working workerd; see docs/mobile/README.md
npm run build
npm run deploy     # build + wrangler deploy
npm run test       # vitest (jsdom) + vitest (Workers pool)
```
