# Phase 5 — Backend hardening + R2 file storage

**Goal:** atomic writes, verified FK behavior, and real file storage. Fixes the standing bug
where an uploaded material's bytes are silently discarded (today only the filename survives;
downloads after reload produce a placeholder).

---

## Task 1 — Atomicity audit

Phase 3 required `db.batch` for relation writes; audit that it's true everywhere:

1. `grep -rn "await db" server/services/` — any service performing >1 sequential write statement
   without `db.batch([...])` gets converted. Known multi-write paths: class save
   (row + schedule + roster), student save (row + class links), parent save (row + student
   links), class/student/parent delete (row + join cleanup), invite redemption (Phase 4).
2. Add one failure-mode test: a batch containing an FK-violating statement rolls back entirely
   (no partial write observable afterward).

## Task 2 — Foreign keys: verify, then delete dead code

D1 runs SQLite with `foreign_keys` **on** and the schema already declares `ON DELETE CASCADE` /
`SET NULL` everywhere (see `migrations/0001_init.sql`). The old worker did manual cleanup because
it didn't trust this. Verify, then simplify:

1. Write tests against the real (miniflare) D1: delete a class → `class_schedule` +
   `class_students` rows cascade away, `events.class_id` / `homework` / `materials` /
   `invites.class_id` become NULL; delete a student → join rows cascade; delete an account →
   sessions cascade.
2. If (and only if) the tests prove the declared behavior works, delete the hand-rolled cleanup
   in the services and rely on the constraints. If any case fails, keep the manual cleanup for
   that case and document why next to the code.

## Task 3 — R2 for material files

1. `npx wrangler r2 bucket create mochi-files`, then in `wrangler.jsonc`:
   ```jsonc
   "r2_buckets": [{ "binding": "FILES", "bucket_name": "mochi-files" }]
   ```
   `npm run cf-typegen` to refresh `Env`.
2. Migration 0005 (via drizzle-kit): `ALTER TABLE materials ADD COLUMN file_key TEXT;`
   (`file_name` stays for display; `fileData` never had a column — nothing to migrate).
3. **Upload:** the materials action accepts `multipart/form-data` (RR actions: `await
   request.formData()`, the file field is a `File`). Rules: max 20 MB (reject with a field error
   — and set a matching client-side check so the old "too big to embed" path dies);
   key = `materials/${materialId}/${sanitizedFileName}` (strip path separators/control chars);
   `env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } })` in the same
   request as the D1 row (accept the tiny non-atomic window; on D1 failure, delete the object).
4. **Download:** `routes/materials.$id.download.tsx` loader — `requireUser`, fetch the row, then
   `env.FILES.get(file_key)` and stream:
   ```ts
   return new Response(obj.body, { headers: {
     'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
     'content-disposition': `attachment; filename="${encodeURIComponent(row.fileName)}"`,
   }});
   ```
   The Materials screen's download button becomes a plain `<a href>` to this route. Delete the
   old `fileData`/placeholder-blob download code in `src/screens-extra`.
5. **Delete cleanup:** removing a material (or its class cascade — check Task 2 outcome) deletes
   the R2 object; a weekly-cron orphan sweep is optional future work, note it in `BACKEND.md`.
6. Calendar theme background image: currently a URL/data-URL in settings JSON. Optional
   follow-up: same upload path (`theme/…` keys). Only do it if the operator asks; otherwise leave
   a note.
7. Tests (miniflare provides an in-memory R2): upload stores object + row with `file_key`;
   download streams the same bytes with the right headers; >20 MB rejected; delete removes the
   object; download without a session → redirect.

## Task 4 — Error handling & observability

1. Services throw typed errors (`NotFoundError`, `ValidationError`); a shared RR
   `ErrorBoundary` in `_app.tsx` renders a friendly bilingual message; loaders/actions convert
   typed errors to 404/400 responses, and anything else becomes a logged 500 with no internals
   leaked to the client (`console.error` includes the route + a request id; `observability` is
   already enabled in `wrangler.jsonc`, so Workers Logs picks these up).
2. Remove any remaining `console.log` debugging left from the modal/drawer investigation
   (`grep -rn "console.log" src/ app/ server/`).

---

## Acceptance criteria

- [ ] Upload a 2 MB PDF → reload the app → download returns the **same bytes**
      (`sha256sum` match), correct filename and content type.
- [ ] 25 MB upload rejected with a readable, bilingual error; no orphan object left in R2.
- [ ] FK cascade behavior covered by passing tests; manual cleanup code deleted (or documented
      why not, per case).
- [ ] `grep -rn "db.run\|await run(" server/services/` shows no unbatched multi-write paths.
- [ ] No `console.log` left in production paths; forced 500 shows the friendly boundary, not a
      stack trace.
- [ ] Full suite + typecheck + build + `wrangler deploy --dry-run` green; manual click-through
      incl. materials upload/download round-trip.
