/**
 * Find the orange sync flash in a recording and write its frame numbers into the
 * manifest.
 *
 * A screen recording's timeline has no relationship to the walkthrough script's
 * clock: the encoder starts when the browser page is created, and the login that
 * follows takes a different number of seconds every run. `Recorder.syncFlash()`
 * paints one full-viewport orange frame at the moment it zeroes its own stopwatch,
 * so the flash is the anchor that ties step times to video frames.
 *
 * Detection averages every frame down to 8×8 and asks whether the frame is
 * overwhelmingly *warm* — red far above blue — for several frames running. The test is
 * relative rather than a match against #F79A4E, because averaging through ffmpeg's
 * YUV scaler desaturates the result badly (a full orange frame comes back around
 * rgb(175,137,109), not rgb(247,154,78)). The red-minus-blue gap survives that:
 * roughly 60 during the flash versus under 5 for any real screen of the app, whose
 * surfaces are warm but nearly neutral.
 *
 *   npm run sync                 # every recording
 *   npm run sync -- <id>         # just one
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORDINGS = path.join(ROOT, 'public', 'recordings');

const FPS = 30;
/** Frames are averaged to GRID×GRID before the warmth test. */
const GRID = 8;
/** Minimum red-minus-blue gap for a frame to count as the flash. */
const WARMTH = 35;
/** The flash is held for 250 ms; require most of that to rule out a stray frame. */
const MIN_RUN = 4;

/** One mean RGB per frame, resampled to FPS so an index is a composition frame. */
function samplePixels(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      'remotion',
      'ffmpeg',
      '-v',
      'error',
      '-i',
      videoPath,
      '-vf',
      `scale=${GRID}:${GRID}:flags=area`,
      '-r',
      String(FPS),
      '-f',
      'image2pipe',
      '-vcodec',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ];
    const child = spawn('npx', args, { cwd: ROOT, shell: process.platform === 'win32' });
    const chunks = [];
    const errors = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => errors.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errors).toString()}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      const perFrame = GRID * GRID * 3;
      const frames = [];
      for (let off = 0; off + perFrame <= buf.length; off += perFrame) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let p = 0; p < GRID * GRID; p++) {
          r += buf[off + p * 3];
          g += buf[off + p * 3 + 1];
          b += buf[off + p * 3 + 2];
        }
        const n = GRID * GRID;
        frames.push([r / n, g / n, b / n]);
      }
      resolve(frames);
    });
  });
}

function findFlash(frames) {
  const isFlash = (px) => px[0] - px[2] >= WARMTH && px[0] > px[1] && px[1] > px[2];

  let start = -1;
  for (let i = 0; i < frames.length; i++) {
    if (!isFlash(frames[i])) {
      if (start >= 0 && i - start >= MIN_RUN) return { start, end: i - 1 };
      start = -1;
      continue;
    }
    if (start < 0) start = i;
  }
  if (start >= 0 && frames.length - start >= MIN_RUN) {
    return { start, end: frames.length - 1 };
  }
  return null;
}

async function syncOne(id) {
  const dir = path.join(RECORDINGS, id);
  const videoPath = path.join(dir, `${id}.webm`);
  const manifestPath = path.join(dir, 'manifest.json');

  try {
    await fs.access(videoPath);
  } catch {
    console.warn(`[sync] ${id}: no ${id}.webm — run \`npm run record -- ${id}\` first`);
    return false;
  }

  const frames = await samplePixels(videoPath);
  const flash = findFlash(frames);
  if (!flash) {
    console.error(
      `[sync] ${id}: no orange flash found across ${frames.length} frames. ` +
        `Did the walkthrough call rec.syncFlash()?`,
    );
    return false;
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.syncFlashFrame = flash.start;
  manifest.footageStartFrame = flash.end + 1;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(
    `[sync] ${id}: flash on frames ${flash.start}–${flash.end} ` +
      `(${(flash.start / FPS).toFixed(2)}s), footage starts at frame ${flash.end + 1}, ` +
      `${frames.length} frames total (${(frames.length / FPS).toFixed(1)}s)`,
  );
  return true;
}

const only = process.argv[2];
const ids = only
  ? [only]
  : (await fs.readdir(RECORDINGS, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
      .map((e) => e.name);

let ok = true;
for (const id of ids) {
  if (!(await syncOne(id))) ok = false;
}
process.exit(ok ? 0 : 1);
