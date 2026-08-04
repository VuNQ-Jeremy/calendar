import React from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, Modal, MDatePicker, useConfirm } from './ui.jsx';
import { useLang } from './lib/i18n.jsx';
import { ATTENDANCE_META } from '../shared/logic/assess.js';
import type { AttendanceStatusId } from '../shared/logic/assess.js';
import { formatVnd, monthLabel, shiftMonth, studentFees } from '../shared/logic/tuition.js';
import type { StudentFee } from '../shared/logic/tuition.js';
import type {
  ClassPriceRow,
  MonthReport,
  TuitionLine,
  TuitionSettings,
} from '../server/services/tuition.js';
import type { StudentRow } from '../server/services/people.js';
import type { ClassLite } from '../server/services/classes.js';

const { Card, Button, IconButton, Badge, Avatar } = DS;

interface TuitionLoaderData {
  month: string;
  report: MonthReport;
  prices: ClassPriceRow[];
  classes: ClassLite[];
  students: StudentRow[];
  settings: TuitionSettings;
}

const STATUS_BADGE: Record<StudentFee['status'], { tk: string; color: string }> = {
  paid: { tk: 'tuition_status_paid', color: 'green' },
  partial: { tk: 'tuition_status_partial', color: 'orange' },
  unpaid: { tk: 'tuition_status_unpaid', color: 'rose' },
};

/** Bound to the active language; the formatting itself is shared with the fee slip. */
function useMonthLabel() {
  const { lang } = useLang();
  return (month: string) => monthLabel(month, lang);
}

/** Digits only — money is integer VND, and a stray separator must not become a different amount. */
function parseVnd(raw: string): number {
  const digits = raw.replace(/[^\d-]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

function VndField({
  label,
  value,
  onChange,
  hint,
  autoFocus,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="mochi-field">
      <label className="mochi-field__label">{label}</label>
      <input
        className="mochi-input"
        inputMode="numeric"
        autoFocus={autoFocus}
        value={String(value)}
        onChange={(e) => onChange(parseVnd(e.target.value))}
      />
      <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
        {formatVnd(value)}
        {hint ? ` · ${hint}` : ''}
      </div>
    </div>
  );
}

/** The per-class detail behind one student's total: sessions, the status mix, and the unit price. */
function LineRows({ lines }: { lines: TuitionLine[] }) {
  const { t } = useLang();
  return (
    <div className="m-stack" style={{ gap: 6, marginTop: 10 }}>
      {lines.map((line) => (
        <div
          key={line.classId}
          className="m-row"
          style={{ gap: 10, flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}
        >
          <span style={{ fontWeight: 700, minWidth: 140 }}>{line.className}</span>
          <span className="m-muted">
            {line.sessions} × {formatVnd(line.unitPriceVnd)}
          </span>
          {Object.entries(line.statusCounts).map(([status, n]) => {
            const meta = ATTENDANCE_META[status as AttendanceStatusId];
            return (
              <span key={status} className="mchip" style={{ fontSize: 'var(--text-xs)' }}>
                {meta ? t(meta.tk) : status}: {n}
              </span>
            );
          })}
          <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{formatVnd(line.amountVnd)}</span>
        </div>
      ))}
    </div>
  );
}

type PaymentDraft = { studentId: string; paidVnd: number; paidAt: string; paymentNote: string };
type AdjustmentDraft = { studentId: string; adjustmentVnd: number; adjustmentNote: string };
type PriceDraft = { classId: string; priceVnd: number; effectiveFrom: string };

/** Per-class price list with its effective-date history. */
function PricesModal({
  month,
  prices,
  classes,
  onClose,
  submit,
}: {
  month: string;
  prices: ClassPriceRow[];
  classes: ClassLite[];
  onClose: () => void;
  submit: (fd: FormData) => void;
}) {
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [draft, setDraft] = React.useState<PriceDraft | null>(null);

  const save = () => {
    if (!draft) return;
    const fd = new FormData();
    fd.set('intent', 'save-price');
    fd.set('month', month);
    fd.set('classId', draft.classId);
    fd.set('priceVnd', String(draft.priceVnd));
    fd.set('effectiveFrom', draft.effectiveFrom);
    submit(fd);
    setDraft(null);
  };

  const del = async (price: ClassPriceRow) => {
    const ok = await confirm({
      title: t('tuition_delete_price_confirm'),
      message: `${formatVnd(price.priceVnd)} · ${price.effectiveFrom}`,
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-price');
    fd.set('month', month);
    fd.set('id', price.id);
    submit(fd);
  };

  return (
    <Modal open onClose={onClose} title={t('tuition_prices')} width={620}>
      <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 12 }}>
        {t('tuition_price_hint')}
      </div>
      <div className="m-stack">
        {classes.map((cls) => {
          const own = prices
            .filter((p) => p.classId === cls.id)
            .toSorted((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
          return (
            <div key={cls.id} className="lrow" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="lrow__title">{cls.name}</div>
                {own.length ? (
                  <div className="m-stack" style={{ gap: 4, marginTop: 6 }}>
                    {own.map((price) => (
                      <div
                        key={price.id}
                        className="m-row"
                        style={{ gap: 8, fontSize: 'var(--text-sm)' }}
                      >
                        <span style={{ fontWeight: 700 }}>{formatVnd(price.priceVnd)}</span>
                        <span className="m-muted">
                          {t('tuition_effective_from')} {price.effectiveFrom}
                        </span>
                        <IconButton label={t('delete')} size="sm" onClick={() => void del(price)}>
                          <MIcon name="trash" size={14} />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="m-muted"
                    style={{ fontSize: 'var(--text-sm)', marginTop: 4, color: 'var(--danger)' }}
                  >
                    {t('tuition_price_none')}
                  </div>
                )}
              </div>
              <div className="lrow__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      classId: cls.id,
                      priceVnd: own[0]?.priceVnd ?? 0,
                      effectiveFrom: `${month}-01`,
                    })
                  }
                >
                  {t('tuition_add_price')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <Modal
          open
          onClose={() => setDraft(null)}
          title={classes.find((c) => c.id === draft.classId)?.name ?? t('tuition_add_price')}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={save}>
                {t('save')}
              </Button>
            </>
          }
        >
          <VndField
            label={t('tuition_price')}
            value={draft.priceVnd}
            autoFocus
            onChange={(priceVnd) => setDraft((d) => (d ? { ...d, priceVnd } : d))}
          />
          <MDatePicker
            label={t('tuition_effective_from')}
            value={draft.effectiveFrom}
            onChange={(effectiveFrom: string) => setDraft((d) => (d ? { ...d, effectiveFrom } : d))}
            hint={t('tuition_price_hint')}
          />
        </Modal>
      )}
      {confirmNode}
    </Modal>
  );
}

function TuitionScreen() {
  const { month, report, prices, classes, students, settings } =
    useLoaderData() as TuitionLoaderData;
  const fetcher = useFetcher<{ error?: string; classes?: { id: string; name: string }[] }>();
  const navigate = useNavigate();
  const { t } = useLang();
  const fmtMonth = useMonthLabel();
  const [confirm, confirmNode] = useConfirm();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [payment, setPayment] = React.useState<PaymentDraft | null>(null);
  const [adjustment, setAdjustment] = React.useState<AdjustmentDraft | null>(null);
  const [pricesOpen, setPricesOpen] = React.useState(false);

  const submit = (fd: FormData) =>
    fetcher.submit(fd, { action: `/tuition/${month}`, method: 'post' });

  const closed = report.status === 'closed';
  const fees = React.useMemo(
    () => studentFees(report.lines, report.studentMonths),
    [report.lines, report.studentMonths],
  );
  const studentById = React.useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const rows = React.useMemo(
    () =>
      fees.toSorted((a, b) =>
        (studentById.get(a.studentId)?.name ?? '').localeCompare(
          studentById.get(b.studentId)?.name ?? '',
        ),
      ),
    [fees, studentById],
  );

  const totals = rows.reduce(
    (acc, r) => ({
      due: acc.due + r.dueVnd,
      paid: acc.paid + r.paidVnd,
      outstanding: acc.outstanding + r.outstandingVnd,
    }),
    { due: 0, paid: 0, outstanding: 0 },
  );

  const toggle = (studentId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });

  const closeMonth = async () => {
    const ok = await confirm({
      title: t('tuition_close_confirm', { month: fmtMonth(month) }),
      message: t('tuition_close_confirm_msg'),
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'close-month');
    fd.set('month', month);
    submit(fd);
  };

  const reopenMonth = async () => {
    const ok = await confirm({
      title: t('tuition_reopen_confirm', { month: fmtMonth(month) }),
      message: t('tuition_reopen_confirm_msg'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'reopen-month');
    fd.set('month', month);
    submit(fd);
  };

  const savePayment = () => {
    if (!payment) return;
    const fd = new FormData();
    fd.set('intent', 'save-payment');
    fd.set('month', month);
    fd.set('studentId', payment.studentId);
    fd.set('paidVnd', String(payment.paidVnd));
    fd.set('paidAt', payment.paidAt);
    fd.set('paymentNote', payment.paymentNote);
    submit(fd);
    setPayment(null);
  };

  const saveAdjustment = () => {
    if (!adjustment) return;
    const fd = new FormData();
    fd.set('intent', 'save-adjustment');
    fd.set('month', month);
    fd.set('studentId', adjustment.studentId);
    fd.set('adjustmentVnd', String(adjustment.adjustmentVnd));
    fd.set('adjustmentNote', adjustment.adjustmentNote);
    submit(fd);
    setAdjustment(null);
  };

  // The close attempt is refused when a class has sessions but no price; name the classes.
  const refusedClasses = fetcher.data?.error === 'missing_price' ? fetcher.data.classes : undefined;
  const missing = refusedClasses ?? report.missingPriceClasses;

  return (
    <div className="content">
      <PageHeader
        title={t('tuition_title')}
        subtitle={t('tuition_sub')}
        actions={
          <div className="m-row" style={{ gap: 8 }}>
            <IconButton
              label={fmtMonth(shiftMonth(month, -1))}
              onClick={() => navigate(`/tuition/${shiftMonth(month, -1)}`)}
            >
              <MIcon name="chevronLeft" size={18} />
            </IconButton>
            <span style={{ fontWeight: 800, minWidth: 130, textAlign: 'center' }}>
              {fmtMonth(month)}
            </span>
            <IconButton
              label={fmtMonth(shiftMonth(month, 1))}
              onClick={() => navigate(`/tuition/${shiftMonth(month, 1)}`)}
            >
              <MIcon name="chevronRight" size={18} />
            </IconButton>
            <Button variant="secondary" onClick={() => setPricesOpen(true)}>
              {t('tuition_prices')}
            </Button>
            {closed ? (
              <Button variant="secondary" onClick={() => void reopenMonth()}>
                {t('tuition_reopen')}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void closeMonth()}>
                {t('tuition_close_month')}
              </Button>
            )}
          </div>
        }
      />

      <Card style={{ padding: 18, marginBottom: 14 }}>
        <div className="m-row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge color={closed ? 'neutral' : 'green'}>
            {closed ? t('tuition_closed') : t('tuition_open')}
          </Badge>
          {closed && report.closedAt && (
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
              {t('tuition_closed_on', {
                date: report.closedAt.slice(0, 10),
                who: report.closedBy ?? '—',
              })}
            </span>
          )}
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('tuition_students')}: <strong>{rows.length}</strong>
          </span>
          <span style={{ marginLeft: 'auto' }} className="m-row">
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)', marginRight: 6 }}>
              {t('tuition_total_due')}
            </span>
            <strong>{formatVnd(totals.due)}</strong>
          </span>
          <span className="m-row">
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)', marginRight: 6 }}>
              {t('tuition_paid_amount')}
            </span>
            <strong>{formatVnd(totals.paid)}</strong>
          </span>
          <span className="m-row">
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)', marginRight: 6 }}>
              {t('tuition_outstanding')}
            </span>
            <strong style={{ color: totals.outstanding > 0 ? 'var(--danger)' : undefined }}>
              {formatVnd(totals.outstanding)}
            </strong>
          </span>
        </div>
        {missing && missing.length > 0 && (
          <div
            style={{
              marginTop: 12,
              color: 'var(--danger)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
            }}
          >
            {t('tuition_missing_price', { classes: missing.map((c) => c.name).join(', ') })}
          </div>
        )}
        <div className="m-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>
          {t('tuition_billed_for')}:{' '}
          {settings.billableStatuses
            .map((s) => t(ATTENDANCE_META[s as AttendanceStatusId]?.tk ?? s))
            .join(', ')}
        </div>
      </Card>

      {rows.length ? (
        <div className="m-stack">
          {rows.map((row) => {
            const student = studentById.get(row.studentId);
            const badge = STATUS_BADGE[row.status];
            const isOpen = expanded.has(row.studentId);
            return (
              <div key={row.studentId} className="lrow" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="m-row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <Avatar
                      name={student?.name ?? row.studentId}
                      color={student?.color}
                      size="sm"
                    />
                    <span className="lrow__title">{student?.name ?? row.studentId}</span>
                    <Badge color={badge.color}>{t(badge.tk)}</Badge>
                  </div>
                  <div className="lrow__meta">
                    <span>
                      {t('tuition_sessions')}:{' '}
                      <strong>{row.lines.reduce((n, l) => n + l.sessions, 0)}</strong>
                    </span>
                    <span>
                      {t('tuition_total_due')}: <strong>{formatVnd(row.dueVnd)}</strong>
                    </span>
                    {row.adjustmentVnd !== 0 && (
                      <span>
                        {t('tuition_adjustment')}: {formatVnd(row.adjustmentVnd)}
                        {row.adjustmentNote ? ` (${row.adjustmentNote})` : ''}
                      </span>
                    )}
                    <span>
                      {t('tuition_paid_amount')}: <strong>{formatVnd(row.paidVnd)}</strong>
                      {row.paidAt ? ` · ${row.paidAt}` : ''}
                    </span>
                    {row.outstandingVnd > 0 && (
                      <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                        {t('tuition_outstanding')}: {formatVnd(row.outstandingVnd)}
                      </span>
                    )}
                  </div>
                  {isOpen && row.lines.length > 0 && <LineRows lines={row.lines} />}
                </div>
                <div className="lrow__actions">
                  {row.lines.length > 0 && (
                    <IconButton
                      label={student?.name ?? row.studentId}
                      size="sm"
                      onClick={() => toggle(row.studentId)}
                    >
                      <MIcon name={isOpen ? 'chevronDown' : 'chevronRight'} size={16} />
                    </IconButton>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setAdjustment({
                        studentId: row.studentId,
                        adjustmentVnd: row.adjustmentVnd,
                        adjustmentNote: row.adjustmentNote ?? '',
                      })
                    }
                  >
                    {t('tuition_adjustment')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      setPayment({
                        studentId: row.studentId,
                        paidVnd: row.paidVnd || row.dueVnd,
                        paidAt: row.paidAt ?? '',
                        paymentNote: row.paymentNote ?? '',
                      })
                    }
                  >
                    {t('tuition_record_payment')}
                  </Button>
                  <a
                    className="m-textlink"
                    href={`/tuition/${month}/${row.studentId}/print`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('tuition_print_slip')}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="banknote" title={t('tuition_empty')} sub={t('tuition_empty_sub')} />
      )}

      {payment && (
        <Modal
          open
          onClose={() => setPayment(null)}
          title={t('tuition_record_payment')}
          subtitle={studentById.get(payment.studentId)?.name}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPayment(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={savePayment}>
                {t('save')}
              </Button>
            </>
          }
        >
          <VndField
            label={t('tuition_paid_amount')}
            value={payment.paidVnd}
            autoFocus
            onChange={(paidVnd) => setPayment((p) => (p ? { ...p, paidVnd } : p))}
          />
          <MDatePicker
            label={t('tuition_payment_date')}
            value={payment.paidAt}
            clearable
            onChange={(paidAt: string) => setPayment((p) => (p ? { ...p, paidAt } : p))}
          />
          <div className="mochi-field">
            <label className="mochi-field__label">{t('tuition_payment_note')}</label>
            <input
              className="mochi-input"
              value={payment.paymentNote}
              onChange={(e) => setPayment((p) => (p ? { ...p, paymentNote: e.target.value } : p))}
            />
          </div>
        </Modal>
      )}

      {adjustment && (
        <Modal
          open
          onClose={() => setAdjustment(null)}
          title={t('tuition_edit_adjustment')}
          subtitle={studentById.get(adjustment.studentId)?.name}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdjustment(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={saveAdjustment}>
                {t('save')}
              </Button>
            </>
          }
        >
          <VndField
            label={t('tuition_adjustment')}
            value={adjustment.adjustmentVnd}
            autoFocus
            hint={t('tuition_adjustment_hint')}
            onChange={(adjustmentVnd) => setAdjustment((a) => (a ? { ...a, adjustmentVnd } : a))}
          />
          <div className="mochi-field">
            <label className="mochi-field__label">{t('tuition_adjustment_note')}</label>
            <input
              className="mochi-input"
              value={adjustment.adjustmentNote}
              onChange={(e) =>
                setAdjustment((a) => (a ? { ...a, adjustmentNote: e.target.value } : a))
              }
            />
          </div>
        </Modal>
      )}

      {pricesOpen && (
        <PricesModal
          month={month}
          prices={prices}
          classes={classes}
          onClose={() => setPricesOpen(false)}
          submit={submit}
        />
      )}
      {confirmNode}
    </div>
  );
}

export { TuitionScreen };
