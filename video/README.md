# Mochi video catalog

Vietnamese user-guide videos for Mochi, built with [Remotion](https://remotion.dev).

Guides are **real footage of the real app** — a Playwright script drives a live
deployment and records it, then a Remotion composition wraps that recording in Mochi's
own brand: intro sting, numbered Vietnamese captions, cursor pulses, camera pushes,
outro. Nothing about the UI is mocked up, so a guide cannot drift from the product
without the drift being visible.

Everything runs locally. Renders land in `out/` as MP4s you upload wherever you like —
there is no hosting step, no external API, and no cost beyond your own machine.

This is a **standalone npm project**, like `mobile/`. The repo deliberately avoids
workspaces (see `docs/mobile/README.md`), so `video/` keeps its own `node_modules`.

```bash
cd video
npm install
npx playwright install chromium     # first time only
```

## The three commands

```bash
# 1. Drive the live app and capture footage + step timings
MOCHI_EMAIL=... MOCHI_PASSWORD=... npm run record -- calendar-basics

# 2. Find the sync flash in the recording and write its frame into the manifest
npm run sync

# 3. Render every catalog entry to out/
npm run render
```

Then `npm run studio` to scrub the result, `npm run typecheck` before committing.

Filters: `npm run render -- guide-calendar` (substring on the composition id) or
`npm run render -- --format landscape`.

## How a video is put together

Three things combine, and they are kept deliberately separate:

| Piece | Lives in | Owns |
|---|---|---|
| **Walkthrough** | `record/walkthroughs/<id>.ts` | what the browser *does*, and what each step is called |
| **Manifest** | `public/recordings/<id>/manifest.json` | *when* each step happened, and where on screen |
| **Catalog** | `src/catalog.ts` | the *words* — Vietnamese captions, titles, framing choices |

Because timing and wording are separate, re-recording footage never rewrites captions
and rewording a caption never invalidates a recording. The two are joined by step id:
a caption naming a step the walkthrough no longer records is a hard error at render
time, not a silently missing caption.

`.webm` files are gitignored (large, regenerable). **Manifests are committed** — they
are what makes a render reproducible without a re-record.

### The sync flash

A screen recording's timeline has no relationship to the script's clock: the encoder
starts when the browser page is created, and the login that follows takes a different
number of seconds every run. So `Recorder.syncFlash()` paints one full-viewport orange
frame at the instant it zeroes its own stopwatch, and `npm run sync` finds that frame
by reading the pixels. Every step time is relative to it, and nobody has to eyeball a
timeline.

Detection tests whether a frame is overwhelmingly *warm* rather than matching
`#F79A4E`, because averaging a frame down through ffmpeg's YUV scaler desaturates it
badly — a full orange frame comes back around `rgb(175,137,109)`. The red-minus-blue
gap survives that; an absolute colour match does not.

## Capture geometry, and three dead ends

Footage is captured at **1600×900** and the landscape composition scales it to 1080p.
That 1.2× upscale is not laziness — it is the best available trade, and these all look
like they should beat it:

- **`deviceScaleFactor: 2`** does nothing. Screenshots honour it; the screencast the
  video recorder uses does not.
- **Asking for a bigger video than the viewport** does not supersample. Playwright only
  ever scales a captured frame *down* to fit `recordVideo.size`, so a 2560×1440 video of
  a 1600×900 viewport is the page sitting in the corner of a mostly empty frame.
- **CSS `zoom` on `:root`** is normalised away. The screencast captures the whole zoomed
  extent and fits it to the video, so zooming in only supersamples and the UI comes out
  the same apparent size.

Apparent size × resolution is conserved, and the ceiling is the CSS viewport. So the
viewport is chosen for legibility instead, and the upscale is accepted. Brand overlays
are drawn natively at 1080p, so captions and callouts stay perfectly sharp over the
softer footage.

This also sets the zoom budget: `ZoomPan` caps at 1.22×, because that compounds on the
1.2× already in play and past roughly 1.5× total the app's text visibly softens.

## Fonts

The app's display face is **Fredoka**, which ships **no Vietnamese subset** — every
"Điểm danh" would render with fallback diacritics. So:

| Font | Role |
|---|---|
| **Baloo Two** | all Vietnamese display text (has `vietnamese`, rounded like Fredoka) |
| **Nunito Sans** | captions and body (has `vietnamese`; the app's own body face) |
| **DM Mono** | digits, times, dates — latin-only, never prose |
| **Fredoka** | the "Mochi" wordmark only, where no diacritic can appear |

Before touching the brand kit, render a still containing
`Điểm danh — buổi học ạ ậ ẵ ỡ ữ` and look at it.

## Recording against production

There is no working local dev server for this project, so recordings run against the
live deployment with a real account. Consequences:

- **Walkthroughs write real rows.** Declare a `marker` (the event title) and `run.ts`
  deletes matching rows through the JSON API once the browser closes.
- **Never script the theme drawer.** It writes on every interaction — preset click,
  colour blur, slider release — and "Done" only closes it. A theme walkthrough
  permanently changes the account's calendar unless it saves and restores the original.
- **Attendance and event-materials autosave too.** Opening those tabs and clicking a
  chip is a write.

Credentials come from `MOCHI_EMAIL` / `MOCHI_PASSWORD` and are never committed.

## Writing a new guide

1. Add `record/walkthroughs/<id>.ts` exporting a `Walkthrough`, and register it in
   `record/run.ts`. Use `rec.step()` to name each beat; `rec.focus()` to set what a
   camera push would frame; `rec.click()`, `rec.type()`, `rec.selectOption()`,
   `rec.drag()` to act; `rec.beat()` to let the viewer keep up. Steps whose id starts
   with `_` are recorded but never captioned — which is how cleanup happens in the same
   session without appearing on camera.
2. `npm run record -- <id>` then `npm run sync`.
3. Add a `CatalogEntry` in `src/catalog.ts` with one caption per step id.
4. `npm run studio` to check it, `npm run render` to publish it.

Pass `selectOption` a RegExp for times — labels are 12-hour, so the substring match a
plain string does would make `2:00 pm` also hit `12:00 pm`.

### Choosing where to push in

`zoom` is off by default, and that default is editorial. Zooming scales about the
target, so a control near an edge — a sidebar item, say — pushes the rest of the screen
out of frame and hides the very thing the click just caused. Use it when the subject is
centred and detail helps, such as fields inside a dialog. Elsewhere let the cursor
pulse do the pointing.

Use `captionAt: 'top'` when a bottom caption would cover the subject — pressing a
dialog's footer button, for instance.

## Known app quirk the guide works around

Dragging an event in week view reschedules it correctly, but releasing the mouse also
fires a click, and the editor's `if (!drag) onPick(e)` guard
(`src/calendar/time-grid.tsx:183-186`) races React's state commit — so the edit dialog
often opens on top of the result. `calendar-basics` presses Escape after the drag. If
that guard is ever fixed, the Escape becomes harmless and can be dropped.

## Music

`public/music/*.mp3` is gitignored. Drop a freely licensed track there (Pixabay Music,
YouTube Audio Library) and name it in the catalog entry's `music` field. With no file
named the videos are silent, which is a valid state rather than a bug.
