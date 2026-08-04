import { useLoaderData } from 'react-router';
import { useLang } from '../lib/i18n.jsx';
import { formatVnd } from '../../shared/logic/tuition.js';
import type { StudentFee } from '../../shared/logic/tuition.js';

/**
 * Printable tuition slip (phiếu thu). Same house style as src/tests/print-view.tsx: hand-written
 * semantic markup plus one inline <style> block, no DS chrome, and no webfont — a strict CSP blocks
 * external fonts, and system fonts render Vietnamese diacritics fine.
 *
 * Sized for A5 so two fit on a sheet of A4 if the office prefers that.
 *
 * Customizable themes are a planned follow-up: this component owns all of the presentation, and
 * the loader hands over a flat, stable data shape, so a second theme is a sibling of this file.
 */

interface SlipLoaderData {
  month: string;
  student: { id: string; name: string; guardian: string | null };
  fee: StudentFee;
  closedAt: string | null;
  isClosed: boolean;
}

const CSS = `
.slip-doc {
  --ink: #000;
  background: #fff;
  color: var(--ink);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 11pt;
  line-height: 1.45;
}
/* Screen preview only: roughly an A5 text column. Print uses @page margins instead. */
.slip-doc .sheet {
  max-width: 130mm;
  margin: 0 auto;
  padding: 14mm 10mm 18mm;
  box-sizing: border-box;
}
.slip-doc h1 {
  font-size: 15pt;
  letter-spacing: 0.08em;
  text-align: center;
  margin: 0 0 2pt;
}
.slip-doc .month { text-align: center; font-size: 11pt; margin: 0 0 10pt; }
.slip-doc .who { margin: 0 0 8pt; font-size: 10.5pt; }
.slip-doc .who div { margin: 0 0 2pt; }
.slip-doc .provisional {
  border: 1pt solid var(--ink);
  padding: 2pt 6pt;
  margin: 0 0 8pt;
  font-size: 9.5pt;
  font-weight: 700;
  display: inline-block;
}
.slip-doc table { width: 100%; border-collapse: collapse; margin: 0 0 8pt; font-size: 10.5pt; }
.slip-doc th, .slip-doc td { border-bottom: 0.5pt solid var(--ink); padding: 3pt 2pt; text-align: left; }
.slip-doc th { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
.slip-doc td.num, .slip-doc th.num { text-align: right; white-space: nowrap; }
.slip-doc .totals { margin: 0 0 12pt; font-size: 10.5pt; }
.slip-doc .totals div { display: flex; justify-content: space-between; padding: 1.5pt 0; }
.slip-doc .totals .grand {
  font-size: 12pt;
  font-weight: 700;
  border-top: 1pt solid var(--ink);
  padding-top: 3pt;
  margin-top: 2pt;
}
.slip-doc .note { font-size: 9.5pt; font-style: italic; margin: 0 0 10pt; }
.slip-doc .signs { display: flex; gap: 10mm; margin-top: 14pt; font-size: 10pt; }
.slip-doc .signs > div { flex: 1; text-align: center; }
.slip-doc .signs .rule { border-bottom: 0.5pt dotted var(--ink); height: 16mm; }
.slip-doc .empty { font-style: italic; }
.print-toolbar {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 50;
  display: flex;
  gap: 8px;
  align-items: center;
  background: #fff;
  border: 1px solid #999;
  border-radius: 6px;
  padding: 6px 8px;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #000;
}
.print-toolbar button {
  font: inherit;
  padding: 3px 10px;
  border: 1px solid #666;
  border-radius: 4px;
  background: #f2f2f2;
  color: #000;
  cursor: pointer;
}
@media print {
  .no-print { display: none !important; }
  .slip-doc .sheet { max-width: none; margin: 0; padding: 0; }
}
@page { margin: 14mm; size: A5; }
`;

export function FeeSlipView() {
  const { month, student, fee, isClosed } = useLoaderData() as SlipLoaderData;
  const { t } = useLang();

  return (
    <div className="slip-doc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="print-toolbar no-print">
        <button type="button" onClick={() => window.print()}>
          {t('print_btn')}
        </button>
      </div>

      <div className="sheet">
        <h1>{t('slip_title')}</h1>
        <p className="month">
          {t('slip_month')} {month}
        </p>

        {/* An open month can still be re-billed, so a slip printed from one says so on paper. */}
        {!isClosed ? <div className="provisional">{t('slip_provisional')}</div> : null}

        <div className="who">
          <div>
            <strong>{t('slip_student')}:</strong> {student.name}
          </div>
          {student.guardian ? (
            <div>
              <strong>{t('slip_guardian')}:</strong> {student.guardian}
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
                {t('slip_paid')}
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

        <div className="signs">
          <div>
            <div className="rule" aria-hidden="true" />
            {t('slip_signature_payer')}
          </div>
          <div>
            <div className="rule" aria-hidden="true" />
            {t('slip_signature_receiver')}
          </div>
        </div>
      </div>
    </div>
  );
}
