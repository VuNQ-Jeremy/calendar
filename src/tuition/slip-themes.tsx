import type { StudentFee } from '../../shared/logic/tuition.js';
import { formatVnd } from '../../shared/logic/tuition.js';
import { useLang } from '../lib/i18n.jsx';

/**
 * Fee-slip themes (phiếu thu).
 *
 * Every theme renders the same `SlipData` — the print route's loader shape is the contract — so a
 * new theme is one component plus one entry in `SLIP_THEMES` and touches no server code.
 *
 * Two hard constraints, both from how the slip is used:
 *   - It is rasterized to PNG by html-to-image and pasted into Zalo, so everything must be local:
 *     system fonts only (a strict CSP blocks webfonts) and no remote images. Decoration is inline
 *     SVG or plain CSS.
 *   - It is a fixed-width card, not a paper document. No @page, no print rules — the width has to
 *     be stable or the exported image changes size with the browser window.
 */

export type SlipData = {
  month: string;
  student: { id: string; name: string; guardian: string | null; phone: string | null };
  fee: StudentFee;
};

export type SlipThemeId = 'cute-pastel' | 'classic';

export type SlipTheme = {
  id: SlipThemeId;
  /** i18n key for the theme picker. */
  labelKey: string;
  Component: (props: SlipData) => React.ReactElement;
};

/** Every theme exports its CSS as a string; the shell injects only the active one. */

/* ── Cute pastel ────────────────────────────────────────────────────────────────────────── */

export const CUTE_PASTEL_CSS = `
.slip-cute {
  --frame: #FBE7A1;
  --frame-soft: #FDF3D0;
  --accent: #F2762E;
  --ink: #3B3226;
  width: 640px;
  box-sizing: border-box;
  background: #fff;
  color: var(--ink);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  padding: 14px;
}
/* The pastel border is two nested boxes rather than an image, so it survives rasterization. */
.slip-cute__frame {
  border: 10px solid var(--frame);
  border-radius: 18px;
  padding: 20px 24px 16px;
  position: relative;
  overflow: hidden;
}
.slip-cute__blob {
  position: absolute;
  background: var(--frame-soft);
  border-radius: 50%;
  z-index: 0;
}
.slip-cute__blob--tl { width: 120px; height: 120px; top: -46px; left: -40px; }
.slip-cute__blob--br { width: 150px; height: 150px; bottom: -60px; right: -50px; }
.slip-cute__body { position: relative; z-index: 1; }
.slip-cute__head { text-align: center; margin-bottom: 14px; }
.slip-cute__title {
  margin: 0;
  color: var(--accent);
  font-size: 25px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.slip-cute__month { margin: 2px 0 0; font-size: 14px; color: #7A6A55; }
.slip-cute__field {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 9px;
  font-size: 15px;
}
.slip-cute__label { font-weight: 700; white-space: nowrap; }
/* The written-on line of the paper pad: a dotted rule that fills the row. */
.slip-cute__value {
  flex: 1;
  min-width: 0;
  border-bottom: 1.5px dotted #C9B896;
  padding: 0 2px 2px;
  word-break: break-word;
}
.slip-cute__bill {
  margin: 14px 0 0;
  border-top: 2px dashed var(--frame);
  padding-top: 10px;
}
.slip-cute__line {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin: 0 0 5px;
  font-size: 14.5px;
}
.slip-cute__line-name { font-weight: 700; }
.slip-cute__line-calc { color: #7A6A55; font-size: 13.5px; }
.slip-cute__line-amt { margin-left: auto; font-weight: 700; white-space: nowrap; }
.slip-cute__empty { margin: 0 0 6px; font-style: italic; color: #7A6A55; font-size: 14px; }
.slip-cute__totals { margin-top: 10px; }
.slip-cute__total-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 0;
  font-size: 15px;
}
.slip-cute__total-row--grand {
  border-top: 2px solid var(--frame);
  margin-top: 5px;
  padding-top: 6px;
  font-size: 18px;
  font-weight: 800;
  color: var(--accent);
}
.slip-cute__total-row--owed { color: #C2410C; font-weight: 700; }
.slip-cute__note {
  margin: 8px 0 0;
  font-size: 13px;
  font-style: italic;
  color: #7A6A55;
}
.slip-cute__foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: 12px;
  gap: 10px;
}
/* Script look without a webfont: these ship with Windows/macOS, and the generic cursive keeps
   the shape on anything else. */
.slip-cute__thanks {
  font-family: 'Segoe Script', 'Bradley Hand', 'Brush Script MT', cursive;
  font-size: 24px;
  color: var(--ink);
}
`;

/** Small hand-drawn-ish doodles. Inline SVG so nothing is fetched during rasterization. */
function CuteDoodles() {
  return (
    <span className="slip-cute__doodles" aria-hidden="true">
      <svg width="150" height="52" viewBox="0 0 150 52" fill="none">
        {/* teacup */}
        <path
          d="M14 24h26v10a13 13 0 0 1-13 13h0A13 13 0 0 1 14 34V24Z"
          fill="#FFF6DA"
          stroke="#B99A63"
          strokeWidth="2"
        />
        <path d="M40 27h5a6 6 0 0 1 0 12h-1" stroke="#B99A63" strokeWidth="2" />
        <path d="M20 16c2-4 6-4 8 0M30 14c2-4 6-4 8 0" stroke="#E4BE7C" strokeWidth="2" />
        {/* cloud */}
        <path
          d="M74 40a9 9 0 0 1 1-18 12 12 0 0 1 23 3 8 8 0 0 1-2 15H74Z"
          fill="#EAF4FB"
          stroke="#9DC2DA"
          strokeWidth="2"
        />
        {/* bow */}
        <path
          d="M126 30c-7-8-13-5-13 1s6 9 13 1c7 8 13 5 13-1s-6-9-13-1Z"
          fill="#FBD9C0"
          stroke="#E39A6A"
          strokeWidth="2"
        />
        <circle cx="126" cy="31" r="3" fill="#F2762E" />
      </svg>
    </span>
  );
}

function CutePastelSlip({ month, student, fee }: SlipData) {
  const { t } = useLang();
  const classes = fee.lines.map((l) => l.className).join(', ');

  return (
    <div className="slip-cute">
      <div className="slip-cute__frame">
        <span className="slip-cute__blob slip-cute__blob--tl" aria-hidden="true" />
        <span className="slip-cute__blob slip-cute__blob--br" aria-hidden="true" />

        <div className="slip-cute__body">
          <div className="slip-cute__head">
            <h1 className="slip-cute__title">{t('slip_title')}</h1>
            <p className="slip-cute__month">
              {t('slip_month')} {month}
            </p>
          </div>

          <p className="slip-cute__field">
            <span className="slip-cute__label">{t('slip_parent_student')}:</span>
            <span className="slip-cute__value">
              {student.guardian ? `${student.guardian} / ${student.name}` : student.name}
            </span>
          </p>
          <p className="slip-cute__field">
            <span className="slip-cute__label">{t('slip_col_class')}:</span>
            <span className="slip-cute__value">{classes}</span>
          </p>
          {student.phone ? (
            <p className="slip-cute__field">
              <span className="slip-cute__label">{t('slip_phone')}:</span>
              <span className="slip-cute__value">{student.phone}</span>
            </p>
          ) : null}

          <div className="slip-cute__bill">
            {fee.lines.length === 0 ? (
              <p className="slip-cute__empty">{t('slip_no_lines')}</p>
            ) : (
              fee.lines.map((line) => (
                <div className="slip-cute__line" key={line.classId}>
                  <span className="slip-cute__line-name">{line.className}</span>
                  <span className="slip-cute__line-calc">
                    {line.sessions} × {formatVnd(line.unitPriceVnd)}
                  </span>
                  <span className="slip-cute__line-amt">{formatVnd(line.amountVnd)}</span>
                </div>
              ))
            )}

            <div className="slip-cute__totals">
              {fee.adjustmentVnd !== 0 ? (
                <div className="slip-cute__total-row">
                  <span>
                    {t('tuition_adjustment')}
                    {fee.adjustmentNote ? ` (${fee.adjustmentNote})` : ''}
                  </span>
                  <span>{formatVnd(fee.adjustmentVnd)}</span>
                </div>
              ) : null}
              <div className="slip-cute__total-row slip-cute__total-row--grand">
                <span>{t('slip_total')}</span>
                <span>{formatVnd(fee.dueVnd)}</span>
              </div>
              {fee.paidVnd > 0 ? (
                <div className="slip-cute__total-row">
                  <span>
                    {t('slip_received')}
                    {fee.paidAt ? ` · ${fee.paidAt}` : ''}
                  </span>
                  <span>{formatVnd(fee.paidVnd)}</span>
                </div>
              ) : null}
              {fee.outstandingVnd > 0 ? (
                <div className="slip-cute__total-row slip-cute__total-row--owed">
                  <span>{t('slip_outstanding')}</span>
                  <span>{formatVnd(fee.outstandingVnd)}</span>
                </div>
              ) : null}
            </div>

            {fee.paymentNote ? <p className="slip-cute__note">{fee.paymentNote}</p> : null}
          </div>

          <div className="slip-cute__foot">
            <CuteDoodles />
            <span className="slip-cute__thanks">{t('slip_thank_you')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Classic ────────────────────────────────────────────────────────────────────────────── */

export const CLASSIC_CSS = `
.slip-classic {
  --ink: #000;
  width: 640px;
  box-sizing: border-box;
  background: #fff;
  color: var(--ink);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  padding: 28px 32px;
}
.slip-classic h1 {
  font-size: 21px;
  letter-spacing: 0.08em;
  text-align: center;
  margin: 0 0 3px;
}
.slip-classic .month { text-align: center; font-size: 15px; margin: 0 0 16px; }
.slip-classic .who { margin: 0 0 12px; font-size: 14.5px; }
.slip-classic .who div { margin: 0 0 3px; }
.slip-classic table { width: 100%; border-collapse: collapse; margin: 0 0 12px; font-size: 14.5px; }
.slip-classic th,
.slip-classic td { border-bottom: 1px solid var(--ink); padding: 5px 3px; text-align: left; }
.slip-classic th { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
.slip-classic td.num,
.slip-classic th.num { text-align: right; white-space: nowrap; }
.slip-classic .totals { font-size: 14.5px; }
.slip-classic .totals div { display: flex; justify-content: space-between; padding: 2px 0; }
.slip-classic .totals .grand {
  font-size: 17px;
  font-weight: 700;
  border-top: 2px solid var(--ink);
  padding-top: 5px;
  margin-top: 3px;
}
.slip-classic .note { font-size: 13px; font-style: italic; margin: 10px 0 0; }
.slip-classic .empty { font-style: italic; }
`;

function ClassicSlip({ month, student, fee }: SlipData) {
  const { t } = useLang();

  return (
    <div className="slip-classic">
      <h1>{t('slip_title')}</h1>
      <p className="month">
        {t('slip_month')} {month}
      </p>

      <div className="who">
        <div>
          <strong>{t('slip_student')}:</strong> {student.name}
        </div>
        {student.guardian ? (
          <div>
            <strong>{t('slip_guardian')}:</strong> {student.guardian}
          </div>
        ) : null}
        {student.phone ? (
          <div>
            <strong>{t('slip_phone')}:</strong> {student.phone}
          </div>
        ) : null}
      </div>

      {fee.lines.length === 0 ? (
        <p className="empty">{t('slip_no_lines')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('slip_col_class')}</th>
              <th className="num">{t('slip_col_sessions')}</th>
              <th className="num">{t('slip_col_price')}</th>
              <th className="num">{t('slip_col_amount')}</th>
            </tr>
          </thead>
          <tbody>
            {fee.lines.map((line) => (
              <tr key={line.classId}>
                <td>{line.className}</td>
                <td className="num">{line.sessions}</td>
                <td className="num">{formatVnd(line.unitPriceVnd)}</td>
                <td className="num">{formatVnd(line.amountVnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="totals">
        <div>
          <span>{t('slip_subtotal')}</span>
          <span>{formatVnd(fee.billedVnd)}</span>
        </div>
        {fee.adjustmentVnd !== 0 ? (
          <div>
            <span>
              {t('tuition_adjustment')}
              {fee.adjustmentNote ? ` (${fee.adjustmentNote})` : ''}
            </span>
            <span>{formatVnd(fee.adjustmentVnd)}</span>
          </div>
        ) : null}
        <div className="grand">
          <span>{t('slip_total')}</span>
          <span>{formatVnd(fee.dueVnd)}</span>
        </div>
        {fee.paidVnd > 0 ? (
          <div>
            <span>
              {t('slip_received')}
              {fee.paidAt ? ` · ${fee.paidAt}` : ''}
            </span>
            <span>{formatVnd(fee.paidVnd)}</span>
          </div>
        ) : null}
        {fee.outstandingVnd > 0 ? (
          <div>
            <span>
              <strong>{t('slip_outstanding')}</strong>
            </span>
            <span>
              <strong>{formatVnd(fee.outstandingVnd)}</strong>
            </span>
          </div>
        ) : null}
      </div>

      {fee.paymentNote ? <p className="note">{fee.paymentNote}</p> : null}
    </div>
  );
}

/* ── Registry ───────────────────────────────────────────────────────────────────────────── */

export const SLIP_THEMES: SlipTheme[] = [
  { id: 'cute-pastel', labelKey: 'slip_theme_cute', Component: CutePastelSlip },
  { id: 'classic', labelKey: 'slip_theme_classic', Component: ClassicSlip },
];

export const SLIP_THEME_CSS: Record<SlipThemeId, string> = {
  'cute-pastel': CUTE_PASTEL_CSS,
  classic: CLASSIC_CSS,
};

export const DEFAULT_SLIP_THEME: SlipThemeId = 'cute-pastel';

export function isSlipThemeId(value: unknown): value is SlipThemeId {
  return SLIP_THEMES.some((theme) => theme.id === value);
}
