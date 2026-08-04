import React from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { useLang } from '../lib/i18n.jsx';
import { DEFAULT_SLIP_THEME, SLIP_THEMES, SLIP_THEME_CSS, isSlipThemeId } from './slip-themes.jsx';
import type { SlipData, SlipThemeId } from './slip-themes.jsx';

/**
 * Fee-slip page: picks a theme, renders it, and copies it to the clipboard as a PNG.
 *
 * The slip is not printed — it goes to parents over Zalo, so the useful action is "copy image".
 * `html-to-image` rasterizes the themed node; it is a bundled dependency, not a CDN script, so the
 * strict CSP is untouched. Everything a theme draws has to be local for the same reason (see the
 * notes in slip-themes.tsx).
 *
 * Clipboard images need a secure context, a user gesture, and `ClipboardItem` — Firefox has only
 * had that recently. When the write is unavailable or refused, the PNG downloads instead, so the
 * button always produces the image one way or another.
 */

const THEME_STORAGE_KEY = 'mochi-slip-theme';

interface SlipLoaderData extends SlipData {
  closedAt: string | null;
  isClosed: boolean;
}

const TOOLBAR_CSS = `
.slip-page {
  min-height: 100vh;
  background: #F4F1EA;
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}
.slip-bar {
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
.slip-bar select,
.slip-bar button {
  font: inherit;
  padding: 6px 12px;
  border: 1px solid #B9AE99;
  border-radius: 7px;
  background: #fff;
  color: #3B3226;
  cursor: pointer;
}
.slip-bar button.is-primary {
  background: #F2762E;
  border-color: #D9631F;
  color: #fff;
  font-weight: 700;
}
.slip-bar button:disabled { opacity: 0.6; cursor: default; }
.slip-bar__msg { font-size: 13px; color: #5C6F4A; font-weight: 600; }
.slip-bar__msg--err { color: #B3261E; }
/* The exported image is exactly this node, so it carries the shadow-free white background. */
.slip-stage { background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12); }
`;

type CopyState = { kind: 'idle' | 'busy' | 'copied' | 'downloaded' | 'error' };

export function FeeSlipView() {
  const { month, student, fee } = useLoaderData() as SlipLoaderData;
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [copy, setCopy] = React.useState<CopyState>({ kind: 'idle' });

  // `?theme=` wins so a link can pin one; otherwise the last choice on this device.
  const paramTheme = searchParams.get('theme');
  const [stored, setStored] = React.useState<SlipThemeId | null>(null);
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isSlipThemeId(saved)) setStored(saved);
    } catch {
      // Private mode / storage disabled: the default theme is fine.
    }
  }, []);

  const themeId: SlipThemeId = isSlipThemeId(paramTheme)
    ? paramTheme
    : (stored ?? DEFAULT_SLIP_THEME);
  const theme = SLIP_THEMES.find((x) => x.id === themeId) ?? SLIP_THEMES[0];

  const pickTheme = (next: SlipThemeId) => {
    setStored(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not worth surfacing — the picker still works for this view.
    }
    // Keep the URL in step, so a reload or a shared link shows the same slip.
    const params = new URLSearchParams(searchParams);
    params.set('theme', next);
    setSearchParams(params, { replace: true, preventScrollReset: true });
    setCopy({ kind: 'idle' });
  };

  const fileName = `phieu-thu-${month}-${student.name.replace(/\s+/g, '-').toLowerCase()}.png`;

  const copyImage = async () => {
    const node = stageRef.current;
    if (!node) return;
    setCopy({ kind: 'busy' });
    try {
      // Imported here rather than at module scope: it is only ever needed on a click, and the
      // print route is server-rendered first.
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

  const ThemeComponent = theme.Component;

  return (
    <div className="slip-page">
      <style dangerouslySetInnerHTML={{ __html: TOOLBAR_CSS + SLIP_THEME_CSS[theme.id] }} />

      <div className="slip-bar">
        <label>
          <span style={{ marginRight: 6 }}>{t('slip_theme')}</span>
          <select value={theme.id} onChange={(e) => pickTheme(e.target.value as SlipThemeId)}>
            {SLIP_THEMES.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="is-primary"
          onClick={() => void copyImage()}
          disabled={copy.kind === 'busy'}
        >
          {t('slip_copy_image')}
        </button>
        {copy.kind === 'copied' && <span className="slip-bar__msg">{t('copied')}</span>}
        {copy.kind === 'downloaded' && (
          <span className="slip-bar__msg">{t('slip_downloaded')}</span>
        )}
        {copy.kind === 'error' && (
          <span className="slip-bar__msg slip-bar__msg--err">{t('slip_copy_failed')}</span>
        )}
      </div>

      <div className="slip-stage" ref={stageRef}>
        <ThemeComponent month={month} student={student} fee={fee} />
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
