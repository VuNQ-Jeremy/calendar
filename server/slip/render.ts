// `satori/standalone`, not `satori`: the default entry bundles yoga-layout as base64 and calls
// WebAssembly.instantiate on it at import time, which the Workers runtime rejects outright ("Wasm
// code generation disallowed by embedder"). The standalone entry leaves yoga uninitialised and
// takes a WebAssembly.Module through `init`.
import satori, { init as initYoga } from 'satori/standalone';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
// Both wasm modules are imported, never compiled from bytes, for the same reason — the bundler
// turns these into real WebAssembly.Module bindings.
import yogaWasm from 'satori/yoga.wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { SLIP_THEMES, type SlipData, type SlipThemeId } from './themes';

/**
 * Render a fee slip (phiếu thu) to PNG inside the Worker.
 *
 * The web slip is rasterized in the browser by html-to-image, which needs a DOM — neither the
 * Worker nor React Native has one. satori takes a React element and a font and produces SVG without
 * a layout engine; resvg turns that into a PNG. The cost is that satori implements a subset of CSS,
 * which is why `server/slip/themes.tsx` is a second implementation of the three themes rather than a
 * shared component: see its header for what each theme gives up.
 */

/** Both wasm inits and the font fetch are once-per-isolate, not once-per-request. */
let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  // initWasm throws if called twice, so the promise itself is the guard — including for the
  // concurrent case, where two requests race before either has resolved.
  wasmReady ??= Promise.all([initYoga(yogaWasm), initWasm(resvgWasm)]).then(() => undefined);
  return wasmReady;
}

export type SlipFont = { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' };

/**
 * Nunito Sans, latin + vietnamese subsets, as .woff (satori cannot read woff2).
 *
 * Served from the client build through the ASSETS binding rather than bundled into the Worker: they
 * are static bytes that would otherwise count against the upload limit on every deploy.
 *
 * The two subsets are registered under DIFFERENT family names, and the themes ask for
 * "Nunito Sans, Nunito Sans VN". satori keeps only the first font per (name, weight, style) and
 * never falls back to a later one with the same name, so registering both as "Nunito Sans" silently
 * drops one of them — either every ọ/ầ/đ/₫ or every ASCII letter renders as a blank box. Across
 * different family names it does resolve per glyph.
 */
const FONT_FILES: { file: string; name: string; weight: 400 | 700 }[] = [
  { file: 'nunito-sans-latin-400-normal.woff', name: 'Nunito Sans', weight: 400 },
  { file: 'nunito-sans-latin-700-normal.woff', name: 'Nunito Sans', weight: 700 },
  { file: 'nunito-sans-vietnamese-400-normal.woff', name: 'Nunito Sans VN', weight: 400 },
  { file: 'nunito-sans-vietnamese-700-normal.woff', name: 'Nunito Sans VN', weight: 700 },
];

let fontsCache: Promise<SlipFont[]> | null = null;

async function loadFonts(env: Env): Promise<SlipFont[]> {
  fontsCache ??= (async () => {
    const loaded = await Promise.all(
      FONT_FILES.map(async ({ file, name, weight }) => {
        // The URL host is ignored by the ASSETS binding; only the path is read.
        const res = await env.ASSETS.fetch(new Request(`https://assets.local/fonts/slip/${file}`));
        if (!res.ok) throw new Error(`slip font missing: ${file} (${res.status})`);
        return { name, data: await res.arrayBuffer(), weight, style: 'normal' as const };
      }),
    );
    return loaded;
  })();
  try {
    return await fontsCache;
  } catch (err) {
    // A failed fetch must not poison the isolate for every later request.
    fontsCache = null;
    throw err;
  }
}

/**
 * @param fonts Injected by the tests, which run without an ASSETS binding.
 */
export async function renderSlipPng(
  env: Env,
  data: SlipData,
  themeId: SlipThemeId,
  fonts?: SlipFont[],
): Promise<Uint8Array> {
  const theme = SLIP_THEMES.find((t) => t.id === themeId) ?? SLIP_THEMES[0];
  const [fontList] = await Promise.all([fonts ? Promise.resolve(fonts) : loadFonts(env), ensureWasm()]);

  const svg = await satori(theme.render(data), {
    width: theme.width,
    fonts: fontList,
  });

  // 2x, matching the web slip's html-to-image pixelRatio — the image is read on a phone screen and
  // forwarded over Zalo, both of which resample it.
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: theme.width * 2 },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return png;
}
