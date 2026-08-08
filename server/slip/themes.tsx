import { translate } from '../../shared/i18n/strings';
import { monthLabel } from '../../shared/logic/month';
import { formatDmy } from '../../shared/logic/dates';
import { dongToWords, formatVnd, monthNumeric, type StudentFee } from '../../shared/logic/fees';

/**
 * The three fee-slip themes, rebuilt for satori.
 *
 * A second implementation of `src/tuition/slip-themes.tsx` on purpose. satori has no CSS engine and
 * no cascade: it lays out inline `style` objects with a flexbox subset, so the web themes' class
 * names, `border-collapse` tables, cascading `--vars` and system-font stacks have nothing to bind
 * to. What is shared instead is `SlipData` — the same contract the print loader already produces —
 * plus every string and number, which come from `shared/`. A change to the *content* of a slip is
 * still made in one place; only the painting is duplicated.
 *
 * Deliberate degradations, per theme:
 *   - Classic's `<table border-collapse>` becomes flex rows with bottom borders. Visually the same
 *     grid; satori supports no table layout at all.
 *   - Minimal's bordered session table likewise, with the cell borders drawn per row.
 *   - Cute's inline `<svg>` doodles become one `<img>` with a data: URI (satori renders images but
 *     not SVG children), its `dotted` rules become `dashed` (satori supports solid/dashed only),
 *     and the cursive "cảm ơn" falls back to bold italic — satori has no system fonts, and shipping
 *     a script face for one line is not worth the bytes.
 *
 * Rendered in Vietnamese: the slip goes to a parent over Zalo, and the web slip's own audience is
 * the same. Nothing here reads a user's language preference.
 */

export type SlipData = {
  month: string;
  student: { id: string; name: string; guardian: string | null; phone: string | null };
  fee: StudentFee;
};

export type SlipThemeId = 'cute-pastel' | 'minimal' | 'classic';

export type SlipTheme = {
  id: SlipThemeId;
  /** satori needs an explicit canvas width; there is no viewport to resolve percentages against. */
  width: number;
  render: (data: SlipData) => React.ReactElement;
};

const LANG = 'vi';
const t = (key: string, vars?: Record<string, string | number>) => translate(LANG, key, vars);

/**
 * A two-family stack, not one family in two files.
 *
 * satori resolves a glyph by taking the FIRST font registered under a (name, weight, style) and
 * does not fall back to a later one with the same name — a second file registered as "Nunito Sans"
 * is simply ignored, which renders every ọ/ầ/đ/₫ as a blank box. Across *different* family names it
 * does fall back per glyph, so the Vietnamese subset ships under its own name and is listed second.
 */
const SANS = 'Nunito Sans, Nunito Sans VN';

/* ── Cute pastel ────────────────────────────────────────────────────────────────────────── */

/**
 * The teacup / cloud / bow doodle row, as a data: URI.
 *
 * satori draws `<img>` but not inline `<svg>` children, so the markup that is a component on the
 * web is a string here. Written with plain `#` colours and single-quoted attributes — the escaping
 * is `encodeURIComponent`'s job alone. Pre-escaping the hashes as `%23` double-encodes them, and a
 * colour the SVG parser cannot read silently paints the whole doodle black.
 */
const CUTE_DOODLES =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='176' height='60' viewBox='0 0 176 60' fill='none'>` +
      `<path d='M14 26h30v11a15 15 0 0 1-15 15A15 15 0 0 1 14 37V26Z' fill='#FFF6DA' stroke='#B99A63' stroke-width='2.2'/>` +
      `<path d='M44 30h5a7 7 0 0 1 0 14h-1' fill='none' stroke='#B99A63' stroke-width='2.2'/>` +
      `<path d='M22 17c2-5 6-5 8 0M32 14c2-5 6-5 8 0' fill='none' stroke='#E4BE7C' stroke-width='2.2' stroke-linecap='round'/>` +
      `<path d='M80 45a10 10 0 0 1 1-20 13 13 0 0 1 25 3 9 9 0 0 1-2 17H80Z' fill='#EAF4FB' stroke='#9DC2DA' stroke-width='2.2'/>` +
      `<path d='M148 24 162 34 148 44Z' fill='#FBD9C0' stroke='#E39A6A' stroke-width='2.2' stroke-linejoin='round'/>` +
      `<path d='M176 24 162 34 176 44Z' fill='#FBD9C0' stroke='#E39A6A' stroke-width='2.2' stroke-linejoin='round'/>` +
      `<circle cx='162' cy='34' r='4' fill='#F2762E'/>` +
      `</svg>`,
  );

const CUTE = { frame: '#FBE7A1', frameSoft: '#FDF3D0', accent: '#F2762E', ink: '#3B3226' };

function cuteField(label: string, value: string) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 9, fontSize: 15 }}>
      <span style={{ fontWeight: 700 }}>{label}:</span>
      <span
        style={{
          display: 'flex',
          flex: 1,
          borderBottom: `1.5px dashed #C9B896`,
          paddingBottom: 2,
          paddingLeft: 2,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function totalRow(label: string, value: string, style?: React.CSSProperties) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        paddingTop: 2,
        paddingBottom: 2,
        fontSize: 15,
        ...style,
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CutePastelSlip({ month, student, fee }: SlipData) {
  const classes = fee.lines.map((l) => l.className).join(', ');

  return (
    <div
      style={{
        display: 'flex',
        width: 640,
        backgroundColor: '#fff',
        color: CUTE.ink,
        fontFamily: SANS,
        fontSize: 15,
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          width: '100%',
          border: `10px solid ${CUTE.frame}`,
          borderRadius: 18,
          padding: '20px 24px 16px',
        }}
      >
        {/* The pastel blobs are clipped by the frame on the web via overflow:hidden; satori has no
            overflow, so they are inset far enough to stay inside it. */}
        <div
          style={{
            position: 'absolute',
            top: -10,
            left: -10,
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: CUTE.frameSoft,
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <div
            style={{ color: CUTE.accent, fontSize: 25, fontWeight: 700, letterSpacing: '0.04em' }}
          >
            {t('slip_title')}
          </div>
          <div style={{ marginTop: 2, fontSize: 14, color: '#7A6A55' }}>
            {monthLabel(month, LANG)}
          </div>
        </div>

        {cuteField(
          t('slip_parent_student'),
          student.guardian ? `${student.guardian} / ${student.name}` : student.name,
        )}
        {cuteField(t('slip_col_class'), classes)}
        {student.phone ? cuteField(t('slip_phone'), student.phone) : null}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 14,
            borderTop: `2px dashed ${CUTE.frame}`,
            paddingTop: 10,
          }}
        >
          {fee.lines.length === 0 ? (
            <div style={{ marginBottom: 6, fontStyle: 'italic', color: '#7A6A55', fontSize: 14 }}>
              {t('slip_no_lines')}
            </div>
          ) : (
            fee.lines.map((line) => (
              <div
                key={line.classId}
                style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 14.5 }}
              >
                <span style={{ fontWeight: 700 }}>{line.className}</span>
                <span style={{ color: '#7A6A55', fontSize: 13.5 }}>
                  {`${line.sessions} × ${formatVnd(line.unitPriceVnd)}`}
                </span>
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>
                  {formatVnd(line.amountVnd)}
                </span>
              </div>
            ))
          )}

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
            {fee.adjustmentVnd !== 0
              ? totalRow(
                  t('tuition_adjustment') +
                    (fee.adjustmentNote ? ` (${fee.adjustmentNote})` : ''),
                  formatVnd(fee.adjustmentVnd),
                )
              : null}
            {totalRow(t('slip_total'), formatVnd(fee.dueVnd), {
              borderTop: `2px solid ${CUTE.frame}`,
              marginTop: 5,
              paddingTop: 6,
              fontSize: 18,
              fontWeight: 700,
              color: CUTE.accent,
            })}
            {fee.paidVnd > 0
              ? totalRow(
                  t('slip_received') + (fee.paidAt ? ` · ${fee.paidAt}` : ''),
                  formatVnd(fee.paidVnd),
                )
              : null}
            {fee.outstandingVnd > 0
              ? totalRow(t('slip_outstanding'), formatVnd(fee.outstandingVnd), {
                  color: '#C2410C',
                  fontWeight: 700,
                })
              : null}
          </div>

          {fee.paymentNote ? (
            <div style={{ marginTop: 8, fontSize: 13, fontStyle: 'italic', color: '#7A6A55' }}>
              {fee.paymentNote}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginTop: 12,
          }}
        >
          <img src={CUTE_DOODLES} width={176} height={60} />
          {/* No script face on the server — bold italic carries the same "handwritten sign-off". */}
          <span style={{ fontSize: 22, fontStyle: 'italic', fontWeight: 700 }}>
            {t('slip_thank_you')}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Classic ────────────────────────────────────────────────────────────────────────────── */

const CLASSIC_COL = { name: '46%', sessions: '14%', price: '20%', amount: '20%' };

function classicRow(
  cells: [string, string, string, string],
  opts?: { head?: boolean },
): React.ReactElement {
  const base: React.CSSProperties = {
    display: 'flex',
    borderBottom: '1px solid #000',
    paddingTop: 5,
    paddingBottom: 5,
    fontSize: opts?.head ? 13 : 14.5,
    fontWeight: opts?.head ? 700 : 400,
  };
  const num: React.CSSProperties = { justifyContent: 'flex-end', display: 'flex' };
  return (
    <div style={base}>
      <span style={{ width: CLASSIC_COL.name }}>{cells[0]}</span>
      <span style={{ width: CLASSIC_COL.sessions, ...num }}>{cells[1]}</span>
      <span style={{ width: CLASSIC_COL.price, ...num }}>{cells[2]}</span>
      <span style={{ width: CLASSIC_COL.amount, ...num }}>{cells[3]}</span>
    </div>
  );
}

function ClassicSlip({ month, student, fee }: SlipData) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 640,
        backgroundColor: '#fff',
        color: '#000',
        fontFamily: SANS,
        fontSize: 15,
        padding: '28px 32px',
      }}
    >
      <div
        style={{
          fontSize: 21,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textAlign: 'center',
          marginBottom: 3,
        }}
      >
        {t('slip_title')}
      </div>
      <div style={{ textAlign: 'center', fontSize: 15, marginBottom: 16 }}>
        {monthLabel(month, LANG)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12, fontSize: 14.5 }}>
        <span>{`${t('slip_student')}: ${student.name}`}</span>
        {student.guardian ? (
          <span>{`${t('slip_guardian')}: ${student.guardian}`}</span>
        ) : null}
        {student.phone ? <span>{`${t('slip_phone')}: ${student.phone}`}</span> : null}
      </div>

      {fee.lines.length === 0 ? (
        <div style={{ fontStyle: 'italic' }}>{t('slip_no_lines')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
          {classicRow(
            [
              t('slip_col_class'),
              t('slip_col_sessions'),
              t('slip_col_price'),
              t('slip_col_amount'),
            ],
            { head: true },
          )}
          {fee.lines.map((line) => (
            <div key={line.classId} style={{ display: 'flex' }}>
              {classicRow([
                line.className,
                String(line.sessions),
                formatVnd(line.unitPriceVnd),
                formatVnd(line.amountVnd),
              ])}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', fontSize: 14.5 }}>
        {totalRow(t('slip_subtotal'), formatVnd(fee.billedVnd))}
        {fee.adjustmentVnd !== 0
          ? totalRow(
              t('tuition_adjustment') + (fee.adjustmentNote ? ` (${fee.adjustmentNote})` : ''),
              formatVnd(fee.adjustmentVnd),
            )
          : null}
        {totalRow(t('slip_total'), formatVnd(fee.dueVnd), {
          fontSize: 17,
          fontWeight: 700,
          borderTop: '2px solid #000',
          paddingTop: 5,
          marginTop: 3,
        })}
        {fee.paidVnd > 0
          ? totalRow(
              t('slip_received') + (fee.paidAt ? ` · ${fee.paidAt}` : ''),
              formatVnd(fee.paidVnd),
            )
          : null}
        {fee.outstandingVnd > 0
          ? totalRow(t('slip_outstanding'), formatVnd(fee.outstandingVnd), { fontWeight: 700 })
          : null}
      </div>

      {fee.paymentNote ? (
        <div style={{ fontSize: 13, fontStyle: 'italic', marginTop: 10 }}>{fee.paymentNote}</div>
      ) : null}
    </div>
  );
}

/* ── Minimal ────────────────────────────────────────────────────────────────────────────── */

/** One cell of the bordered session table. Borders are drawn per cell, not collapsed. */
function minimalCell(text: string, width: string, opts?: { head?: boolean; left?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        width,
        justifyContent: 'center',
        borderRight: '1px solid #000',
        borderBottom: '1px solid #000',
        borderLeft: opts?.left ? '1px solid #000' : 'none',
        borderTop: opts?.head ? '1px solid #000' : 'none',
        padding: '5px 8px',
        fontWeight: opts?.head ? 700 : 400,
      }}
    >
      {text}
    </div>
  );
}

function MinimalSlip({ month, student, fee }: SlipData) {
  // Only worth naming the class per table when there is more than one to tell apart.
  const showClassNames = fee.lines.length > 1;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 480,
        backgroundColor: '#fff',
        color: '#000',
        // The web theme uses a serif here; the Worker carries one family, and shipping a second
        // face to reproduce a font choice is not worth ~30 KB on every deploy.
        fontFamily: SANS,
        fontSize: 16,
        padding: '26px 30px 30px',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>
        {t('slip_fee_for', { month: monthLabel(month, LANG), monthNum: monthNumeric(month) })}
      </div>
      {/* Every text node below is a single interpolated string, not a run of children: satori
          refuses to lay out a <div> with more than one child unless it declares a display mode,
          and making these flex rows would break the wrapping the receipt depends on. */}
      <div style={{ fontSize: 15, textAlign: 'center', marginBottom: 16 }}>
        {student.name + (student.phone ? ` · ${student.phone}` : '')}
      </div>

      {fee.lines.length === 0 ? (
        <div style={{ fontSize: 15, fontStyle: 'italic' }}>{t('slip_no_lines')}</div>
      ) : (
        fee.lines.map((line) => (
          <div key={line.classId} style={{ display: 'flex', flexDirection: 'column' }}>
            {showClassNames ? (
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{line.className}</div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
              <div style={{ display: 'flex', fontSize: 15 }}>
                {minimalCell(t('slip_session_no'), '34%', { head: true, left: true })}
                {minimalCell(t('slip_session_date'), '66%', { head: true })}
              </div>
              {line.dates.length > 0 ? (
                line.dates.map((date, i) => (
                  <div key={`${date}-${i}`} style={{ display: 'flex', fontSize: 15 }}>
                    {minimalCell(String(i + 1), '34%', { left: true })}
                    {minimalCell(formatDmy(date), '66%')}
                  </div>
                ))
              ) : (
                // A month closed before the dates were stored (migration 0021) knows only the
                // count, so show that rather than an empty table.
                <div style={{ display: 'flex', fontSize: 15 }}>
                  {minimalCell(String(line.sessions), '34%', { left: true })}
                  {minimalCell('—', '66%')}
                </div>
              )}
            </div>
            <div style={{ fontSize: 15, fontStyle: 'italic', marginBottom: 4 }}>
              {t('slip_fee_per_session', { price: formatVnd(line.unitPriceVnd) })}
            </div>
          </div>
        ))
      )}

      {fee.adjustmentVnd !== 0 ? (
        <div style={{ fontSize: 15, marginTop: 2 }}>
          {`${t('tuition_adjustment')}${
            fee.adjustmentNote ? ` (${fee.adjustmentNote})` : ''
          }: ${formatVnd(fee.adjustmentVnd)}`}
        </div>
      ) : null}

      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
        {`${t('slip_grand_total')}: ${formatVnd(fee.dueVnd)} (${dongToWords(fee.dueVnd)})`}
      </div>

      {/* Nothing paid yet means outstanding equals the total, so the extra line would only repeat
          it — the paper receipts don't carry one either. */}
      {fee.paidVnd > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 15, marginTop: 2 }}>
            {`${t('slip_received')}${
              fee.paidAt ? ` · ${formatDmy(fee.paidAt)}` : ''
            }: ${formatVnd(fee.paidVnd)}`}
          </div>
          {fee.outstandingVnd > 0 ? (
            <div style={{ fontSize: 15, marginTop: 2 }}>
              {`${t('slip_outstanding')}: ${formatVnd(fee.outstandingVnd)}`}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Registry ───────────────────────────────────────────────────────────────────────────── */

export const SLIP_THEMES: SlipTheme[] = [
  { id: 'cute-pastel', width: 640, render: CutePastelSlip },
  { id: 'minimal', width: 480, render: MinimalSlip },
  { id: 'classic', width: 640, render: ClassicSlip },
];

export function isSlipThemeId(value: unknown): value is SlipThemeId {
  return SLIP_THEMES.some((theme) => theme.id === value);
}
