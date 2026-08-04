import type { StudentFee } from '../../shared/logic/tuition.js';
import {
  dongToWords,
  formatDmy,
  formatVnd,
  monthLabel,
  monthNumeric,
} from '../../shared/logic/tuition.js';
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

export type SlipThemeId = 'cute-pastel' | 'minimal' | 'classic';

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
      <svg width="176" height="60" viewBox="0 0 176 60" fill="none">
        {/* teacup, with steam */}
        <path
          d="M14 26h30v11a15 15 0 0 1-15 15A15 15 0 0 1 14 37V26Z"
          fill="#FFF6DA"
          stroke="#B99A63"
          strokeWidth="2.2"
        />
        <path d="M44 30h5a7 7 0 0 1 0 14h-1" stroke="#B99A63" strokeWidth="2.2" />
        <path
          d="M22 17c2-5 6-5 8 0M32 14c2-5 6-5 8 0"
          stroke="#E4BE7C"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* cloud */}
        <path
          d="M80 45a10 10 0 0 1 1-20 13 13 0 0 1 25 3 9 9 0 0 1-2 17H80Z"
          fill="#EAF4FB"
          stroke="#9DC2DA"
          strokeWidth="2.2"
        />
        {/* bow: two triangles and a knot, so the shape survives at any size */}
        <path
          d="M148 24 162 34 148 44Z"
          fill="#FBD9C0"
          stroke="#E39A6A"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path
          d="M176 24 162 34 176 44Z"
          fill="#FBD9C0"
          stroke="#E39A6A"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle cx="162" cy="34" r="4" fill="#F2762E" />
      </svg>
    </span>
  );
}

function CutePastelSlip({ month, student, fee }: SlipData) {
  const { t, lang } = useLang();
  const classes = fee.lines.map((l) => l.className).join(', ');

  return (
    <div className="slip-cute">
      <div className="slip-cute__frame">
        <span className="slip-cute__blob slip-cute__blob--tl" aria-hidden="true" />
        <span className="slip-cute__blob slip-cute__blob--br" aria-hidden="true" />

        <div className="slip-cute__body">
          <div className="slip-cute__head">
            <h1 className="slip-cute__title">{t('slip_title')}</h1>
            <p className="slip-cute__month">{monthLabel(month, lang)}</p>
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

/**
 * Every class is namespaced, including inside the theme's own root. Generic names collide with the
 * app stylesheet, which is global: a bare `.month` picked up the calendar's 7-column grid and broke
 * this slip's month line into two cells.
 */
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
.slip-classic__title {
  font-size: 21px;
  letter-spacing: 0.08em;
  text-align: center;
  margin: 0 0 3px;
}
.slip-classic__month { text-align: center; font-size: 15px; margin: 0 0 16px; }
.slip-classic__who { margin: 0 0 12px; font-size: 14.5px; }
.slip-classic__who div { margin: 0 0 3px; }
.slip-classic__table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 12px;
  font-size: 14.5px;
}
.slip-classic__table th,
.slip-classic__table td { border-bottom: 1px solid var(--ink); padding: 5px 3px; text-align: left; }
.slip-classic__table th { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
.slip-classic__num { text-align: right; white-space: nowrap; }
.slip-classic__totals { font-size: 14.5px; }
.slip-classic__row { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
.slip-classic__row--grand {
  font-size: 17px;
  font-weight: 700;
  border-top: 2px solid var(--ink);
  padding-top: 5px;
  margin-top: 3px;
}
.slip-classic__note { font-size: 13px; font-style: italic; margin: 10px 0 0; }
.slip-classic__empty { font-style: italic; }
`;

function ClassicSlip({ month, student, fee }: SlipData) {
  const { t, lang } = useLang();

  return (
    <div className="slip-classic">
      <h1 className="slip-classic__title">{t('slip_title')}</h1>
      <p className="slip-classic__month">{monthLabel(month, lang)}</p>

      <div className="slip-classic__who">
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
        <p className="slip-classic__empty">{t('slip_no_lines')}</p>
      ) : (
        <table className="slip-classic__table">
          <thead>
            <tr>
              <th>{t('slip_col_class')}</th>
              <th className="slip-classic__num">{t('slip_col_sessions')}</th>
              <th className="slip-classic__num">{t('slip_col_price')}</th>
              <th className="slip-classic__num">{t('slip_col_amount')}</th>
            </tr>
          </thead>
          <tbody>
            {fee.lines.map((line) => (
              <tr key={line.classId}>
                <td>{line.className}</td>
                <td className="slip-classic__num">{line.sessions}</td>
                <td className="slip-classic__num">{formatVnd(line.unitPriceVnd)}</td>
                <td className="slip-classic__num">{formatVnd(line.amountVnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="slip-classic__totals">
        <div className="slip-classic__row">
          <span>{t('slip_subtotal')}</span>
          <span>{formatVnd(fee.billedVnd)}</span>
        </div>
        {fee.adjustmentVnd !== 0 ? (
          <div className="slip-classic__row">
            <span>
              {t('tuition_adjustment')}
              {fee.adjustmentNote ? ` (${fee.adjustmentNote})` : ''}
            </span>
            <span>{formatVnd(fee.adjustmentVnd)}</span>
          </div>
        ) : null}
        <div className="slip-classic__row slip-classic__row--grand">
          <span>{t('slip_total')}</span>
          <span>{formatVnd(fee.dueVnd)}</span>
        </div>
        {fee.paidVnd > 0 ? (
          <div className="slip-classic__row">
            <span>
              {t('slip_received')}
              {fee.paidAt ? ` · ${fee.paidAt}` : ''}
            </span>
            <span>{formatVnd(fee.paidVnd)}</span>
          </div>
        ) : null}
        {fee.outstandingVnd > 0 ? (
          <div className="slip-classic__row">
            <span>
              <strong>{t('slip_outstanding')}</strong>
            </span>
            <span>
              <strong>{formatVnd(fee.outstandingVnd)}</strong>
            </span>
          </div>
        ) : null}
      </div>

      {fee.paymentNote ? <p className="slip-classic__note">{fee.paymentNote}</p> : null}
    </div>
  );
}

/* ── Minimal ────────────────────────────────────────────────────────────────────────────── */

/**
 * Modelled on the centre's typed receipts: a narrow serif column, a bordered "Buổi học / Ngày học"
 * table listing every session, the per-session price, and the total with the amount in words.
 */
export const MINIMAL_CSS = `
.slip-minimal {
  --ink: #000;
  width: 480px;
  box-sizing: border-box;
  background: #fff;
  color: var(--ink);
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 16px;
  line-height: 1.45;
  padding: 26px 30px 30px;
}
/* font-family and letter-spacing are load-bearing, not decoration: the design system styles every
   h1-h5 with --font-display globally (src/ds/styles/tokens/base.css), which lands on this title too
   and replaces the serif the whole theme is built around. */
.slip-minimal__title {
  margin: 0 0 4px;
  font-family: inherit;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0;
  color: inherit;
  text-align: center;
}
.slip-minimal__who { margin: 0 0 16px; font-size: 15px; text-align: center; }
.slip-minimal__table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 12px;
  font-size: 15px;
}
.slip-minimal__table th,
.slip-minimal__table td {
  border: 1px solid var(--ink);
  padding: 5px 8px;
  text-align: center;
}
.slip-minimal__table th { font-weight: 700; }
/* The session column is a narrow index; the date column takes the rest. */
.slip-minimal__table th:first-child,
.slip-minimal__table td:first-child { width: 34%; }
.slip-minimal__class { margin: 0 0 6px; font-size: 15px; font-weight: 700; }
.slip-minimal__rate { margin: 0 0 4px; font-size: 15px; font-style: italic; }
.slip-minimal__total { margin: 8px 0 0; font-size: 16px; font-weight: 700; }
.slip-minimal__line { margin: 2px 0 0; font-size: 15px; }
.slip-minimal__empty { margin: 0; font-size: 15px; font-style: italic; }
`;

function MinimalSlip({ month, student, fee }: SlipData) {
  const { t, lang } = useLang();
  // Only worth naming the class per table when there is more than one to tell apart.
  const showClassNames = fee.lines.length > 1;

  return (
    <div className="slip-minimal">
      {/* Both forms go in; each language's template picks the one that reads correctly, since
          the Vietnamese sentence already contains the word "tháng". */}
      <h1 className="slip-minimal__title">
        {t('slip_fee_for', {
          month: monthLabel(month, lang),
          monthNum: monthNumeric(month),
        })}
      </h1>
      <p className="slip-minimal__who">
        {student.name}
        {student.phone ? ` · ${student.phone}` : ''}
      </p>

      {fee.lines.length === 0 ? (
        <p className="slip-minimal__empty">{t('slip_no_lines')}</p>
      ) : (
        fee.lines.map((line) => (
          <div key={line.classId}>
            {showClassNames ? <p className="slip-minimal__class">{line.className}</p> : null}
            <table className="slip-minimal__table">
              <thead>
                <tr>
                  <th>{t('slip_session_no')}</th>
                  <th>{t('slip_session_date')}</th>
                </tr>
              </thead>
              <tbody>
                {line.dates.length > 0 ? (
                  line.dates.map((date, i) => (
                    <tr key={`${date}-${i}`}>
                      <td>{i + 1}</td>
                      <td>{formatDmy(date)}</td>
                    </tr>
                  ))
                ) : (
                  // A month closed before the dates were stored (migration 0021) knows only the
                  // count, so show that rather than an empty table.
                  <tr>
                    <td>{line.sessions}</td>
                    <td>—</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="slip-minimal__rate">
              {t('slip_fee_per_session', { price: formatVnd(line.unitPriceVnd) })}
            </p>
          </div>
        ))
      )}

      {fee.adjustmentVnd !== 0 ? (
        <p className="slip-minimal__line">
          {t('tuition_adjustment')}
          {fee.adjustmentNote ? ` (${fee.adjustmentNote})` : ''}: {formatVnd(fee.adjustmentVnd)}
        </p>
      ) : null}

      <p className="slip-minimal__total">
        {t('slip_grand_total')}: {formatVnd(fee.dueVnd)} ({dongToWords(fee.dueVnd)})
      </p>

      {/* Nothing paid yet means outstanding equals the total, so the extra line would only repeat
          it — the paper receipts don't carry one either. */}
      {fee.paidVnd > 0 ? (
        <>
          <p className="slip-minimal__line">
            {t('slip_received')}
            {fee.paidAt ? ` · ${formatDmy(fee.paidAt)}` : ''}: {formatVnd(fee.paidVnd)}
          </p>
          {fee.outstandingVnd > 0 ? (
            <p className="slip-minimal__line">
              {t('slip_outstanding')}: {formatVnd(fee.outstandingVnd)}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ── Registry ───────────────────────────────────────────────────────────────────────────── */

export const SLIP_THEMES: SlipTheme[] = [
  { id: 'cute-pastel', labelKey: 'slip_theme_cute', Component: CutePastelSlip },
  { id: 'minimal', labelKey: 'slip_theme_minimal', Component: MinimalSlip },
  { id: 'classic', labelKey: 'slip_theme_classic', Component: ClassicSlip },
];

export const SLIP_THEME_CSS: Record<SlipThemeId, string> = {
  'cute-pastel': CUTE_PASTEL_CSS,
  minimal: MINIMAL_CSS,
  classic: CLASSIC_CSS,
};

export const DEFAULT_SLIP_THEME: SlipThemeId = 'cute-pastel';

export function isSlipThemeId(value: unknown): value is SlipThemeId {
  return SLIP_THEMES.some((theme) => theme.id === value);
}
