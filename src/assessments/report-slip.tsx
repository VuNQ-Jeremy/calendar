import React from 'react';
import { useLoaderData } from 'react-router';
import { useLang } from '../lib/i18n.jsx';
import { colorOf } from '../lib/core.js';
import { monthLabel } from '../../shared/logic/month.js';
import { BEHAVIOR_META, scoreColorId } from '../../shared/logic/assess.js';
import type { BehaviorTypeId } from '../../shared/logic/assess.js';

/**
 * Monthly report slip (phiếu nhận xét) — the parent-facing face of the assessments module.
 *
 * Same two constraints as the fee slip, for the same reason (it is rasterized by html-to-image and
 * pasted into Zalo): everything local — system fonts only, no remote images, decoration is inline
 * SVG — and a fixed 640px width, so the exported PNG does not change size with the window.
 *
 * Unlike the fee slip there is no theme picker. One report layout is enough; the fee slip has three
 * because it replaced a paper pad teachers already had opinions about.
 */

type ReportLoaderData = {
  month: string;
  student: { id: string; name: string };
  classNames: string[];
  remark: {
    id: string;
    attitude: number;
    homework: number;
    participation: number;
    progress: number;
    comment: string | null;
  } | null;
  stats: {
    average: number | null;
    testCount: number;
    incidents: Record<string, number>;
    praiseCount: number;
  };
};

const SLIP_CSS = `
.rslip-page {
  min-height: 100vh;
  background: #F4F1EA;
  padding: 24px 16px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}
.rslip-bar {
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
.rslip-bar button {
  font: inherit;
  padding: 6px 12px;
  border: 1px solid #B9AE99;
  border-radius: 7px;
  background: #fff;
  color: #3B3226;
  cursor: pointer;
}
.rslip-bar button.is-primary {
  background: #F2762E;
  border-color: #D9631F;
  color: #fff;
  font-weight: 700;
}
.rslip-bar button:disabled { opacity: 0.6; cursor: default; }
.rslip-bar__msg { font-size: 13px; color: #5C6F4A; font-weight: 600; }
.rslip-bar__msg--err { color: #B3261E; }
/* The exported image is exactly this node, so it carries the shadow-free white background. */
.rslip-stage { background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12); }

.rslip {
  --frame: #BFD9C4;
  --frame-soft: #E8F2E9;
  --accent: #4B8B5B;
  --ink: #3B3226;
  --muted: #7A6A55;
  width: 640px;
  box-sizing: border-box;
  background: #fff;
  color: var(--ink);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  padding: 14px;
}
/* Nested boxes rather than a border image, so the frame survives rasterization. */
.rslip__frame {
  border: 10px solid var(--frame);
  border-radius: 18px;
  padding: 20px 24px 16px;
  position: relative;
  overflow: hidden;
}
.rslip__blob { position: absolute; background: var(--frame-soft); border-radius: 50%; z-index: 0; }
.rslip__blob--tl { width: 120px; height: 120px; top: -46px; left: -40px; }
.rslip__blob--br { width: 150px; height: 150px; bottom: -60px; right: -50px; }
.rslip__body { position: relative; z-index: 1; }
.rslip__head { text-align: center; margin-bottom: 14px; }
.rslip__title {
  margin: 0;
  color: var(--accent);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.rslip__month { margin: 2px 0 0; font-size: 14px; color: var(--muted); }
.rslip__field { display: flex; align-items: baseline; gap: 6px; margin: 0 0 9px; }
.rslip__label { font-weight: 700; white-space: nowrap; }
/* The written-on line of a paper form: a dotted rule that fills the row. */
.rslip__value {
  flex: 1;
  min-width: 0;
  border-bottom: 1.5px dotted #A9C3AF;
  padding: 0 2px 2px;
  word-break: break-word;
}
.rslip__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 0;
  border-top: 2px dashed var(--frame);
  padding-top: 12px;
}
.rslip__stat {
  border-radius: 10px;
  padding: 6px 12px;
  background: var(--frame-soft);
  font-size: 14px;
}
.rslip__stat b { font-size: 17px; }
.rslip__section-title {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.rslip__rating { display: flex; align-items: center; gap: 10px; margin: 0 0 7px; }
.rslip__rating-label { flex: 1; min-width: 0; }
.rslip__stars { display: flex; gap: 3px; flex: none; }
.rslip__comment {
  margin: 0;
  min-height: 66px;
  border: 1.5px dotted #A9C3AF;
  border-radius: 10px;
  padding: 9px 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.rslip__comment--empty { color: var(--muted); font-style: italic; }
.rslip__foot {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  margin-top: 18px;
}
.rslip__sign { text-align: center; min-width: 210px; }
.rslip__sign-role { font-weight: 700; font-size: 14px; }
.rslip__sign-hint { font-size: 12.5px; color: var(--muted); font-style: italic; }
.rslip__sign-rule { margin-top: 42px; border-bottom: 1.5px dotted #A9C3AF; }
`;

const RATING_KEYS = [
  ['attitude', 'remark_attitude'],
  ['homework', 'remark_homework'],
  ['participation', 'remark_participation'],
  ['progress', 'remark_progress'],
] as const;

type CopyState = { kind: 'idle' | 'busy' | 'copied' | 'downloaded' | 'error' };

/** Five stars, `value` of them filled. Inline SVG so nothing is fetched during rasterization. */
function Stars({ value }: { value: number }) {
  return (
    <span className="rslip__stars" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45 6.19 20.5l1.11-6.47L2.6 9.45l6.5-.95L12 2.6Z"
            fill={i <= value ? '#F5A524' : '#EFEAE0'}
            stroke={i <= value ? '#D98A0B' : '#D9D2C4'}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

export function ReportSlipView() {
  const { month, student, classNames, remark, stats } = useLoaderData() as ReportLoaderData;
  const { t, lang } = useLang();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [copy, setCopy] = React.useState<CopyState>({ kind: 'idle' });

  const fileName = `nhan-xet-${month}-${student.name.replace(/\s+/g, '-').toLowerCase()}.png`;

  const copyImage = async () => {
    const node = stageRef.current;
    if (!node) return;
    setCopy({ kind: 'busy' });
    try {
      // Imported on click rather than at module scope: the route is server-rendered first.
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

  const avgColor = stats.average == null ? null : colorOf(scoreColorId(stats.average));

  return (
    <div className="rslip-page">
      <style dangerouslySetInnerHTML={{ __html: SLIP_CSS }} />

      <div className="rslip-bar">
        <button
          type="button"
          className="is-primary"
          onClick={() => void copyImage()}
          disabled={copy.kind === 'busy'}
        >
          {t('slip_copy_image')}
        </button>
        {copy.kind === 'copied' && <span className="rslip-bar__msg">{t('copied')}</span>}
        {copy.kind === 'downloaded' && (
          <span className="rslip-bar__msg">{t('slip_downloaded')}</span>
        )}
        {copy.kind === 'error' && (
          <span className="rslip-bar__msg rslip-bar__msg--err">{t('slip_copy_failed')}</span>
        )}
      </div>

      <div className="rslip-stage" ref={stageRef}>
        <div className="rslip">
          <div className="rslip__frame">
            <span className="rslip__blob rslip__blob--tl" aria-hidden="true" />
            <span className="rslip__blob rslip__blob--br" aria-hidden="true" />

            <div className="rslip__body">
              <div className="rslip__head">
                <h1 className="rslip__title">{t('rslip_title')}</h1>
                <p className="rslip__month">{monthLabel(month, lang)}</p>
              </div>

              <p className="rslip__field">
                <span className="rslip__label">{t('rslip_student')}:</span>
                <span className="rslip__value">{student.name}</span>
              </p>
              <p className="rslip__field">
                <span className="rslip__label">{t('rslip_class')}:</span>
                <span className="rslip__value">{classNames.join(' · ') || '—'}</span>
              </p>

              <div className="rslip__stats">
                <span
                  className="rslip__stat"
                  style={avgColor ? { background: avgColor.soft, color: avgColor.ink } : undefined}
                >
                  {t('assess_avg')}: <b>{stats.average ?? '—'}</b>
                </span>
                <span className="rslip__stat">
                  {t('remark_stat_tests')}: <b>{stats.testCount}</b>
                </span>
                {Object.entries(stats.incidents).map(([ty, n]) => (
                  <span key={ty} className="rslip__stat">
                    {t(BEHAVIOR_META[ty as BehaviorTypeId].tk)}: <b>{n}</b>
                  </span>
                ))}
                {stats.praiseCount > 0 && (
                  <span className="rslip__stat">
                    {t('bh_praise')}: <b>{stats.praiseCount}</b>
                  </span>
                )}
              </div>

              <p className="rslip__section-title">{t('remark_title')}</p>
              {RATING_KEYS.map(([field, tk]) => (
                <div key={field} className="rslip__rating">
                  <span className="rslip__rating-label">{t(tk)}</span>
                  <Stars value={remark?.[field] ?? 0} />
                </div>
              ))}

              <p className="rslip__section-title">{t('remark_comment')}</p>
              <p className={`rslip__comment${remark?.comment ? '' : ' rslip__comment--empty'}`}>
                {remark?.comment || t('remark_none')}
              </p>

              <div className="rslip__foot">
                <div className="rslip__sign">
                  <div className="rslip__sign-role">{t('rslip_teacher_sign')}</div>
                  <div className="rslip__sign-hint">{t('rslip_signature')}</div>
                  <div className="rslip__sign-rule" />
                </div>
              </div>
            </div>
          </div>
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
