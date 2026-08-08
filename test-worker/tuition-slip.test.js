import { describe, it, expect } from 'vitest';
import { renderSlipPng } from '../server/slip/render';
import { SLIP_THEMES } from '../server/slip/themes';
// Vite inlines these at build time. Reading them with node:fs instead would need a real filesystem
// path, which the Workers pool does not give us on Windows (the file:// URL arrives as '/F:/...').
import latin400 from '../public/fonts/slip/nunito-sans-latin-400-normal.woff?inline';
import latin700 from '../public/fonts/slip/nunito-sans-latin-700-normal.woff?inline';
import viet400 from '../public/fonts/slip/nunito-sans-vietnamese-400-normal.woff?inline';
import viet700 from '../public/fonts/slip/nunito-sans-vietnamese-700-normal.woff?inline';

/**
 * The server-side fee slip renderer (satori + resvg-wasm).
 *
 * What can actually go wrong here is not the fee arithmetic — that is covered in test/fees.test.ts
 * — but the rendering stack: the wasm module has to initialise inside the Workers runtime, satori
 * has to lay out with the fonts it is handed, and every glyph of a Vietnamese name has to be in one
 * of them. A missing subset does not throw; it silently draws blank boxes, so the assertion that
 * matters is that a diacritic-heavy slip renders no smaller than an ASCII one.
 *
 * Fonts are injected rather than fetched: wrangler.test.jsonc has no ASSETS binding.
 */

/** A `data:...;base64,...` URL back to the raw bytes satori wants. */
function decode(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Two family names, matching server/slip/render.ts — see its FONT_FILES comment for why. */
async function fonts() {
  return [
    { name: 'Nunito Sans', data: decode(latin400), weight: 400, style: 'normal' },
    { name: 'Nunito Sans', data: decode(latin700), weight: 700, style: 'normal' },
    { name: 'Nunito Sans VN', data: decode(viet400), weight: 400, style: 'normal' },
    { name: 'Nunito Sans VN', data: decode(viet700), weight: 700, style: 'normal' },
  ];
}

function slipData(over = {}) {
  return {
    month: '2026-07',
    student: { id: 's1', name: 'Trần Thị Bích', guardian: 'Nguyễn Văn A', phone: '0900000000' },
    fee: {
      studentId: 's1',
      lines: [
        {
          studentId: 's1',
          classId: 'c1',
          className: 'IELTS 6.5',
          sessions: 3,
          dates: ['2026-07-01', '2026-07-08', '2026-07-15'],
          statusCounts: { present: 3 },
          unitPriceVnd: 150000,
          amountVnd: 450000,
        },
      ],
      billedVnd: 450000,
      adjustmentVnd: -50000,
      adjustmentNote: 'Giảm giá anh chị em',
      dueVnd: 400000,
      paidVnd: 100000,
      paidAt: '2026-08-02',
      paymentNote: 'Chuyển khoản',
      outstandingVnd: 300000,
      status: 'partial',
    },
    ...over,
  };
}

/** PNG magic bytes. */
function isPng(bytes) {
  return (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
}

describe('fee slip PNG', () => {
  it('renders every theme', async () => {
    const f = await fonts();
    for (const theme of SLIP_THEMES) {
      const png = await renderSlipPng(env_(), slipData(), theme.id, f);
      expect(isPng(png), `${theme.id} produced a PNG`).toBe(true);
      // A blank canvas compresses to almost nothing; a real slip does not.
      expect(png.byteLength, `${theme.id} has content`).toBeGreaterThan(5000);
    }
  });

  it('draws Vietnamese diacritics from the VN family rather than blank boxes', async () => {
    const all = await fonts();
    const latinOnly = all.filter((f) => f.name === 'Nunito Sans');

    const withVn = await renderSlipPng(env_(), slipData(), 'classic', all);
    const withoutVn = await renderSlipPng(env_(), slipData(), 'classic', latinOnly);

    // Dropping the VN family has to change the image. If it does not, the themes are not reaching
    // it — which is exactly the failure where satori keeps only the first font per family name and
    // every ọ/ầ/đ/₫ silently renders as a blank box while the byte count barely moves.
    const a = new Uint8Array(withVn);
    const b = new Uint8Array(withoutVn);
    expect(a.length === b.length && a.every((byte, i) => byte === b[i])).toBe(false);
  });

  it('falls back to a session count for pre-0021 months with no dates', async () => {
    const f = await fonts();
    const data = slipData();
    data.fee.lines[0].dates = [];
    const png = await renderSlipPng(env_(), data, 'minimal', f);
    expect(isPng(png)).toBe(true);
  });

  it('renders a zero-fee slip rather than throwing', async () => {
    const f = await fonts();
    const png = await renderSlipPng(
      env_(),
      slipData({
        fee: {
          studentId: 's1',
          lines: [],
          billedVnd: 0,
          adjustmentVnd: 0,
          adjustmentNote: null,
          dueVnd: 0,
          paidVnd: 0,
          paidAt: null,
          paymentNote: null,
          outstandingVnd: 0,
          status: 'paid',
        },
      }),
      'cute-pastel',
      f,
    );
    expect(isPng(png)).toBe(true);
  });
});

/** Fonts are always injected here, so the env is never read. */
function env_() {
  return /** @type {never} */ ({});
}
