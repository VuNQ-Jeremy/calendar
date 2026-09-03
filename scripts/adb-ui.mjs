#!/usr/bin/env node
/**
 * A very small UI driver for the Android emulator, over `adb`.
 *
 * Why this exists: Maestro (`npm run test:device`) needs a JVM, and there is none on this
 * machine. That would leave the phone half of a feature verified only by reading the code — so
 * this drives the real APK the way a person would, through `uiautomator dump` and `input tap`.
 * It is a smoke-test harness, not a test framework: no assertions, no retries beyond one, and
 * every helper returns enough for the caller to decide.
 *
 * Two traps it encodes, both of which cost a debugging cycle before:
 *   - screenshots must be pulled as files (`screencap` to /sdcard then `adb pull`); piping the
 *     binary through PowerShell corrupts it;
 *   - tap targets must come from a dump, never from guessed coordinates — the same screen lands
 *     at different pixels on different densities.
 *
 * Usage (from f:/code/calendar):
 *   import { dump, tapText, type, shot, back, wait } from './scripts/adb-ui.mjs';
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ADB = process.env.ADB ?? 'adb';

export function adb(...args) {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every visible node, as `{ text, desc, cls, bounds: {x1,y1,x2,y2}, cx, cy }`.
 *
 * Parsed with a regex rather than an XML library on purpose: uiautomator's output is a single
 * flat line of self-closing tags, and adding a parser dependency to a throwaway smoke helper is
 * not worth it.
 */
export function dump() {
  // Pulled into the OS temp dir, not the repo: this is scratch, and a stray XML in the working
  // tree is one more thing to forget to leave out of a commit.
  const local = join(tmpdir(), 'mochi-adb-ui.xml');
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  adb('pull', '/sdcard/ui.xml', local);
  const xml = readFileSync(local, 'utf8');
  const nodes = [];
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const attr = (name) => {
      const hit = tag.match(new RegExp(`${name}="([^"]*)"`));
      return hit ? hit[1] : '';
    };
    const b = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({
      text: attr('text'),
      desc: attr('content-desc'),
      cls: attr('class'),
      bounds: { x1, y1, x2, y2 },
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2),
    });
  }
  return nodes;
}

/** The first node whose text or content-desc equals `label` (case-insensitive). */
export function findText(label, nodes = dump()) {
  const want = label.toLowerCase();
  return nodes.find((n) => n.text.toLowerCase() === want || n.desc.toLowerCase() === want) ?? null;
}

/** …or merely contains it — for a card whose label is one line of several. */
export function findContains(fragment, nodes = dump()) {
  const want = fragment.toLowerCase();
  return (
    nodes.find((n) => n.text.toLowerCase().includes(want) || n.desc.toLowerCase().includes(want)) ??
    null
  );
}

export function tapXY(x, y) {
  adb('shell', 'input', 'tap', String(x), String(y));
}

/** Tap the centre of the first node matching `label`; returns false when it is not on screen. */
export function tapText(label, { contains = false } = {}) {
  const node = contains ? findContains(label) : findText(label);
  if (!node) return false;
  tapXY(node.cx, node.cy);
  return true;
}

/** `adb shell input text` cannot carry spaces; %s is its escape. */
export function type(text) {
  adb('shell', 'input', 'text', text.replace(/ /g, '%s'));
}

export function back() {
  adb('shell', 'input', 'keyevent', '4');
}

export function swipeUp() {
  adb('shell', 'input', 'swipe', '500', '1400', '500', '600');
}

/** Pull-to-refresh. */
export function swipeDown() {
  adb('shell', 'input', 'swipe', '500', '600', '500', '1400');
}

/** Screenshot to a real file — piping the binary through a shell corrupts it on Windows. */
export function shot(path) {
  mkdirSync(dirname(path), { recursive: true });
  adb('shell', 'screencap', '-p', '/sdcard/s.png');
  adb('pull', '/sdcard/s.png', path);
  return path;
}

export function bootCompleted() {
  try {
    return adb('shell', 'getprop', 'sys.boot_completed').trim() === '1';
  } catch {
    return false;
  }
}
