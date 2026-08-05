import React from 'react';
import { useLoaderData } from 'react-router';
import { useLang } from '../lib/i18n.jsx';
import { formatDmy } from '../../shared/logic/tuition.js';
import type { ComposedPreview } from '../../shared/logic/preview.js';

/**
 * "Nhắc buổi sau" — the share card a teacher pastes into the class Zalo group.
 *
 * This exists because parents cannot log in (a deliberate gap — see server/services/auth.ts), and
 * an image in the group chat is how this school already talks to them: the fee slip
 * (src/tuition/fee-slip.tsx) established the pattern and this reuses its mechanics wholesale.
 *
 * The same two constraints apply, both from how the card is used:
 *   - It is rasterized by html-to-image and pasted into Zalo, so everything must be local: system
 *     fonts only (a strict CSP blocks webfonts), no remote images, decoration in CSS or inline SVG.
 *   - It is a fixed-width card, not a paper document. No @page rules — the width has to be stable
 *     or the exported image changes size with the browser window.
 *
 * One theme, structured as a list of one so a second is additive, exactly as SLIP_THEMES is.
 */

export type PreviewSlipData = {
  date: string;
  className: string;
  title: string;
  start: string | null;
  end: string | null;
  location: string | null;
  preview: ComposedPreview;
};

const TOOLBAR_CSS = `
.psl-page {
  min-height: 100vh;
  background: #F4F1EA;
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}
.psl-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  background: #fff;
  border: 1px solid #D9D2C4;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  color: #3B3226;
}
.psl-bar button {
  font: inherit;
  padding: 6px 12px;
  border: 1px solid #D9631F;
  border-radius: 7px;
  background: #F2762E;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.psl-bar button:disabled { opacity: 0.6; cursor: default; }
.psl-bar__msg { font-size: 13px; color: #5C6F4A; font-weight: 600; }
.psl-bar__msg--err { color: #B3261E; }
/* The exported image is exactly this node, so it carries the shadow-free white background. */
.psl-stage { background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12); }
`;

const CARD_CSS = `
.psl {
  --frame: #CFE6D4;
  --frame-soft: #EAF6EC;
  --accent: #2F8F5B;
  --ink: #2C3A31;
  width: 640px;
  box-sizing: border-box;
  background: #fff;
  color: var(--ink);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  padding: 14px;
}
/* Two nested boxes rather than a border image, so the frame survives rasterization. */
.psl__frame {
  position: relative;
  overflow: hidden;
  border: 3px solid var(--frame);
  border-radius: 18px;
  background: linear-gradient(180deg, var(--frame-soft) 0%, #fff 38%);
  padding: 22px 24px 20px;
}
.psl__head { text-align: center; margin-bottom: 16px; }
.psl__title {
  margin: 0;
  font-size: 25px;
  font-weight: 800;
  letter-spacing: 0.2px;
  color: var(--accent);
}
.psl__class { margin: 4px 0 0; font-size: 19px; font-weight: 700; }
.psl__when { margin: 2px 0 0; font-size: 15px; color: #5D6B61; font-weight: 600; }
.psl__section { margin-top: 14px; }
.psl__label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--accent);
  margin-bottom: 5px;
}
.psl__body { margin: 0; white-space: pre-wrap; }
.psl__list { margin: 0; padding-left: 20px; }
.psl__list li { margin: 2px 0; }
.psl__none { margin: 0; color: #5D6B61; }
.psl__foot {
  margin: 18px 0 0;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
}
`;

type CopyState = { kind: 'idle' | 'busy' | 'copied' | 'downloaded' | 'error' };

export function PreviewSlipView() {
  const data = useLoaderData() as PreviewSlipData;
  const { t } = useLang();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [copy, setCopy] = React.useState<CopyState>({ kind: 'idle' });

  const fileName = `nhac-buoi-sau-${data.date}-${data.className
    .replace(/\s+/g, '-')
    .toLowerCase()}.png`;

  const copyImage = async () => {
    const node = stageRef.current;
    if (!node) return;
    setCopy({ kind: 'busy' });
    try {
      // Imported on click rather than at module scope: the route is server-rendered first, and
      // this is only ever needed after a gesture.
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: '#ffffff' });
      if (!blob) throw new Error('rasterize failed');

      if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopy({ kind: 'copied' });
      } else {
        download(blob, fileName);
        setCopy({ kind: 'downloaded' });
      }
    } catch {
      // A refused clipboard write still deserves to produce the image.
      try {
        const { toBlob } = await import('html-to-image');
        const blob = await toBlob(stageRef.current!, { pixelRatio: 2, backgroundColor: '#ffffff' });
        if (!blob) throw new Error('rasterize failed');
        download(blob, fileName);
        setCopy({ kind: 'downloaded' });
      } catch {
        setCopy({ kind: 'error' });
      }
    }
  };

  return (
    <div className="psl-page">
      <style dangerouslySetInnerHTML={{ __html: TOOLBAR_CSS + CARD_CSS }} />

      <div className="psl-bar">
        <button type="button" onClick={() => void copyImage()} disabled={copy.kind === 'busy'}>
          {t('slip_copy_image')}
        </button>
        {copy.kind === 'copied' && <span className="psl-bar__msg">{t('copied')}</span>}
        {copy.kind === 'downloaded' && <span className="psl-bar__msg">{t('slip_downloaded')}</span>}
        {copy.kind === 'error' && (
          <span className="psl-bar__msg psl-bar__msg--err">{t('slip_copy_failed')}</span>
        )}
      </div>

      <div className="psl-stage" ref={stageRef}>
        <PreviewCard {...data} />
      </div>
    </div>
  );
}

function PreviewCard({ date, className, title, start, end, location, preview }: PreviewSlipData) {
  const { t } = useLang();
  const focus = preview.focusText.trim();
  const hasCheck = preview.tests.length > 0 || !!preview.vocabTopic;
  const when = [start, end].filter(Boolean).join('–');

  return (
    <div className="psl">
      <div className="psl__frame">
        <div className="psl__head">
          <h1 className="psl__title">{t('prev_slip_title')}</h1>
          <p className="psl__class">{className}</p>
          <p className="psl__when">
            {[formatDmy(date), when || null, title !== className ? title : null, location]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        {focus ? (
          <div className="psl__section">
            <div className="psl__label">
              <BookIcon />
              {t('prev_slip_study')}
            </div>
            <p className="psl__body">{focus}</p>
          </div>
        ) : null}

        {hasCheck ? (
          <div className="psl__section">
            <div className="psl__label">
              <CheckIcon />
              {t('prev_slip_check')}
            </div>
            <ul className="psl__list">
              {preview.tests.map((x) => (
                <li key={x.id}>{x.title}</li>
              ))}
              {preview.vocabTopic ? (
                <li>
                  {t('prev_slip_vocab')}: {preview.vocabTopic.name} (
                  {t('prev_slip_words', { n: preview.vocabTopic.wordCount })})
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {/* A session nobody wrote anything for still makes a usable reminder that it exists. */}
        {!focus && !hasCheck ? (
          <div className="psl__section">
            <p className="psl__none">{t('prev_slip_nothing')}</p>
          </div>
        ) : null}

        <p className="psl__foot">{t('prev_slip_footer')}</p>
      </div>
    </div>
  );
}

/* Inline SVG, not an icon font: the card is rasterized and everything in it must be local. */
function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4h6v3H9zM6 7h12v14H6z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m9.5 14 2 2 3.5-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
