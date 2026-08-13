import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { Manifest, ManifestStep, Point, Rect } from '../src/manifest';

const ROOT = path.resolve(import.meta.dirname, '..');
const RECORDINGS = path.join(ROOT, 'public', 'recordings');

/**
 * Capture geometry — 900p at 16:9, which the landscape composition scales up to
 * 1080p.
 *
 * Two dead ends worth recording, because both look like they should work:
 *
 *   - `deviceScaleFactor` does nothing for video. Screenshots honour it; the
 *     screencast the video recorder uses does not.
 *   - Asking for a video *larger* than the viewport does not supersample. Playwright
 *     only ever scales the captured frame down to fit `recordVideo.size`, so a
 *     2560×1440 video of a 1600×900 viewport is the page in the corner of a mostly
 *     empty frame.
 *
 * A CSS `zoom` on `:root` is likewise no help: the screencast captures the whole
 * zoomed extent and fits it to the video, so zooming in only supersamples and the UI
 * comes out the same apparent size. Apparent size × resolution is conserved, and the
 * ceiling is the CSS viewport.
 *
 * So the viewport is chosen for *legibility* instead — 1600 CSS pixels puts the app's
 * type at a comfortable size once the frame is filled — and the composition accepts a
 * 1.2× upscale. Brand overlays are still drawn natively at 1080p, so captions and
 * callouts stay perfectly sharp over the softer footage.
 */
const VIEWPORT = { width: 1600, height: 900 };
const VIDEO_SIZE = { width: 1600, height: 900 };

export type RecorderOptions = {
  id: string;
  baseUrl?: string;
  /** 'vi' forces the app's language toggle before first paint. */
  lang?: 'vi' | 'en';
};

export class Recorder {
  readonly id: string;
  readonly baseUrl: string;
  readonly page: Page;

  private readonly browser: Browser;
  private readonly context: BrowserContext;
  private readonly videoDir: string;
  private readonly steps: ManifestStep[] = [];
  private open: ManifestStep | null = null;
  private t0 = 0;

  private constructor(init: {
    id: string;
    baseUrl: string;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    videoDir: string;
  }) {
    this.id = init.id;
    this.baseUrl = init.baseUrl;
    this.browser = init.browser;
    this.context = init.context;
    this.page = init.page;
    this.videoDir = init.videoDir;
  }

  static async launch(opts: RecorderOptions): Promise<Recorder> {
    const baseUrl =
      opts.baseUrl ?? process.env.E2E_BASE_URL ?? 'https://calendar.ngqv0712.workers.dev';
    const videoDir = path.join(RECORDINGS, opts.id, '_raw');
    await fs.rm(videoDir, { recursive: true, force: true });
    await fs.mkdir(videoDir, { recursive: true });

    const browser = await chromium.launch({
      // Reduce visual noise the compositions would have to crop around.
      args: ['--hide-scrollbars', '--force-color-profile=srgb'],
    });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      locale: opts.lang === 'en' ? 'en-US' : 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      recordVideo: { dir: videoDir, size: VIDEO_SIZE },
      colorScheme: 'light',
    });

    // The app reads its language from localStorage on mount (src/lib/i18n.tsx:36).
    // Seeding it here keeps the recording Vietnamese without clicking the toggle on
    // camera, and changes nothing server-side.
    await context.addInitScript((lang) => {
      try {
        window.localStorage.setItem('mochi_lang_v1', lang as string);
      } catch {
        /* storage unavailable */
      }
    }, opts.lang ?? 'vi');

    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    return new Recorder({ id: opts.id, baseUrl, browser, context, page, videoDir });
  }

  private now(): number {
    return Date.now() - this.t0;
  }

  /**
   * Measured boxes are already in video pixels: the page is not zoomed, so
   * `boundingBox()`'s CSS coordinates and the encoded frame share one space.
   * Compositions normalise against `manifest.viewport`.
   */
  private toVideoSpace(box: Rect): Rect {
    return box;
  }

  private url(p: string): string {
    return new URL(p, this.baseUrl).toString();
  }

  async login(): Promise<void> {
    const email = process.env.MOCHI_EMAIL;
    const password = process.env.MOCHI_PASSWORD;
    if (!email || !password) {
      throw new Error('Set MOCHI_EMAIL and MOCHI_PASSWORD before recording.');
    }
    await this.page.goto(this.url('/login'));
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('form[action="/login"] button[type="submit"]');
    await this.page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 45_000 });
    await this.page.locator('.sb').waitFor({ state: 'visible' });
    if ((await this.page.locator('.sb a[href="/dashboard"]').count()) === 0) {
      throw new Error('MOCHI_EMAIL must be a staff account — no staff sidebar found.');
    }
  }

  /**
   * Full-viewport orange flash, and the zero point for every step time.
   *
   * A screen recording's first frame does not line up with anything the script
   * knows about: the encoder starts when the page is created, before login, and
   * the lead-in varies run to run. The flash puts one unmistakable marker in the
   * pixels, so `scripts/sync-frames.mjs` can find the anchor frame afterwards and
   * the composition can map step times onto frames without anyone eyeballing a
   * timeline.
   */
  async syncFlash(): Promise<void> {
    await this.page.evaluate((color) => {
      const el = document.createElement('div');
      el.id = '__mochi_sync__';
      el.style.cssText = `position:fixed;inset:0;background:${color};z-index:2147483647`;
      document.body.appendChild(el);
    }, '#F79A4E');
    this.t0 = Date.now();
    await this.page.waitForTimeout(250);
    await this.page.evaluate(() => document.getElementById('__mochi_sync__')?.remove());
    // Let the flash clear the encoder before the first step starts.
    await this.page.waitForTimeout(500);
  }

  /** Group a run of actions under one caption. */
  async step(id: string, fn: () => Promise<void>): Promise<void> {
    if (this.open) throw new Error(`step("${id}") started while "${this.open.id}" was open`);
    const step: ManifestStep = { id, tStartMs: this.now(), tEndMs: 0 };
    this.open = step;
    try {
      await fn();
    } finally {
      step.tEndMs = this.now();
      this.steps.push(step);
      this.open = null;
    }
  }

  private require(): ManifestStep {
    if (!this.open) throw new Error('call this inside step()');
    return this.open;
  }

  /** Measure an element and make it this step's zoom target. */
  async focus(locator: Locator): Promise<Rect> {
    const step = this.require();
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('focus(): element has no bounding box');
    step.target = this.toVideoSpace(box);
    return step.target;
  }

  /**
   * Click an element, recording where the pointer went. Doubles as the zoom target
   * unless `focus()` already set a better one (e.g. zoom the whole modal, click one
   * field inside it).
   */
  async click(locator: Locator, opts?: { position?: Point }): Promise<void> {
    const step = this.require();
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (box) {
      const layoutPoint = opts?.position
        ? { x: box.x + opts.position.x, y: box.y + opts.position.y }
        : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      step.click = layoutPoint;
      step.target ??= this.toVideoSpace(box);
    }
    // Hold before acting. The composition pulses a ring at this point from the start
    // of the step, and without a pause the pulse and the UI's reaction land on the
    // same frame — so the viewer sees the result without ever seeing what was pressed.
    await this.beat(450);
    await locator.click({ position: opts?.position });
  }

  /** Type into a field at a human speed, so the viewer can read along. */
  async type(locator: Locator, text: string, delay = 55): Promise<void> {
    const step = this.require();
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (box) step.target ??= this.toVideoSpace(box);
    await locator.click();
    await locator.pressSequentially(text, { delay });
  }

  /**
   * Pick an option out of one of the app's portalled `Select` menus.
   *
   * Pass a RegExp for times: the labels are 12-hour ("2:00 pm"), so the substring
   * match a plain string does would make "2:00 pm" also hit "12:00 pm".
   */
  async selectOption(trigger: Locator, optionText: string | RegExp): Promise<void> {
    await this.click(trigger);
    const option = this.page
      .locator('.m-select__menu[role="listbox"] .m-select__option')
      .filter({ hasText: optionText })
      .first();
    await option.waitFor({ state: 'visible' });
    await this.beat(400);
    await option.click();
  }

  /**
   * Press, move, release — a real pointer drag, because the calendar's reschedule
   * gesture listens to mousedown/mousemove rather than to a click
   * (src/calendar/time-grid.tsx:182). Moves in small increments so the recording
   * captures the motion instead of a jump.
   */
  async drag(locator: Locator, dy: number, dx = 0): Promise<void> {
    const step = this.require();
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('drag(): element has no bounding box');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    step.target ??= this.toVideoSpace(box);
    step.click = from;

    await this.page.mouse.move(from.x, from.y);
    await this.beat(300);
    await this.page.mouse.down();
    const increments = 20;
    for (let i = 1; i <= increments; i++) {
      await this.page.mouse.move(from.x + (dx * i) / increments, from.y + (dy * i) / increments);
      await this.page.waitForTimeout(20);
    }
    await this.beat(300);
    await this.page.mouse.up();
  }

  /** A deliberate pause. Guides are watched, not skimmed. */
  async beat(ms = 800): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async goto(pathname: string): Promise<void> {
    await this.page.goto(this.url(pathname));
  }

  /** Close the browser, keep the video, write the manifest. */
  async finish(): Promise<{ manifest: Manifest; videoPath: string }> {
    const durationMs = this.now();
    const video = this.page.video();
    if (!video) throw new Error('no video was recorded');

    const dir = path.join(RECORDINGS, this.id);
    const videoPath = path.join(dir, `${this.id}.webm`);
    await this.context.close();
    await fs.mkdir(dir, { recursive: true });
    await fs.rm(videoPath, { force: true });
    await video.saveAs(videoPath);
    await this.browser.close();
    await fs.rm(this.videoDir, { recursive: true, force: true });

    const manifest: Manifest = {
      id: this.id,
      recordedAt: new Date().toISOString(),
      baseUrl: this.baseUrl,
      viewport: VIEWPORT,
      pixelSize: VIDEO_SIZE,
      // Filled in by scripts/sync-frames.mjs, which reads the actual pixels.
      syncFlashFrame: null,
      footageStartFrame: null,
      durationMs,
      steps: this.steps,
    };
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
    return { manifest, videoPath };
  }
}
