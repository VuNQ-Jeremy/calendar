import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { FeeSlipView } from '../src/tuition/fee-slip.jsx';
import { SLIP_THEMES, DEFAULT_SLIP_THEME, isSlipThemeId } from '../src/tuition/slip-themes.jsx';

const LINE = {
  studentId: 'stu-1',
  classId: 'cls-1',
  className: 'Toán 9',
  sessions: 4,
  dates: ['2031-03-04', '2031-03-11', '2031-03-18', '2031-03-25'],
  statusCounts: { present: 3, late: 1 },
  unitPriceVnd: 150_000,
  amountVnd: 600_000,
};

const loaderData = (over: Record<string, unknown> = {}) => ({
  month: '2031-03',
  student: { id: 'stu-1', name: 'Nguyễn An', guardian: 'Nguyễn Bình', phone: '0901234567' },
  fee: {
    studentId: 'stu-1',
    lines: [LINE],
    billedVnd: 600_000,
    adjustmentVnd: -50_000,
    adjustmentNote: 'Giảm giá',
    dueVnd: 550_000,
    paidVnd: 300_000,
    paidAt: '2031-03-05',
    paymentNote: 'Chuyển khoản',
    outstandingVnd: 250_000,
    status: 'partial' as const,
  },
  closedAt: null,
  isClosed: false,
  ...over,
});

async function renderSlip(data: ReturnType<typeof loaderData>, entry = '/') {
  const Stub = createRoutesStub([{ path: '/', Component: FeeSlipView, loader: () => data }]);
  await act(async () => {
    render(
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(Stub, {
          initialEntries: [entry],
        }),
      ),
    );
  });
}

/** The one <select> on the page. Typed, so `.value` needs no cast at the call sites. */
function themePicker(): HTMLSelectElement {
  return screen.getByRole('combobox') as unknown as HTMLSelectElement;
}

describe('slip theme registry', () => {
  it('has a stable default and recognises only its own ids', () => {
    expect(SLIP_THEMES.map((x) => x.id)).toEqual(['cute-pastel', 'minimal', 'classic']);
    expect(DEFAULT_SLIP_THEME).toBe('cute-pastel');
    expect(isSlipThemeId('cute-pastel')).toBe(true);
    expect(isSlipThemeId('minimal')).toBe(true);
    expect(isSlipThemeId('classic')).toBe(true);
    expect(isSlipThemeId('nope')).toBe(false);
    expect(isSlipThemeId(null)).toBe(false);
  });
});

describe('FeeSlipView', () => {
  it('renders the cute theme by default with the money, the class and the phone', async () => {
    await renderSlip(loaderData());
    expect(screen.getByText('TUITION FEE SLIP')).toBeInTheDocument();
    // The month reads as a name, not as the raw key.
    expect(screen.getByText(/March 2031/)).toBeInTheDocument();
    expect(screen.getByText(/Nguyễn Bình \/ Nguyễn An/)).toBeInTheDocument();
    expect(screen.getByText('0901234567')).toBeInTheDocument();
    expect(screen.getByText('4 × 150.000 ₫')).toBeInTheDocument();
    // Due 600.000 − 50.000 adjustment, 300.000 paid, 250.000 still owed.
    expect(screen.getByText('550.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('-50.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('300.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('250.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('thank you')).toBeInTheDocument();
  });

  it('offers a copy-image button and no print button', async () => {
    await renderSlip(loaderData());
    expect(screen.getByRole('button', { name: 'Copy image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('drops the signature lines and the provisional banner on an open month', async () => {
    // isClosed: false used to render a "Provisional" banner; the slip no longer says anything
    // about the month being open, and the two signature blocks are gone for good.
    await renderSlip(loaderData({ isClosed: false }));
    expect(screen.queryByText(/Provisional/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Payer')).not.toBeInTheDocument();
    expect(screen.queryByText('Received by')).not.toBeInTheDocument();
    expect(screen.queryByText(/Người viết hóa đơn/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ngày.*tháng.*năm/)).not.toBeInTheDocument();
  });

  it('honours ?theme= and lists both styles in the picker', async () => {
    await renderSlip(loaderData(), '/?theme=classic');
    expect(themePicker().value).toBe('classic');
    // The classic theme is the table layout, so it has column headers the cute one does not.
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    // Namespaced classes only: a bare `.month` inherits the calendar's 7-column grid from the
    // global stylesheet, which used to break this line in half.
    expect(document.querySelector('.slip-classic__month')).not.toBeNull();
    expect(document.querySelector('.slip-classic .month')).toBeNull();
    expect(screen.getByRole('option', { name: 'Cute pastel' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Classic' })).toBeInTheDocument();
  });

  it('falls back to the default theme when ?theme= is nonsense', async () => {
    await renderSlip(loaderData(), '/?theme=sparkles');
    expect(themePicker().value).toBe('cute-pastel');
  });

  it('lists every session date and the total in words on the Minimal theme', async () => {
    await renderSlip(loaderData(), '/?theme=minimal');
    expect(themePicker().value).toBe('minimal');
    expect(screen.getByText('Session')).toBeInTheDocument();
    // One numbered row per billed session, dates written the way the paper receipts do.
    expect(screen.getByText('04/03/2031')).toBeInTheDocument();
    expect(screen.getByText('25/03/2031')).toBeInTheDocument();
    expect(screen.getByText(/Tuition: 150.000 ₫ \/ session/)).toBeInTheDocument();
    // 600.000 billed − 50.000 adjustment, spelled out beside the figure.
    expect(
      screen.getByText(/Total: 550.000 ₫ \(Năm trăm năm mươi nghìn đồng\)/),
    ).toBeInTheDocument();
    // A single class needs no heading to tell it apart.
    expect(screen.queryByText('Toán 9')).not.toBeInTheDocument();
  });

  it('names each class when the student is billed for more than one', async () => {
    await renderSlip(
      loaderData({
        fee: {
          ...loaderData().fee,
          lines: [
            LINE,
            {
              ...LINE,
              classId: 'cls-2',
              className: 'Lý 9',
              sessions: 1,
              dates: ['2031-03-06'],
              amountVnd: 150_000,
            },
          ],
        },
      }),
      '/?theme=minimal',
    );
    expect(screen.getByText('Toán 9')).toBeInTheDocument();
    expect(screen.getByText('Lý 9')).toBeInTheDocument();
  });

  it('shows the session count when a pre-0021 closed month has no stored dates', async () => {
    await renderSlip(
      loaderData({
        fee: { ...loaderData().fee, lines: [{ ...LINE, dates: [] }] },
      }),
      '/?theme=minimal',
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders a zero slip without a phone line when nothing was billed', async () => {
    await renderSlip(
      loaderData({
        student: { id: 'stu-1', name: 'Nguyễn An', guardian: null, phone: null },
        fee: {
          studentId: 'stu-1',
          lines: [],
          billedVnd: 0,
          adjustmentVnd: 0,
          adjustmentNote: null,
          dueVnd: 0,
          paidVnd: 0,
          paidAt: null,
          paymentNote: null,
          outstandingVnd: 0,
          status: 'paid' as const,
        },
      }),
    );
    expect(screen.getByText('No sessions billed this month.')).toBeInTheDocument();
    expect(screen.queryByText('Phone')).not.toBeInTheDocument();
    expect(screen.getByText('0 ₫')).toBeInTheDocument();
  });
});
