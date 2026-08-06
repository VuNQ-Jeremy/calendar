import React from 'react';
import { useLoaderData } from 'react-router';
import { MIcon } from '../icons.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { formatDmy } from '../../shared/logic/tuition.js';
import { ClassTreeSvg, PlantSvg } from './plant-art.jsx';
import type { ClassGarden } from '../../server/services/garden.js';

/**
 * The class-garden share card — an image for the class Zalo group.
 *
 * Third of its kind after the fee slip (src/tuition/fee-slip.tsx) and the session preview
 * (src/preview/preview-slip.tsx), and it reuses their mechanics wholesale: `html-to-image`
 * rasterizes one node on a click, the PNG goes to the clipboard when the browser allows it and
 * downloads when it does not, so the button always produces the image one way or another.
 *
 * The same two constraints apply, both from how the card is used:
 *   - Everything inside the exported node must be LOCAL and LITERAL: system fonts only (a strict
 *     CSP blocks webfonts), no remote images, decoration in inline SVG, and no CSS variables for
 *     colours. html-to-image resolves computed styles, and a `var(--text-strong)` that resolves
 *     against the app theme would rasterize dark-on-dark for a teacher browsing in dark mode.
 *     `PlantSvg` already uses hex for exactly this reason.
 *   - It is a fixed-width card, not a paper document, so the width is a constant — otherwise the
 *     exported image changes size with the browser window.
 *
 * There are no class names anywhere here on purpose. `src/styles/app.css` is global even for
 * document routes outside the `_app` layout (that is a known trap), and this file may not edit it,
 * so every rule is an inline style instead.
 */

export type ShareLoaderData = {
  vnToday: string;
  garden: ClassGarden;
};

const CARD_W = 640;
const PAPER = '#FFFFFF';
const INK = '#2C3A31';
const MUTED = '#6B7A6F';
const FRAME = '#CFE6D4';
const FRAME_SOFT = '#F1F8F2';
const ACCENT = '#2F8F5B';
const PAGE_BG = '#F4F1EA';
const BAR_BORDER = '#D9D2C4';
const BTN = '#F2762E';
const BTN_BORDER = '#D9631F';
const OK_INK = '#5C6F4A';
const ERR_INK = '#B3261E';

const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";

type CopyState = 'idle' | 'busy' | 'copied' | 'downloaded' | 'error';

export function ClassShareCard() {
  const { garden, vnToday } = useLoaderData() as ShareLoaderData;
  const { t } = useLang();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [copy, setCopy] = React.useState<CopyState>('idle');

  const fileName = `vuon-cay-${garden.className.replace(/\s+/g, '-').toLowerCase()}-${vnToday}.png`;

  const render = async () => {
    // Imported on the click, not at module scope: this route is server-rendered first and the
    // rasterizer is only ever needed once somebody presses the button.
    const { toBlob } = await import('html-to-image');
    const blob = await toBlob(stageRef.current!, { pixelRatio: 2, backgroundColor: PAPER });
    if (!blob) throw new Error('rasterize failed');
    return blob;
  };

  const copyImage = async () => {
    if (!stageRef.current) return;
    setCopy('busy');
    try {
      const blob = await render();
      if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopy('copied');
      } else {
        download(blob, fileName);
        setCopy('downloaded');
      }
    } catch {
      // A refused clipboard write still deserves to produce the image.
      try {
        download(await render(), fileName);
        setCopy('downloaded');
      } catch {
        setCopy('error');
      }
    }
  };

  const saveImage = async () => {
    if (!stageRef.current) return;
    setCopy('busy');
    try {
      download(await render(), fileName);
      setCopy('downloaded');
    } catch {
      setCopy('error');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: PAGE_BG,
        padding: '24px 16px 48px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'center',
          background: PAPER,
          border: `1px solid ${BAR_BORDER}`,
          borderRadius: 10,
          padding: '10px 12px',
          fontSize: 14,
          color: '#3B3226',
        }}
      >
        <button
          type="button"
          style={{
            font: 'inherit',
            padding: '6px 12px',
            border: `1px solid ${BTN_BORDER}`,
            borderRadius: 7,
            background: BTN,
            color: PAPER,
            fontWeight: 700,
            cursor: 'pointer',
            opacity: copy === 'busy' ? 0.6 : 1,
          }}
          disabled={copy === 'busy'}
          onClick={() => void copyImage()}
        >
          {t('slip_copy_image')}
        </button>
        <button
          type="button"
          style={{
            font: 'inherit',
            padding: '6px 12px',
            border: `1px solid ${BAR_BORDER}`,
            borderRadius: 7,
            background: PAPER,
            color: '#3B3226',
            cursor: 'pointer',
            opacity: copy === 'busy' ? 0.6 : 1,
          }}
          disabled={copy === 'busy'}
          onClick={() => void saveImage()}
        >
          {t('mat_download')}
        </button>
        {copy === 'copied' && <span style={{ color: OK_INK, fontWeight: 600 }}>{t('copied')}</span>}
        {copy === 'downloaded' && (
          <span style={{ color: OK_INK, fontWeight: 600 }}>{t('slip_downloaded')}</span>
        )}
        {copy === 'error' && (
          <span style={{ color: ERR_INK, fontWeight: 600 }}>{t('slip_copy_failed')}</span>
        )}
      </div>

      {/* The exported image is exactly this node. */}
      <div ref={stageRef} style={{ background: PAPER, boxShadow: '0 2px 10px rgba(0,0,0,0.12)' }}>
        <ShareStage garden={garden} vnToday={vnToday} />
      </div>
    </div>
  );
}

function ShareStage({ garden, vnToday }: ShareLoaderData) {
  const { t } = useLang();
  return (
    <div
      style={{
        width: CARD_W,
        boxSizing: 'border-box',
        background: PAPER,
        color: INK,
        fontFamily: FONT,
        fontSize: 15,
        lineHeight: 1.5,
        padding: 14,
      }}
    >
      {/* Two nested boxes rather than a border image, so the frame survives rasterization. */}
      <div
        style={{
          border: `2px solid ${FRAME}`,
          borderRadius: 14,
          background: FRAME_SOFT,
          padding: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            borderBottom: `1px solid ${FRAME}`,
            paddingBottom: 12,
            marginBottom: 12,
          }}
        >
          <ClassTreeSvg level={garden.tree.level} size={84} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, letterSpacing: 0.4, color: MUTED, fontWeight: 700 }}>
              {t('garden_class_title').toUpperCase()}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: INK }}>{garden.className}</div>
            <div style={{ fontSize: 14, color: MUTED }}>{formatDmy(vnToday)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, color: MUTED, fontWeight: 700 }}>{t('garden_tree')}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: ACCENT }}>
              {t('garden_tree_level', { n: garden.tree.level })}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 10,
          }}
        >
          {garden.members.map((m) => (
            <div
              key={m.studentId}
              style={{
                background: PAPER,
                border: `1px solid ${FRAME}`,
                borderRadius: 10,
                padding: '8px 6px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <PlantSvg
                stage={m.stage}
                wilted={m.wilted}
                dead={m.dead}
                potColor={m.potColor}
                size={72}
              />
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: colorOf(m.color).hex,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.name}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'center',
                  fontSize: 12,
                  color: MUTED,
                }}
              >
                {m.streak > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <MIcon name="flame" size={12} />×{m.streak}
                  </span>
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <MIcon name="fruit" size={12} />×{m.fruitMonth}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
