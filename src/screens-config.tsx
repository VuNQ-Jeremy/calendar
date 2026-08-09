import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, Modal, useConfirm } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { ATTENDANCE_STATUSES, ATTENDANCE_META } from '../shared/logic/assess.js';
import { resolveMemo, vietQrUrl } from '../shared/logic/fees.js';
import type { AttendanceStatusId } from '../shared/logic/assess.js';
import type { AssessmentTypeRow } from '../server/services/assessment-types.js';
import type { GradeLevelRow } from '../server/services/grade-levels.js';
import type { RemarkCriterionRow } from '../server/services/remark-criteria.js';
import type { TuitionPaymentInfo, TuitionSettings } from '../server/services/tuition.js';
import type { RankingWeights } from '../shared/logic/rankings.js';
import type { GardenSettings } from '../shared/logic/garden.js';
import { TAB_BAR_STYLES } from '../shared/schemas.js';
import type { ScrollbarStyle, TabBarStyle } from '../shared/schemas.js';

const { Card, Button, IconButton, Badge, Checkbox } = DS;

interface ConfigLoaderData {
  types: AssessmentTypeRow[];
  remarkCriteria: RemarkCriterionRow[];
  gradeLevels: GradeLevelRow[];
  uiPrefs: { scrollbar: ScrollbarStyle; mobileTabBar: TabBarStyle };
  tuitionSettings: TuitionSettings;
  rankingWeights: RankingWeights;
  gardenSettings: GardenSettings;
  paymentInfo: TuitionPaymentInfo;
  zalo: ZaloConfig;
}

/** What a pairing code is issued for. Student and parent are separate routes to one family. */
type ZaloKind = 'student' | 'parent' | 'class';

interface ZaloConfig {
  links: {
    id: string;
    chatId: string;
    kind: string;
    accountId: string | null;
    parentId: string | null;
    studentId: string | null;
    classId: string | null;
    displayName: string | null;
  }[];
  codes: {
    code: string;
    parentId: string | null;
    studentId: string | null;
    classId: string | null;
    expiresAt: string;
  }[];
  parents: { id: string; name: string }[];
  students: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  enabled: boolean;
}

// Mock colors are hardcoded hex (same values as the DS tokens) so each card
// always previews its own style regardless of the currently active preset.
const SB_PRESETS: Record<
  ScrollbarStyle,
  { tk: string; track: string; thumb: string; barW: number }
> = {
  slim: { tk: 'cfg_sb_slim', track: 'transparent', thumb: '#B8A893', barW: 6 },
  inset: { tk: 'cfg_sb_inset', track: '#F6EDDF', thumb: '#DBCBB4', barW: 9 },
  brand: { tk: 'cfg_sb_brand', track: 'transparent', thumb: '#F79A4E', barW: 6 },
  ghost: { tk: 'cfg_sb_ghost', track: 'transparent', thumb: 'rgba(184,168,147,0.35)', barW: 6 },
};

/**
 * Labels for the phone's tab-bar variants. Unlike the scrollbar presets there is nothing to
 * preview inline — the styling lives in mobile/components/TabBar.tsx and cannot run here — so
 * each mock is drawn in CSS (`.tbmock--<id>`) instead, keyed off the same ids the phone uses.
 */
const TB_LABEL: Record<TabBarStyle, string> = {
  pill: 'cfg_tb_pill',
  dock: 'cfg_tb_dock',
  indicator: 'cfg_tb_indicator',
};

type TypeDraft = { id?: string; name: string };

/**
 * Which attendance statuses the tuition module charges for. Its own component so the checkbox
 * state cannot collide with the cards around it; the amounts it changes live on /tuition.
 */
function TuitionSettingsSection({ settings }: { settings: TuitionSettings }) {
  const fetcher = useFetcher();
  const { t } = useLang();

  // Optimistic: the checkbox must respond on click, not after the round trip.
  const [local, setLocal] = React.useState<AttendanceStatusId[] | null>(null);
  const selected = local ?? (settings.billableStatuses as AttendanceStatusId[]);

  const toggle = (status: AttendanceStatusId) => {
    const next = selected.includes(status)
      ? selected.filter((s) => s !== status)
      : [...selected, status];
    // Billing nothing at all is not a state worth saving — the server would read it back as unset.
    if (next.length === 0) return;
    setLocal(next);
    const fd = new FormData();
    fd.set('intent', 'tuition-settings');
    fd.set('billableStatuses', JSON.stringify(next));
    fetcher.submit(fd, { action: '/config', method: 'post' });
  };

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_tuition_title')}</h2>
        <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
          {t('cfg_tuition_sub')}
        </p>
      </div>
      <div className="m-row" style={{ gap: 18, flexWrap: 'wrap' }}>
        {ATTENDANCE_STATUSES.map((status) => (
          <Checkbox
            key={status}
            label={t(ATTENDANCE_META[status].tk)}
            checked={selected.includes(status)}
            onChange={() => toggle(status)}
          />
        ))}
      </div>
      <p className="m-muted" style={{ margin: '10px 0 0', fontSize: 'var(--text-sm)' }}>
        {t('cfg_tuition_hint')}
      </p>
    </Card>
  );
}

/**
 * The centre's bank account, shown to students on the phone with a VietQR code.
 *
 * Edits are held in a draft until Save, so a half-typed account number never reaches a phone. The
 * QR tester below deliberately reads that draft rather than the saved row: the point of it is to
 * scan a code before committing the details, and a preview of the values you just replaced would
 * be worse than none. Every field is optional so a partly-filled form still saves, and the phone
 * shows only what is set — the fields are what a Vietnamese banking app needs to prefill a
 * transfer.
 */
function PaymentInfoSection({ info }: { info: TuitionPaymentInfo }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null);
  // The tester's own inputs. An amount and a name are needed to build a realistic code, and they
  // are not part of the saved settings — a real one is composed per student-month on the server.
  const [testAmount, setTestAmount] = React.useState('300000');
  const [testName, setTestName] = React.useState('Nguyễn Văn A');
  const [qrFailed, setQrFailed] = React.useState(false);

  const FIELDS: { key: keyof TuitionPaymentInfo; tk: string; hint?: string }[] = [
    { key: 'bankName', tk: 'cfg_payment_bank_name' },
    { key: 'bankCode', tk: 'cfg_payment_bank_code', hint: 'cfg_payment_bank_code_hint' },
    { key: 'accountNumber', tk: 'cfg_payment_account' },
    { key: 'accountHolder', tk: 'cfg_payment_holder' },
    { key: 'memoTemplate', tk: 'cfg_payment_memo', hint: 'cfg_payment_memo_hint' },
  ];

  const saved = Object.fromEntries(FIELDS.map((f) => [f.key, info[f.key] ?? '']));
  const current = draft ?? saved;

  const save = () => {
    const fd = new FormData();
    fd.set('intent', 'payment-info');
    for (const f of FIELDS) fd.set(f.key, current[f.key] ?? '');
    fetcher.submit(fd, { action: '/config', method: 'post' });
    setDraft(null);
  };

  // The same two helpers the API calls per student-month, given a test amount and name. Building
  // the URL any other way here would test this form rather than what a parent actually receives.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const testMemo = resolveMemo(current.memoTemplate || '', { month: thisMonth, name: testName });
  const qrReady = Boolean(current.bankCode && current.accountNumber);
  const qrUrl = qrReady
    ? vietQrUrl({
        bankCode: current.bankCode,
        accountNumber: current.accountNumber,
        accountHolder: current.accountHolder || '',
        amountVnd: Number(testAmount) || 0,
        memo: testMemo,
      })
    : '';

  // A new URL is a new attempt; without this a code that failed once stays failed after a fix.
  React.useEffect(() => setQrFailed(false), [qrUrl]);

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_payment_title')}</h2>
        <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
          {t('cfg_payment_sub')}
        </p>
      </div>
      <div className="m-row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {FIELDS.map((f) => (
          <div key={f.key} className="mochi-field" style={{ marginBottom: 0, minWidth: 200 }}>
            <label className="mochi-field__label">{t(f.tk)}</label>
            <input
              className="mochi-input"
              value={current[f.key] ?? ''}
              onChange={(e) => setDraft({ ...current, [f.key]: e.target.value })}
            />
            {f.hint ? (
              <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
                {t(f.hint)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <Button onClick={save} disabled={!draft}>
          {t('save')}
        </Button>
      </div>

      <div
        style={{
          marginTop: 18,
          paddingTop: 18,
          borderTop: '1px solid var(--border)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{t('cfg_payment_test_title')}</h3>
        <p className="m-muted" style={{ margin: '4px 0 12px', fontSize: 'var(--text-sm)' }}>
          {t('cfg_payment_test_sub')}
        </p>
        <div className="m-row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 12, flex: '1 1 260px', minWidth: 240 }}>
            <div className="mochi-field" style={{ marginBottom: 0 }}>
              <label className="mochi-field__label">{t('cfg_payment_test_amount')}</label>
              <input
                className="mochi-input"
                inputMode="numeric"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="mochi-field" style={{ marginBottom: 0 }}>
              <label className="mochi-field__label">{t('cfg_payment_test_name')}</label>
              <input
                className="mochi-input"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
              />
            </div>
            {qrReady ? (
              <div>
                <div className="mochi-field__label">{t('cfg_payment_test_memo')}</div>
                <code style={{ fontSize: 'var(--text-sm)', wordBreak: 'break-word' }}>
                  {testMemo}
                </code>
              </div>
            ) : null}
            {draft ? (
              <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                {t('cfg_payment_test_unsaved')}
              </p>
            ) : null}
          </div>

          <div style={{ flex: '0 0 auto', minWidth: 220 }}>
            {!qrReady ? (
              <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                {t('cfg_payment_test_missing')}
              </p>
            ) : qrFailed ? (
              <p className="m-muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                {t('cfg_payment_test_error')}
              </p>
            ) : (
              <img
                // Keyed by the URL so React remounts on any field change: without it the error
                // state from a bad bank code would stick to the next, valid, code.
                key={qrUrl}
                src={qrUrl}
                alt={t('cfg_payment_test_title')}
                width={220}
                height={330}
                // A wrong bank code does not come back as an HTTP error: img.vietqr.io answers
                // 200 with the 13-byte body `invalid acqId` and no content-type. The decode
                // fails, so `onError` is what catches it — a status check never would.
                onError={() => setQrFailed(true)}
                style={{ width: 220, height: 'auto', borderRadius: 12, display: 'block' }}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * How much ý thức counts against the test average on /rankings. Unlike the tuition card above
 * this one does not save on every keystroke: a pair only means anything once it adds up to 100,
 * so the edits are held in a draft until Save.
 */
function RankingWeightsSection({ weights }: { weights: RankingWeights }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [draft, setDraft] = React.useState<{ attitude: string; score: string } | null>(null);

  const current = draft ?? { attitude: String(weights.attitude), score: String(weights.score) };
  const attitude = Number(current.attitude);
  const score = Number(current.score);
  const valid =
    current.attitude !== '' &&
    current.score !== '' &&
    Number.isInteger(attitude) &&
    Number.isInteger(score) &&
    attitude >= 0 &&
    score >= 0 &&
    attitude + score === 100;

  /** Typing in one box moves the other, so the pair stays saveable without extra arithmetic. */
  const edit = (field: 'attitude' | 'score', value: string) => {
    const n = Number(value);
    const other = value !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? String(100 - n) : '';
    setDraft(
      field === 'attitude' ? { attitude: value, score: other } : { attitude: other, score: value },
    );
  };

  const save = () => {
    if (!valid) return;
    const fd = new FormData();
    fd.set('intent', 'ranking-weights');
    fd.set('attitude', String(attitude));
    fd.set('score', String(score));
    fetcher.submit(fd, { action: '/config', method: 'post' });
    setDraft(null);
  };

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_rank_title')}</h2>
        <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
          {t('cfg_rank_sub')}
        </p>
      </div>
      <div className="m-row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="mochi-field" style={{ marginBottom: 0 }}>
          <label className="mochi-field__label">{t('cfg_rank_attitude')}</label>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            className="mochi-input"
            value={current.attitude}
            onChange={(e) => edit('attitude', e.target.value)}
          />
        </div>
        <div className="mochi-field" style={{ marginBottom: 0 }}>
          <label className="mochi-field__label">{t('cfg_rank_score')}</label>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            className="mochi-input"
            value={current.score}
            onChange={(e) => edit('score', e.target.value)}
          />
        </div>
        <Button onClick={save} disabled={!valid || !draft}>
          {t('save')}
        </Button>
      </div>
      <p
        className="m-muted"
        style={{
          margin: '10px 0 0',
          fontSize: 'var(--text-sm)',
          color: valid ? undefined : colorOf('rose').ink,
        }}
      >
        {t('cfg_rank_hint')}
      </p>
    </Card>
  );
}

/**
 * How fast the vocabulary garden grows, and how long a plant survives being ignored.
 *
 * Held in a draft until Save, like the weights card above: these four numbers are read together by
 * every plant in the school, and saving a half-typed field would visibly re-time everyone's garden.
 * The bounds match `GardenSettingsInput` — the form refuses what the schema would reject anyway.
 */
function GardenSettingsSection({ settings }: { settings: GardenSettings }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null);

  const FIELDS = [
    { key: 'freeMinScorePct', tk: 'cfg_garden_min_score', min: 0, max: 100, step: 5 },
    { key: 'wiltAfterDays', tk: 'cfg_garden_wilt', min: 1, max: 30, step: 1 },
    { key: 'dropAfterDays', tk: 'cfg_garden_drop', min: 1, max: 60, step: 1 },
    { key: 'dailyGrowthCap', tk: 'cfg_garden_cap', min: 1, max: 5, step: 1 },
  ] as const;

  const current = draft ?? Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])]));
  const valid = FIELDS.every((f) => {
    const n = Number(current[f.key]);
    return current[f.key] !== '' && Number.isInteger(n) && n >= f.min && n <= f.max;
  });

  const save = () => {
    if (!valid) return;
    const fd = new FormData();
    fd.set('intent', 'garden-settings');
    for (const f of FIELDS) fd.set(f.key, String(Number(current[f.key])));
    fetcher.submit(fd, { action: '/config', method: 'post' });
    setDraft(null);
  };

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_garden')}</h2>
        <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
          {t('cfg_garden_sub')}
        </p>
      </div>
      <div className="m-row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {FIELDS.map((f) => (
          <div key={f.key} className="mochi-field" style={{ marginBottom: 0 }}>
            <label className="mochi-field__label">{t(f.tk)}</label>
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              className="mochi-input"
              value={current[f.key]}
              onChange={(e) => setDraft({ ...current, [f.key]: e.target.value })}
            />
          </div>
        ))}
        <Button onClick={save} disabled={!valid || !draft}>
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Managed grade levels (Khối 6..9). Structural clone of the assessment-types card above,
 * kept as its own component so the two cards' drag/modal state can't collide.
 */
function GradeLevelsSection({ levels }: { levels: GradeLevelRow[] }) {
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<TypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

  const openAdd = () => setModal({ name: '' });
  const openRename = (gl: GradeLevelRow) => setModal({ id: gl.id, name: gl.name });

  const save = (draft: TypeDraft) => {
    const fd = new FormData();
    fd.set('intent', draft.id ? 'update-level' : 'create-level');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim());
    submit(fd);
    setModal(null);
  };

  const toggleActive = async (gl: GradeLevelRow) => {
    if (gl.active) {
      const ok = await confirm({
        title: t('cfg_deactivate'),
        message: gl.name + '?',
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', 'update-level');
    fd.set('id', gl.id);
    fd.set('active', String(!gl.active));
    submit(fd);
  };

  const del = async (gl: GradeLevelRow) => {
    const ok = await confirm({
      title: t('gl_delete_confirm'),
      message: gl.name + '?',
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-level');
    fd.set('id', gl.id);
    submit(fd);
  };

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const reorderPending = React.useRef(false);

  const ordered = React.useMemo(() => {
    if (!localOrder) return levels;
    const byId = new Map(levels.map((gl) => [gl.id, gl]));
    const rows = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const gl of levels) if (!localOrder.includes(gl.id)) rows.push(gl);
    return rows;
  }, [levels, localOrder]);

  React.useEffect(() => {
    if (fetcher.state === 'idle' && reorderPending.current) {
      reorderPending.current = false;
      setLocalOrder(null);
    }
  }, [fetcher.state]);

  const previewMove = (srcId: string, overId: string) => {
    setLocalOrder((prev) => {
      const cur = prev ?? levels.map((gl) => gl.id);
      const from = cur.indexOf(srcId);
      const to = cur.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = cur.slice();
      next.splice(from, 1);
      next.splice(to, 0, srcId);
      return next;
    });
  };

  const commitOrder = () => {
    setDragId(null);
    if (!localOrder) return;
    if (localOrder.join('|') === levels.map((gl) => gl.id).join('|')) {
      setLocalOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'reorder-levels');
    fd.set('ids', JSON.stringify(localOrder));
    submit(fd);
    reorderPending.current = true;
  };

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div
        className="m-row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('gl_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('gl_subtitle')}
          </p>
        </div>
        <Button variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openAdd}>
          {t('gl_add')}
        </Button>
      </div>
      {ordered.length ? (
        <div className="m-stack">
          {ordered.map((gl) => (
            <div
              key={gl.id}
              className={'lrow' + (dragId === gl.id ? ' is-dragging' : '')}
              draggable
              onDragStart={(e) => {
                setDragId(gl.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', gl.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragId && dragId !== gl.id) previewMove(dragId, gl.id);
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={commitOrder}
            >
              <span className="lrow__grip" title={t('cfg_drag_reorder')} aria-hidden="true">
                <MIcon name="grip" size={16} />
              </span>
              <div className="m-row" style={{ flex: 1, gap: 10 }}>
                <span className="lrow__title">{gl.name}</span>
                <Badge color={gl.active ? 'green' : 'neutral'}>
                  {gl.active ? t('cfg_active') : t('cfg_inactive')}
                </Badge>
              </div>
              <div className="lrow__actions">
                <IconButton label={t('cfg_rename')} size="sm" onClick={() => openRename(gl)}>
                  <MIcon name="edit" size={16} />
                </IconButton>
                <Button variant="secondary" size="sm" onClick={() => toggleActive(gl)}>
                  {gl.active ? t('cfg_deactivate') : t('cfg_activate')}
                </Button>
                <IconButton label={t('delete')} size="sm" onClick={() => del(gl)}>
                  <MIcon name="trash" size={16} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="settings" title={t('gl_empty')} />
      )}

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('cfg_rename') : t('gl_add')}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" disabled={!modal.name.trim()} onClick={() => save(modal)}>
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('gl_name_ph')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.name}
              onChange={(e) => setModal((m) => (m ? { ...m, name: e.target.value } : m))}
            />
          </div>
          {fetcher.data?.error && (
            <div className="m-muted" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
              {fetcher.data.error}
            </div>
          )}
        </Modal>
      )}
      {confirmNode}
    </Card>
  );
}

/**
 * The monthly report's rating rows (remark criteria). Structural clone of GradeLevelsSection —
 * its own component for the same reason: drag/modal state that must not collide with the cards
 * around it.
 */
function RemarkCriteriaSection({ criteria }: { criteria: RemarkCriterionRow[] }) {
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<TypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

  const openAdd = () => setModal({ name: '' });
  const openRename = (c: RemarkCriterionRow) => setModal({ id: c.id, name: c.name });

  const save = (draft: TypeDraft) => {
    const fd = new FormData();
    fd.set('intent', draft.id ? 'update-criterion' : 'create-criterion');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim());
    submit(fd);
    setModal(null);
  };

  const toggleActive = async (c: RemarkCriterionRow) => {
    if (c.active) {
      const ok = await confirm({
        title: t('cfg_deactivate'),
        message: c.name + '?',
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', 'update-criterion');
    fd.set('id', c.id);
    fd.set('active', String(!c.active));
    submit(fd);
  };

  const del = async (c: RemarkCriterionRow) => {
    const ok = await confirm({
      title: t('cfg_delete_q'),
      message: t('cfg_delete_msg', { name: c.name }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-criterion');
    fd.set('id', c.id);
    submit(fd);
  };

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const reorderPending = React.useRef(false);

  const ordered = React.useMemo(() => {
    if (!localOrder) return criteria;
    const byId = new Map(criteria.map((c) => [c.id, c]));
    const rows = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const c of criteria) if (!localOrder.includes(c.id)) rows.push(c);
    return rows;
  }, [criteria, localOrder]);

  React.useEffect(() => {
    if (fetcher.state === 'idle' && reorderPending.current) {
      reorderPending.current = false;
      setLocalOrder(null);
    }
  }, [fetcher.state]);

  const previewMove = (srcId: string, overId: string) => {
    setLocalOrder((prev) => {
      const cur = prev ?? criteria.map((c) => c.id);
      const from = cur.indexOf(srcId);
      const to = cur.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = cur.slice();
      next.splice(from, 1);
      next.splice(to, 0, srcId);
      return next;
    });
  };

  const commitOrder = () => {
    setDragId(null);
    if (!localOrder) return;
    if (localOrder.join('|') === criteria.map((c) => c.id).join('|')) {
      setLocalOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'reorder-criteria');
    fd.set('ids', JSON.stringify(localOrder));
    submit(fd);
    reorderPending.current = true;
  };

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div
        className="m-row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_criteria_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('cfg_criteria_sub')}
          </p>
        </div>
        <Button variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openAdd}>
          {t('cfg_add_criterion')}
        </Button>
      </div>
      {ordered.length ? (
        <div className="m-stack">
          {ordered.map((c) => (
            <div
              key={c.id}
              className={'lrow' + (dragId === c.id ? ' is-dragging' : '')}
              draggable
              onDragStart={(e) => {
                setDragId(c.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', c.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragId && dragId !== c.id) previewMove(dragId, c.id);
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={commitOrder}
            >
              <span className="lrow__grip" title={t('cfg_drag_reorder')} aria-hidden="true">
                <MIcon name="grip" size={16} />
              </span>
              <div className="m-row" style={{ flex: 1, gap: 10 }}>
                <span className="lrow__title">{c.name}</span>
                <Badge color={c.active ? 'green' : 'neutral'}>
                  {c.active ? t('cfg_active') : t('cfg_inactive')}
                </Badge>
              </div>
              <div className="lrow__actions">
                <IconButton label={t('cfg_rename')} size="sm" onClick={() => openRename(c)}>
                  <MIcon name="edit" size={16} />
                </IconButton>
                <Button variant="secondary" size="sm" onClick={() => toggleActive(c)}>
                  {c.active ? t('cfg_deactivate') : t('cfg_activate')}
                </Button>
                <IconButton label={t('delete')} size="sm" onClick={() => del(c)}>
                  <MIcon name="trash" size={16} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="settings" title={t('cfg_no_criteria')} />
      )}

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('cfg_rename') : t('cfg_add_criterion')}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" disabled={!modal.name.trim()} onClick={() => save(modal)}>
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('cfg_criterion_name_ph')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.name}
              onChange={(e) => setModal((m) => (m ? { ...m, name: e.target.value } : m))}
            />
          </div>
          {fetcher.data?.error && (
            <div className="m-muted" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
              {fetcher.data.error}
            </div>
          )}
        </Modal>
      )}
      {confirmNode}
    </Card>
  );
}

/**
 * Zalo connections.
 *
 * The one screen where the school's real communication channel becomes visible. Pairing is a
 * two-step dance by necessity: generate a code here, and the person messages it to the bot from
 * their own Zalo. It cannot be done from this side alone — Zalo will not tell us who anybody is
 * until they talk to the bot first, and parents have no login to do it themselves.
 *
 * The code is shown once, large, with the sentence to forward alongside it, because what actually
 * happens next is a teacher copying both into a chat.
 */
function ZaloSection({ zalo }: { zalo: ZaloConfig }) {
  const fetcher = useFetcher<{ code?: string; error?: string }>();
  const { t } = useLang();
  const [kind, setKind] = React.useState<ZaloKind>('student');
  const [targetId, setTargetId] = React.useState('');

  const nameIn = (list: { id: string; name: string }[], id: string | null) =>
    list.find((x) => x.id === id)?.name ?? t('zalo_unknown');

  const label = (l: ZaloConfig['links'][number]) =>
    l.classId
      ? `${t('zalo_group')} · ${nameIn(zalo.classes, l.classId)}`
      : l.studentId
        ? `${t('zalo_student')} · ${nameIn(zalo.students, l.studentId)}`
        : l.parentId
          ? `${t('zalo_parent')} · ${nameIn(zalo.parents, l.parentId)}`
          : `${t('zalo_staff')} · ${l.displayName ?? l.chatId}`;

  // Student first, and the default: every student can be paired, whereas `parents` rows are
  // entered by hand and most families have none.
  const options =
    kind === 'student' ? zalo.students : kind === 'parent' ? zalo.parents : zalo.classes;
  const current = targetId || options[0]?.id || '';

  const generate = () => {
    if (!current) return;
    const fd = new FormData();
    fd.set('intent', 'zalo-code');
    fd.set('kind', kind);
    fd.set(`${kind}Id`, current);
    fetcher.submit(fd, { action: '/config', method: 'post' });
  };

  const unlink = (id: string) => {
    const fd = new FormData();
    fd.set('intent', 'zalo-unlink');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/config', method: 'post' });
  };

  const issued = fetcher.data?.code;

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('zalo_title')}</h2>
        <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
          {t('zalo_sub')}
        </p>
      </div>

      {!zalo.enabled ? (
        <Badge color="orange">{t('zalo_disabled')}</Badge>
      ) : (
        <>
          <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="mochi-field" style={{ marginBottom: 0, minWidth: 140 }}>
              <label className="mochi-field__label">{t('zalo_target')}</label>
              <select
                className="mochi-input"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ZaloKind);
                  setTargetId('');
                }}
              >
                <option value="student">{t('zalo_student')}</option>
                <option value="parent">{t('zalo_parent')}</option>
                <option value="class">{t('zalo_group')}</option>
              </select>
            </div>
            <div className="mochi-field" style={{ marginBottom: 0, minWidth: 200 }}>
              <label className="mochi-field__label">
                {kind === 'student'
                  ? t('zalo_student')
                  : kind === 'parent'
                    ? t('zalo_parent')
                    : t('zalo_class')}
              </label>
              <select
                className="mochi-input"
                value={current}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={generate} disabled={!current}>
              {t('zalo_generate')}
            </Button>
          </div>

          {issued ? (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 12,
                background: 'var(--surface-2, #F6EDDF)',
              }}
            >
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: 4 }}>
                {issued}
              </div>
              <p className="m-muted" style={{ margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
                {kind === 'class' ? t('zalo_hint_group') : t('zalo_hint_parent')}
              </p>
            </div>
          ) : null}

          <div style={{ marginTop: 18 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-lg)' }}>{t('zalo_linked')}</h3>
            {zalo.links.length === 0 ? (
              <Empty title={t('zalo_none')} />
            ) : (
              zalo.links.map((l) => (
                <div
                  key={l.id}
                  className="m-row"
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 0',
                  }}
                >
                  <span>{label(l)}</span>
                  <IconButton label={t('delete')} title={t('delete')} onClick={() => unlink(l.id)}>
                    <MIcon name="trash" />
                  </IconButton>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function SystemConfigScreen() {
  const {
    types,
    remarkCriteria,
    gradeLevels,
    uiPrefs,
    tuitionSettings,
    rankingWeights,
    gardenSettings,
    paymentInfo,
    zalo,
  } = useLoaderData() as ConfigLoaderData;
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<TypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

  const [sbLocal, setSbLocal] = React.useState<ScrollbarStyle | null>(null);
  const scrollbar = sbLocal ?? uiPrefs.scrollbar;

  const pickScrollbar = (key: ScrollbarStyle) => {
    setSbLocal(key);
    document.documentElement.dataset.scrollbar = key; // instant whole-app preview
    const fd = new FormData();
    fd.set('intent', 'ui-prefs');
    fd.set('scrollbar', key);
    submit(fd);
  };

  // Optimistic local state as above, but there is nothing to preview on this screen — the change
  // shows up on a phone, which picks it up on its next fetch of /api/settings/ui-prefs.
  const [tbLocal, setTbLocal] = React.useState<TabBarStyle | null>(null);
  const mobileTabBar = tbLocal ?? uiPrefs.mobileTabBar;

  const pickTabBar = (key: TabBarStyle) => {
    setTbLocal(key);
    const fd = new FormData();
    fd.set('intent', 'ui-prefs');
    fd.set('mobileTabBar', key);
    submit(fd);
  };

  const openAdd = () => setModal({ name: '' });
  const openRename = (tp: AssessmentTypeRow) => setModal({ id: tp.id, name: tp.name });

  const save = (draft: TypeDraft) => {
    const fd = new FormData();
    fd.set('intent', draft.id ? 'update-type' : 'create-type');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim());
    submit(fd);
    setModal(null);
  };

  const toggleActive = async (tp: AssessmentTypeRow) => {
    if (tp.active) {
      const ok = await confirm({
        title: t('cfg_deactivate'),
        message: tp.name + '?',
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', 'update-type');
    fd.set('id', tp.id);
    fd.set('active', String(!tp.active));
    submit(fd);
  };

  const del = async (tp: AssessmentTypeRow) => {
    const ok = await confirm({
      title: t('cfg_delete_q'),
      message: t('cfg_delete_msg', { name: tp.name }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-type');
    fd.set('id', tp.id);
    submit(fd);
  };

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const reorderPending = React.useRef(false);

  // Show the in-progress drag order; fall back to server order.
  const ordered = React.useMemo(() => {
    if (!localOrder) return types;
    const byId = new Map(types.map((tp) => [tp.id, tp]));
    const rows = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const tp of types) if (!localOrder.includes(tp.id)) rows.push(tp);
    return rows;
  }, [types, localOrder]);

  React.useEffect(() => {
    if (fetcher.state === 'idle' && reorderPending.current) {
      reorderPending.current = false;
      setLocalOrder(null);
    }
  }, [fetcher.state]);

  const previewMove = (srcId: string, overId: string) => {
    setLocalOrder((prev) => {
      const cur = prev ?? types.map((tp) => tp.id);
      const from = cur.indexOf(srcId);
      const to = cur.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = cur.slice();
      next.splice(from, 1);
      next.splice(to, 0, srcId);
      return next;
    });
  };

  const commitOrder = () => {
    setDragId(null);
    if (!localOrder) return;
    if (localOrder.join('|') === types.map((tp) => tp.id).join('|')) {
      setLocalOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'reorder-types');
    fd.set('ids', JSON.stringify(localOrder));
    submit(fd);
    reorderPending.current = true;
  };

  return (
    <div className="content">
      <PageHeader title={t('cfg_title')} subtitle={t('cfg_sub')} />
      <Card style={{ padding: 18 }}>
        <div
          className="m-row"
          style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_types_title')}</h2>
          <Button variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openAdd}>
            {t('cfg_add_type')}
          </Button>
        </div>
        {ordered.length ? (
          <div className="m-stack">
            {ordered.map((tp) => (
              <div
                key={tp.id}
                className={'lrow' + (dragId === tp.id ? ' is-dragging' : '')}
                draggable
                onDragStart={(e) => {
                  setDragId(tp.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', tp.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragId && dragId !== tp.id) previewMove(dragId, tp.id);
                }}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={commitOrder}
              >
                <span className="lrow__grip" title={t('cfg_drag_reorder')} aria-hidden="true">
                  <MIcon name="grip" size={16} />
                </span>
                <div className="m-row" style={{ flex: 1, gap: 10 }}>
                  <span className="lrow__title">{tp.name}</span>
                  <Badge color={tp.active ? 'green' : 'neutral'}>
                    {tp.active ? t('cfg_active') : t('cfg_inactive')}
                  </Badge>
                </div>
                <div className="lrow__actions">
                  <IconButton label={t('cfg_rename')} size="sm" onClick={() => openRename(tp)}>
                    <MIcon name="edit" size={16} />
                  </IconButton>
                  <Button variant="secondary" size="sm" onClick={() => toggleActive(tp)}>
                    {tp.active ? t('cfg_deactivate') : t('cfg_activate')}
                  </Button>
                  <IconButton label={t('delete')} size="sm" onClick={() => del(tp)}>
                    <MIcon name="trash" size={16} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="settings" title={t('cfg_no_types')} />
        )}
      </Card>

      <RemarkCriteriaSection criteria={remarkCriteria} />

      <GradeLevelsSection levels={gradeLevels} />

      <TuitionSettingsSection settings={tuitionSettings} />

      <PaymentInfoSection info={paymentInfo} />

      <RankingWeightsSection weights={rankingWeights} />

      <GardenSettingsSection settings={gardenSettings} />

      <ZaloSection zalo={zalo} />

      <Card style={{ padding: 18, marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_sb_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('cfg_sb_sub')}
          </p>
        </div>
        <div className="theme-preset">
          {(Object.keys(SB_PRESETS) as ScrollbarStyle[]).map((key) => {
            const p = SB_PRESETS[key];
            return (
              <button
                key={key}
                type="button"
                className={'preset preset--sb' + (scrollbar === key ? ' is-active' : '')}
                onClick={() => pickScrollbar(key)}
              >
                <div className="sbmock">
                  <div className="sbmock__lines">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="sbmock__bar" style={{ background: p.track, width: p.barW }}>
                    <span style={{ background: p.thumb }} />
                  </div>
                </div>
                <div className="preset__name">{t(p.tk)}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card style={{ padding: 18, marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_tb_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('cfg_tb_sub')}
          </p>
        </div>
        <div className="theme-preset">
          {TAB_BAR_STYLES.map((key) => (
            <button
              key={key}
              type="button"
              className={'preset preset--tb' + (mobileTabBar === key ? ' is-active' : '')}
              onClick={() => pickTabBar(key)}
            >
              <div className={'tbmock tbmock--' + key}>
                <div className="tbmock__bar">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={'tbmock__item' + (i === 1 ? ' is-active' : '')}>
                      <i className="tbmock__ico" />
                      <i className="tbmock__lbl" />
                    </span>
                  ))}
                </div>
                <div className="tbmock__nav" />
              </div>
              <div className="preset__name">{t(TB_LABEL[key])}</div>
            </button>
          ))}
        </div>
      </Card>

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('cfg_rename') : t('cfg_add_type')}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" disabled={!modal.name.trim()} onClick={() => save(modal)}>
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('cfg_type_name')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.name}
              onChange={(e) => setModal((m) => (m ? { ...m, name: e.target.value } : m))}
            />
          </div>
          {fetcher.data?.error && (
            <div className="m-muted" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
              {fetcher.data.error}
            </div>
          )}
        </Modal>
      )}
      {confirmNode}
    </div>
  );
}

export { SystemConfigScreen };
