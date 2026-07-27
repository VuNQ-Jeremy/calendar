/**
 * Generates the app icons from the Mochi brand mark.
 *
 * The repo has no `public/` directory and no favicon — there was no existing icon asset to
 * reuse, so these are derived from the same lucide paw-print used as the auth-screen brand
 * mark (`src/icons.tsx`, key `paw`) and the orange ramp in `shared/tokens.ts`.
 *
 * `npm run icons`, or `node mobile/scripts/make-icons.mjs` from the repo root. sharp is a
 * transitive dependency of the WEB build and lives in the repo root's node_modules; Node's
 * upward lookup finds it from either directory.
 *
 * Outputs are committed, so this only needs re-running when the brand changes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve(import.meta.dirname, '..', 'assets', 'images');

// shared/tokens.ts
const ORANGE_400 = '#F79A4E';
const ORANGE_600 = '#D96B1C';
const CREAM_50 = '#FFFCF8';

/** lucide paw-print, viewBox 0 0 24 24, stroke-only — verbatim from src/icons.tsx. */
const PAW =
  '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/>' +
  '<path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10z"/>';

/**
 * @param size    output edge length in px
 * @param color   paw stroke color
 * @param bg      background: a hex fill, or null for transparent
 * @param inset   fraction of the canvas left empty around the paw. Android's adaptive-icon
 *                mask can clip anything outside the central 66%, so the foreground uses a
 *                large inset; a plain square icon uses a small one.
 */
function pawSvg(size, color, bg, inset) {
  const box = size * (1 - 2 * inset);
  const off = size * inset;
  const radius = Math.round(size * 0.22); // matches --radius-xl-ish rounding on the web mark
  const back = bg
    ? `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${bg}"/>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      back +
      `<g transform="translate(${off} ${off}) scale(${box / 24})" fill="none" stroke="${color}" ` +
      `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${PAW}</g>` +
      `</svg>`,
  );
}

const png = (svg, size) => sharp(svg).resize(size, size).png().toBuffer();

await mkdir(OUT, { recursive: true });

const files = {
  // Square launcher icon and iOS/web fallback: paw on brand orange.
  'icon.png': await png(pawSvg(1024, CREAM_50, ORANGE_400, 0.2), 1024),
  // Adaptive foreground: transparent, app.config.ts supplies the orange background. Paw sits
  // well inside the safe zone so the circular/squircle mask cannot crop a toe off.
  'adaptive-icon.png': await png(pawSvg(1024, CREAM_50, null, 0.3), 1024),
  // Splash sits on a BRAND-colored screen, so the mark is cream with no plate of its own.
  'splash-icon.png': await png(pawSvg(1024, CREAM_50, null, 0.22), 1024),
  // Android tints the notification icon and keeps only its alpha — it MUST be a white
  // silhouette on transparent. Any color here is discarded.
  'notification-icon.png': await png(pawSvg(192, '#FFFFFF', null, 0.14), 192),
  // Expo web target only; harmless to ship.
  'favicon.png': await png(pawSvg(48, CREAM_50, ORANGE_600, 0.16), 48),
};

for (const [name, buf] of Object.entries(files)) {
  await writeFile(path.join(OUT, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}
