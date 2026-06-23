# Mochi backend — D1 + Worker API

The app ships with a Cloudflare Worker (`worker/index.js`) that serves the built
SPA and a JSON API backed by **Cloudflare D1** (SQLite). This is the first step
of replacing the in-browser `localStorage` store with a real database.

> Status: the **schema and API are implemented and tested**. The frontend
> (`src/store.js`) still reads/writes `localStorage` — switching it to call this
> API is the next step (see below).

## Data model

`migrations/0001_init.sql` defines the schema. Core tables: `staff`, `students`,
`parents`, `classes`, `events`, `homework`, `materials`, `invites`, plus
`settings` (calendar theme). Many-to-many links live in join tables
(`class_schedule`, `class_students`, `parent_students`). `accounts` + `sessions`
are present for the upcoming real-auth step. The Worker assembles the join
tables back into the nested arrays the UI expects (`class.studentIds`,
`student.classIds`, `class.schedule`, `parent.studentIds`).

## API

Served at `/api/*` by the Worker (same origin as the SPA):

| Method & path | Purpose |
|---|---|
| `GET /api/state` | Full denormalized snapshot (all collections + theme) |
| `POST /api/:collection` | Create an item (server assigns id), returns it |
| `PATCH /api/:collection/:id` | Patch an item, returns it |
| `DELETE /api/:collection/:id` | Delete an item (+ relation cleanup) |
| `GET /api/theme` · `PUT /api/theme` | Read / merge-patch the calendar theme |

Collections: `classes`, `students`, `users` (staff), `parents`, `events`,
`homework`, `materials`, `invites`. The shapes match `src/store.js` exactly, so
the store's `add` / `update` / `remove` / `setTheme` map 1:1 onto these.

## One-time provisioning (required before deploy)

```bash
npx wrangler d1 create mochi          # 1) create the database
# 2) paste the printed database_id into wrangler.jsonc (d1_databases[0])
npm run db:migrate                    # 3) apply migrations to the remote DB
npm run db:seed                       # 4) (optional) load demo data
```

**Until `database_id` is filled in, `wrangler deploy` (and the Cloudflare
auto-deploy) will fail at the D1 step.** Static asset serving still works; only
`/api/*` needs the DB.

## Local development

```bash
npm run db:migrate:local              # create/upgrade the local SQLite
npm run db:seed:local                 # (optional) demo data
npm run cf:dev                        # build + run the Worker locally (Miniflare)
```

`wrangler dev` runs the Worker against a local D1 — no remote database needed.

## Next step: point the frontend at the API

In `src/store.js`, replace the `localStorage` load/persist and the
`add`/`update`/`remove`/`setTheme` implementations with `fetch` calls:

- on mount: `GET /api/state` → initial data
- `add(key, item)` → `POST /api/{key}`
- `update(key, id, patch)` → `PATCH /api/{key}/{id}`
- `remove(key, id)` → `DELETE /api/{key}/{id}`
- `setTheme(patch)` → `PUT /api/theme`

Then layer on real auth (the `accounts`/`sessions` tables) for login, signup,
"remember me", password reset, and invite-code redemption.
