import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import type { IconName } from './icons.jsx';
import { PageHeader, Empty, Modal, useConfirm, ColorPicker } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { ATTENDANCE_STATUSES, ATTENDANCE_META } from '../shared/logic/assess.js';
import { resolveMemo, vietQrUrl } from '../shared/logic/fees.js';
import type { AttendanceStatusId } from '../shared/logic/assess.js';
import type { AssessmentTypeRow } from '../server/services/assessment-types.js';
import type { GradeLevelRow } from '../server/services/grade-levels.js';
import type { ClassLevelRow } from '../server/services/class-levels.js';
import type { SubjectRow } from '../server/services/subjects.js';
import type { RemarkCriterionRow } from '../server/services/remark-criteria.js';
import type { TuitionPaymentInfo, TuitionSettings } from '../server/services/tuition.js';
import type { RankingWeights } from '../shared/logic/rankings.js';
import type { GardenSettings } from '../shared/logic/garden.js';
import { CHECKIN_MAX_TIERS, type CheckinSettings } from '../shared/logic/checkin.js';
import type { ActivityTypeRow } from '../server/services/checkin-activity-types.js';
import { TAB_BAR_STYLES } from '../shared/schemas.js';
import type { ScrollbarStyle, TabBarStyle } from '../shared/schemas.js';

const { Button, IconButton, Badge, Checkbox } = DS;

interface ConfigLoaderData {
  types: AssessmentTypeRow[];
  remarkCriteria: RemarkCriterionRow[];
  gradeLevels: GradeLevelRow[];
  classLevels: ClassLevelRow[];
  subjects: SubjectRow[];
  uiPrefs: { scrollbar: ScrollbarStyle; mobileTabBar: TabBarStyle };
  parentPortal: { enabled: boolean };
  tuitionSettings: TuitionSettings;
  rankingWeights: RankingWeights;
  gardenSettings: GardenSettings;
  reviewSettings: { intervals: number[] };
  paymentInfo: TuitionPaymentInfo;
  checkinActivityTypes: ActivityTypeRow[];
  checkinSettings: CheckinSettings;
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
 * Every section below renders its body only — no card, no heading. The page is a list of rows
 * (see `SystemConfigScreen`) and a row's modal supplies the title, the subtitle and the frame.
 */

/** The one shape all five managed lists share: an ordered list of named, de-activatable rows. */
interface ManagedRow {
  id: string;
  name: string;
  active: boolean;
}

interface ManagedListSpec {
  /** Action intents. All five follow the same create/update/delete/reorder quartet. */
  create: string;
  update: string;
  del: string;
  reorder: string;
  /** i18n keys. `deleteMsg` is optional — without it the confirm just echoes the name. */
  addLabel: string;
  nameLabel: string;
  empty: string;
  deleteTitle: string;
  deleteMsg?: string;
}

const LIST_SPECS = {
  types: {
    create: 'create-type',
    update: 'update-type',
    del: 'delete-type',
    reorder: 'reorder-types',
    addLabel: 'cfg_add_type',
    nameLabel: 'cfg_type_name',
    empty: 'cfg_no_types',
    deleteTitle: 'cfg_delete_q',
    deleteMsg: 'cfg_delete_msg',
  },
  criteria: {
    create: 'create-criterion',
    update: 'update-criterion',
    del: 'delete-criterion',
    reorder: 'reorder-criteria',
    addLabel: 'cfg_add_criterion',
    nameLabel: 'cfg_criterion_name_ph',
    empty: 'cfg_no_criteria',
    deleteTitle: 'cfg_delete_q',
    deleteMsg: 'cfg_delete_msg',
  },
  gradeLevels: {
    create: 'create-level',
    update: 'update-level',
    del: 'delete-level',
    reorder: 'reorder-levels',
    addLabel: 'gl_add',
    nameLabel: 'gl_name_ph',
    empty: 'gl_empty',
    deleteTitle: 'gl_delete_confirm',
  },
  classLevels: {
    create: 'create-class-level',
    update: 'update-class-level',
    del: 'delete-class-level',
    reorder: 'reorder-class-levels',
    addLabel: 'clv_add',
    nameLabel: 'clv_name_ph',
    empty: 'clv_empty',
    deleteTitle: 'clv_delete_confirm',
  },
  subjects: {
    create: 'create-subject',
    update: 'update-subject',
    del: 'delete-subject',
    reorder: 'reorder-subjects',
    addLabel: 'sub_add',
    nameLabel: 'sub_name_ph',
    empty: 'sub_empty',
    deleteTitle: 'sub_delete_confirm',
  },
} satisfies Record<string, ManagedListSpec>;

/**
 * Assessment types, remark criteria, khối, trình độ and môn học — five lists that differ only in
 * their intents and their labels. They were five near-identical components until the page became
 * row-and-modal: one component per list meant five copies of the same drag-reorder bookkeeping.
 *
 * Each instance still owns its own drag/modal state because only one list is mounted at a time
 * (inside its row's modal), and remounting on close is what discards a half-typed draft.
 */
function ManagedListSection({ rows, spec }: { rows: ManagedRow[]; spec: ManagedListSpec }) {
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<TypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

  const save = (draft: TypeDraft) => {
    const fd = new FormData();
    fd.set('intent', draft.id ? spec.update : spec.create);
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim());
    submit(fd);
    setModal(null);
  };

  const toggleActive = async (row: ManagedRow) => {
    if (row.active) {
      const ok = await confirm({
        title: t('cfg_deactivate'),
        message: row.name + '?',
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', spec.update);
    fd.set('id', row.id);
    fd.set('active', String(!row.active));
    submit(fd);
  };

  const del = async (row: ManagedRow) => {
    const ok = await confirm({
      title: t(spec.deleteTitle),
      message: spec.deleteMsg ? t(spec.deleteMsg, { name: row.name }) : row.name + '?',
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', spec.del);
    fd.set('id', row.id);
    submit(fd);
  };

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const reorderPending = React.useRef(false);

  // Show the in-progress drag order; fall back to server order.
  const ordered = React.useMemo(() => {
    if (!localOrder) return rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const r of rows) if (!localOrder.includes(r.id)) out.push(r);
    return out;
  }, [rows, localOrder]);

  React.useEffect(() => {
    if (fetcher.state === 'idle' && reorderPending.current) {
      reorderPending.current = false;
      setLocalOrder(null);
    }
  }, [fetcher.state]);

  const previewMove = (srcId: string, overId: string) => {
    setLocalOrder((prev) => {
      const cur = prev ?? rows.map((r) => r.id);
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
    if (localOrder.join('|') === rows.map((r) => r.id).join('|')) {
      setLocalOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', spec.reorder);
    fd.set('ids', JSON.stringify(localOrder));
    submit(fd);
    reorderPending.current = true;
  };

  return (
    <>
      <div className="m-row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button
          variant="primary"
          iconLeft={<MIcon name="plus" size={18} />}
          onClick={() => setModal({ name: '' })}
        >
          {t(spec.addLabel)}
        </Button>
      </div>
      {ordered.length ? (
        <div className="m-stack">
          {ordered.map((row) => (
            <div
              key={row.id}
              className={'lrow' + (dragId === row.id ? ' is-dragging' : '')}
              draggable
              onDragStart={(e) => {
                setDragId(row.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', row.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragId && dragId !== row.id) previewMove(dragId, row.id);
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={commitOrder}
            >
              <span className="lrow__grip" title={t('cfg_drag_reorder')} aria-hidden="true">
                <MIcon name="grip" size={16} />
              </span>
              <div className="m-row" style={{ flex: 1, gap: 10 }}>
                <span className="lrow__title">{row.name}</span>
                <Badge color={row.active ? 'green' : 'neutral'}>
                  {row.active ? t('cfg_active') : t('cfg_inactive')}
                </Badge>
              </div>
              <div className="lrow__actions">
                <IconButton
                  label={t('cfg_rename')}
                  size="sm"
                  onClick={() => setModal({ id: row.id, name: row.name })}
                >
                  <MIcon name="edit" size={16} />
                </IconButton>
                <Button variant="secondary" size="sm" onClick={() => toggleActive(row)}>
                  {row.active ? t('cfg_deactivate') : t('cfg_activate')}
                </Button>
                <IconButton label={t('delete')} size="sm" onClick={() => del(row)}>
                  <MIcon name="trash" size={16} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="settings" title={t(spec.empty)} />
      )}

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('cfg_rename') : t(spec.addLabel)}
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
            <label className="mochi-field__label">{t(spec.nameLabel)}</label>
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
    </>
  );
}

/**
 * Hoạt động check-in — the managed enum the kiosk's checklist cells pick from. Not a sixth
 * `ManagedListSection` because these rows carry an icon and a color alongside the name: the
 * cells must look identical to the kids week after week, so the visual identity is part of the
 * row, not of the per-session label. Same drag-reorder bookkeeping and modal shape otherwise.
 */
const CHECKIN_ICON_CHOICES: IconName[] = [
  'mic',
  'book',
  'cards',
  'message',
  'star',
  'sparkle',
  'zap',
  'headphones',
];

type CheckinTypeDraft = { id?: string; name: string; icon: IconName; color: string };

function CheckinActivityTypesSection({ rows }: { rows: ActivityTypeRow[] }) {
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<CheckinTypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

  const save = (draft: CheckinTypeDraft) => {
    const fd = new FormData();
    fd.set('intent', draft.id ? 'update-checkin-type' : 'create-checkin-type');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim());
    fd.set('icon', draft.icon);
    fd.set('color', draft.color);
    submit(fd);
    setModal(null);
  };

  const toggleActive = async (row: ActivityTypeRow) => {
    if (row.active) {
      const ok = await confirm({
        title: t('cfg_deactivate'),
        message: row.name + '?',
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', 'update-checkin-type');
    fd.set('id', row.id);
    fd.set('active', String(!row.active));
    submit(fd);
  };

  const del = async (row: ActivityTypeRow) => {
    const ok = await confirm({
      title: t('cfg_ck_delete_confirm'),
      message: row.name + '?',
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-checkin-type');
    fd.set('id', row.id);
    submit(fd);
  };

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const reorderPending = React.useRef(false);

  const ordered = React.useMemo(() => {
    if (!localOrder) return rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const r of rows) if (!localOrder.includes(r.id)) out.push(r);
    return out;
  }, [rows, localOrder]);

  React.useEffect(() => {
    if (fetcher.state === 'idle' && reorderPending.current) {
      reorderPending.current = false;
      setLocalOrder(null);
    }
  }, [fetcher.state]);

  const previewMove = (srcId: string, overId: string) => {
    setLocalOrder((prev) => {
      const cur = prev ?? rows.map((r) => r.id);
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
    if (localOrder.join('|') === rows.map((r) => r.id).join('|')) {
      setLocalOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'reorder-checkin-types');
    fd.set('ids', JSON.stringify(localOrder));
    submit(fd);
    reorderPending.current = true;
  };

  return (
    <>
      <div className="m-row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button
          variant="primary"
          iconLeft={<MIcon name="plus" size={18} />}
          onClick={() => setModal({ name: '', icon: 'mic', color: 'orange' })}
        >
          {t('cfg_ck_add')}
        </Button>
      </div>
      {ordered.length ? (
        <div className="m-stack">
          {ordered.map((row) => {
            const c = colorOf(row.color);
            return (
              <div
                key={row.id}
                className={'lrow' + (dragId === row.id ? ' is-dragging' : '')}
                draggable
                onDragStart={(e) => {
                  setDragId(row.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', row.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragId && dragId !== row.id) previewMove(dragId, row.id);
                }}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={commitOrder}
              >
                <span className="lrow__grip" title={t('cfg_drag_reorder')} aria-hidden="true">
                  <MIcon name="grip" size={16} />
                </span>
                <span
                  className="iconwrap"
                  style={{ background: c.soft, color: c.ink }}
                  aria-hidden="true"
                >
                  <MIcon name={(row.icon as IconName) ?? 'star'} size={18} />
                </span>
                <div className="m-row" style={{ flex: 1, gap: 10 }}>
                  <span className="lrow__title">{row.name}</span>
                  <Badge color={row.active ? 'green' : 'neutral'}>
                    {row.active ? t('cfg_active') : t('cfg_inactive')}
                  </Badge>
                </div>
                <div className="lrow__actions">
                  <IconButton
                    label={t('cfg_rename')}
                    size="sm"
                    onClick={() =>
                      setModal({
                        id: row.id,
                        name: row.name,
                        icon: (row.icon as IconName) ?? 'star',
                        color: row.color,
                      })
                    }
                  >
                    <MIcon name="edit" size={16} />
                  </IconButton>
                  <Button variant="secondary" size="sm" onClick={() => toggleActive(row)}>
                    {row.active ? t('cfg_deactivate') : t('cfg_activate')}
                  </Button>
                  <IconButton label={t('delete')} size="sm" onClick={() => del(row)}>
                    <MIcon name="trash" size={16} />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="check" title={t('cfg_ck_empty')} />
      )}

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('cfg_rename') : t('cfg_ck_add')}
          width={460}
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
            <label className="mochi-field__label">{t('cfg_ck_name_ph')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.name}
              onChange={(e) => setModal((m) => (m ? { ...m, name: e.target.value } : m))}
            />
          </div>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('cfg_ck_icon')}</label>
            <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {CHECKIN_ICON_CHOICES.map((ic) => {
                const active = modal.icon === ic;
                const c = colorOf(modal.color);
                return (
                  <button
                    key={ic}
                    type="button"
                    title={ic}
                    className="mchip"
                    style={{
                      background: active ? c.base : c.soft,
                      color: active ? '#fff' : c.ink,
                      cursor: 'pointer',
                      border: 'none',
                      padding: 8,
                    }}
                    onClick={() => setModal((m) => (m ? { ...m, icon: ic } : m))}
                  >
                    <MIcon name={ic} size={18} />
                  </button>
                );
              })}
            </div>
          </div>
          <ColorPicker
            label={t('cfg_ck_color')}
            value={modal.color}
            onChange={(v) => setModal((m) => (m ? { ...m, color: v } : m))}
          />
          {fetcher.data?.error && (
            <div className="m-muted" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
              {fetcher.data.error}
            </div>
          )}
        </Modal>
      )}
      {confirmNode}
    </>
  );
}

/**
 * Túi mù: how bags are earned, the monthly gift ladder, and which surfaces show the counts.
 *
 * Held in a draft until Save like the garden numbers — earn mode and tiers are read together by
 * the kiosk and the class board, and a half-edited ladder would visibly re-tier every student.
 * Past bags are a stored ledger, so flipping the earn mode never revokes anything already earned.
 */
function CheckinSettingsSection({ settings }: { settings: CheckinSettings }) {
  const fetcher = useFetcher();
  const { t } = useLang();

  type Draft = {
    earnMode: CheckinSettings['earnMode'];
    tiers: { bags: string; label: string }[];
    showClassBoard: boolean;
    showParentReport: boolean;
    showRankings: boolean;
    showStudentView: boolean;
  };
  const fromSettings = (): Draft => ({
    earnMode: settings.earnMode,
    tiers: settings.tiers.map((x) => ({ bags: String(x.bags), label: x.label })),
    showClassBoard: settings.showClassBoard,
    showParentReport: settings.showParentReport,
    showRankings: settings.showRankings,
    showStudentView: settings.showStudentView,
  });
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const current = draft ?? fromSettings();

  const tierNumbers = current.tiers.map((x) => Number(x.bags));
  const valid =
    current.tiers.length <= CHECKIN_MAX_TIERS &&
    current.tiers.every((x, i) => {
      const n = tierNumbers[i];
      return x.bags !== '' && Number.isInteger(n) && n >= 1 && n <= 60 && x.label.trim().length > 0;
    }) &&
    tierNumbers.every((n, i) => i === 0 || n > tierNumbers[i - 1]);

  const set = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });

  const save = () => {
    if (!valid) return;
    const fd = new FormData();
    fd.set('intent', 'checkin-settings');
    fd.set('earnMode', current.earnMode);
    fd.set(
      'tiers',
      JSON.stringify(
        current.tiers.map((x, i) => ({ bags: tierNumbers[i], label: x.label.trim() })),
      ),
    );
    fd.set('showClassBoard', String(current.showClassBoard));
    fd.set('showParentReport', String(current.showParentReport));
    fd.set('showRankings', String(current.showRankings));
    fd.set('showStudentView', String(current.showStudentView));
    fetcher.submit(fd, { action: '/config', method: 'post' });
    setDraft(null);
  };

  const EARN_MODES = [
    { id: 'perfect_day', tk: 'cfg_ck_earn_perfect' },
    { id: 'per_phase', tk: 'cfg_ck_earn_per_phase' },
  ] as const;

  const VIS_TOGGLES = [
    { key: 'showClassBoard', tk: 'cfg_ck_vis_board' },
    { key: 'showRankings', tk: 'cfg_ck_vis_rankings' },
    { key: 'showParentReport', tk: 'cfg_ck_vis_report' },
    { key: 'showStudentView', tk: 'cfg_ck_vis_student' },
  ] as const;

  return (
    <div className="m-stack">
      <div className="mochi-field" style={{ marginBottom: 0 }}>
        <label className="mochi-field__label">{t('cfg_ck_earn_mode')}</label>
        <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {EARN_MODES.map((m) => {
            const active = current.earnMode === m.id;
            const c = colorOf('orange');
            return (
              <button
                key={m.id}
                type="button"
                className="mchip"
                style={{
                  background: active ? c.base : c.soft,
                  color: active ? '#fff' : c.ink,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                }}
                onClick={() => set({ earnMode: m.id })}
              >
                {t(m.tk)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mochi-field" style={{ marginBottom: 0 }}>
        <label className="mochi-field__label">{t('cfg_ck_tiers')}</label>
        <div className="m-stack" style={{ gap: 8 }}>
          {current.tiers.map((tier, i) => (
            <div key={i} className="m-row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div className="mochi-field" style={{ marginBottom: 0, width: 110 }}>
                <label className="mochi-field__label">{t('cfg_ck_tier_bags')}</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  className="mochi-input"
                  value={tier.bags}
                  onChange={(e) =>
                    set({
                      tiers: current.tiers.map((x, j) =>
                        j === i ? { ...x, bags: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <div className="mochi-field" style={{ marginBottom: 0, flex: 1 }}>
                <label className="mochi-field__label">{t('cfg_ck_tier_label')}</label>
                <input
                  className="mochi-input"
                  value={tier.label}
                  onChange={(e) =>
                    set({
                      tiers: current.tiers.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <IconButton
                label={t('delete')}
                size="sm"
                onClick={() => set({ tiers: current.tiers.filter((_, j) => j !== i) })}
              >
                <MIcon name="trash" size={16} />
              </IconButton>
            </div>
          ))}
          <div className="m-row">
            <Button
              variant="secondary"
              size="sm"
              disabled={current.tiers.length >= CHECKIN_MAX_TIERS}
              iconLeft={<MIcon name="plus" size={16} />}
              onClick={() =>
                set({
                  tiers: [
                    ...current.tiers,
                    { bags: String((tierNumbers[tierNumbers.length - 1] || 0) + 4), label: '' },
                  ],
                })
              }
            >
              {t('cfg_ck_tier_add')}
            </Button>
          </div>
        </div>
      </div>

      <div className="mochi-field" style={{ marginBottom: 0 }}>
        <label className="mochi-field__label">{t('cfg_ck_visibility')}</label>
        <div className="m-row" style={{ gap: 18, flexWrap: 'wrap' }}>
          {VIS_TOGGLES.map((v) => (
            <Checkbox
              key={v.key}
              label={t(v.tk)}
              checked={current[v.key]}
              onChange={() => set({ [v.key]: !current[v.key] } as Partial<Draft>)}
            />
          ))}
        </div>
      </div>

      <div className="m-row" style={{ gap: 12 }}>
        <Button onClick={save} disabled={!valid || !draft}>
          {t('save')}
        </Button>
        {!valid && (
          <span
            className="m-muted"
            style={{ color: colorOf('rose').ink, fontSize: 'var(--text-sm)' }}
          >
            {t('cfg_ck_tier_hint')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Which attendance statuses the tuition module charges for. Its own component so the checkbox
 * state cannot collide with the rows around it; the amounts it changes live on /tuition.
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
    <>
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
    </>
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
    <>
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

      <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
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
    </>
  );
}

/**
 * How much ý thức counts against the test average on /rankings. Unlike the tuition section above
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
    <>
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
    </>
  );
}

/**
 * How fast the vocabulary garden grows, and how long a plant survives being ignored.
 *
 * Held in a draft until Save, like the weights section above: these four numbers are read together
 * by every plant in the school, and saving a half-typed field would visibly re-time everyone's
 * garden. The bounds match `GardenSettingsInput` — the form refuses what the schema would reject.
 */
const GARDEN_FIELDS = [
  { key: 'freeMinScorePct', tk: 'cfg_garden_min_score', min: 0, max: 100, step: 5 },
  { key: 'wiltAfterDays', tk: 'cfg_garden_wilt', min: 1, max: 30, step: 1 },
  { key: 'dropAfterDays', tk: 'cfg_garden_drop', min: 1, max: 60, step: 1 },
  { key: 'dailyGrowthCap', tk: 'cfg_garden_cap', min: 1, max: 5, step: 1 },
] as const;

function GardenSettingsSection({ settings }: { settings: GardenSettings }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null);

  const current =
    draft ?? Object.fromEntries(GARDEN_FIELDS.map((f) => [f.key, String(settings[f.key])]));
  const valid = GARDEN_FIELDS.every((f) => {
    const n = Number(current[f.key]);
    return current[f.key] !== '' && Number.isInteger(n) && n >= f.min && n <= f.max;
  });

  const save = () => {
    if (!valid) return;
    const fd = new FormData();
    fd.set('intent', 'garden-settings');
    for (const f of GARDEN_FIELDS) fd.set(f.key, String(Number(current[f.key])));
    fetcher.submit(fd, { action: '/config', method: 'post' });
    setDraft(null);
  };

  return (
    <div className="m-row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {GARDEN_FIELDS.map((f) => (
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
  );
}

/**
 * Ôn tập: how long the gaps are between reviews of the same word, and how many there are.
 *
 * The ladder is built row by row — the school decides how many reviews a word gets, not this form.
 * Adding a rung stretches the cycle; dropping one shortens it, and words already parked above the
 * new top are clamped down by `shared/logic/review.ts` the next time they are answered rather than
 * rewritten here.
 *
 * The whole ladder is held in a draft until Save for the same reason the garden's numbers are: it
 * is read together, and a half-typed field would reschedule the school's whole backlog. The form
 * enforces what `ReviewSettingsInput` enforces, including the non-decreasing rule — a ladder that
 * shortened as it climbed would bring mastered words back sooner than new ones.
 *
 * A 0 in the first field is legal and useful: it means "due again today", which is how you demo
 * the cycle without waiting three days.
 */
const REVIEW_MIN_STEPS = 1;
const REVIEW_MAX_STEPS = 12;

function ReviewSettingsSection({ intervals }: { intervals: number[] }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [draft, setDraft] = React.useState<string[] | null>(null);

  const current = draft ?? intervals.map(String);
  const numbers = current.map(Number);
  const valid =
    current.length >= REVIEW_MIN_STEPS &&
    current.length <= REVIEW_MAX_STEPS &&
    current.every((v, i) => {
      const n = numbers[i];
      return v !== '' && Number.isInteger(n) && n >= 0 && n <= 365;
    }) &&
    numbers.every((n, i) => i === 0 || n >= numbers[i - 1]);

  // A new rung starts at the value of the one below it: always a legal ladder, and the admin only
  // has to type the number they actually want.
  const addStep = () => setDraft([...current, current[current.length - 1] ?? '1']);
  const removeStep = (i: number) => setDraft(current.filter((_, j) => j !== i));

  const save = () => {
    if (!valid) return;
    const fd = new FormData();
    fd.set('intent', 'review-settings');
    fd.set('intervals', numbers.join(','));
    fetcher.submit(fd, { action: '/config', method: 'post' });
    setDraft(null);
  };

  return (
    <>
      <div className="m-row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {current.map((v, i) => (
          <div
            key={i}
            className="m-row"
            style={{ gap: 6, alignItems: 'flex-end', flexWrap: 'nowrap' }}
          >
            <div className="mochi-field" style={{ marginBottom: 0, width: 150 }}>
              <label className="mochi-field__label">
                {i === current.length - 1
                  ? t('cfg_review_step_last', { n: i + 1 })
                  : t('cfg_review_step', { n: i + 1 })}
              </label>
              <input
                type="number"
                min={0}
                max={365}
                step={1}
                className="mochi-input"
                value={v}
                onChange={(e) => setDraft(current.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </div>
            <IconButton
              label={t('cfg_review_remove_step', { n: i + 1 })}
              size="sm"
              disabled={current.length <= REVIEW_MIN_STEPS}
              onClick={() => removeStep(i)}
            >
              <MIcon name="trash" size={16} />
            </IconButton>
          </div>
        ))}
        <Button variant="secondary" onClick={addStep} disabled={current.length >= REVIEW_MAX_STEPS}>
          {t('cfg_review_add_step')}
        </Button>
        <Button onClick={save} disabled={!valid || !draft}>
          {t('save')}
        </Button>
      </div>
      <p
        className="m-muted"
        style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.6, maxWidth: 640 }}
      >
        {t('cfg_review_hint')}
      </p>
    </>
  );
}

/**
 * Zalo connections.
 *
 * The one screen where the school's real communication channel becomes visible. Pairing is a
 * two-step dance by necessity: generate a code here, and the person messages it to the bot from
 * their own Zalo. It cannot be done from this side alone — Zalo will not tell us who anybody is
 * until they talk to the bot first, and there is no in-app way for a family to volunteer it (most
 * parents have no account, and pairing is a Zalo action regardless of whether they do).
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

  if (!zalo.enabled) return <Badge color="orange">{t('zalo_disabled')}</Badge>;

  return (
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
              style={{ justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}
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
  );
}

/** The web scrollbar preset. Picking one previews instantly and saves in the same click. */
function ScrollbarSection({ value }: { value: ScrollbarStyle }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [local, setLocal] = React.useState<ScrollbarStyle | null>(null);
  const scrollbar = local ?? value;

  const pick = (key: ScrollbarStyle) => {
    setLocal(key);
    document.documentElement.dataset.scrollbar = key; // instant whole-app preview
    const fd = new FormData();
    fd.set('intent', 'ui-prefs');
    fd.set('scrollbar', key);
    fetcher.submit(fd, { action: '/config', method: 'post' });
  };

  return (
    <div className="theme-preset">
      {(Object.keys(SB_PRESETS) as ScrollbarStyle[]).map((key) => {
        const p = SB_PRESETS[key];
        return (
          <button
            key={key}
            type="button"
            className={'preset preset--sb' + (scrollbar === key ? ' is-active' : '')}
            onClick={() => pick(key)}
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
  );
}

/**
 * The phone's tab bar. Optimistic like the scrollbar above, but there is nothing to preview here —
 * the change shows up on a phone, which picks it up on its next fetch of /api/settings/ui-prefs.
 */
function TabBarSection({ value }: { value: TabBarStyle }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [local, setLocal] = React.useState<TabBarStyle | null>(null);
  const mobileTabBar = local ?? value;

  const pick = (key: TabBarStyle) => {
    setLocal(key);
    const fd = new FormData();
    fd.set('intent', 'ui-prefs');
    fd.set('mobileTabBar', key);
    fetcher.submit(fd, { action: '/config', method: 'post' });
  };

  return (
    <div className="theme-preset">
      {TAB_BAR_STYLES.map((key) => (
        <button
          key={key}
          type="button"
          className={'preset preset--tb' + (mobileTabBar === key ? ' is-active' : '')}
          onClick={() => pick(key)}
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
  );
}

/**
 * Whether parents see the children screens. Optimistic like the two sections above.
 *
 * Worth being precise in the copy, because the switch is narrower than it looks: parents have
 * been able to sign in since v0.0156 and turning this off does not take that away. It decides
 * whether signing in leads anywhere past their own profile.
 */
function ParentPortalSection({ enabled }: { enabled: boolean }) {
  const fetcher = useFetcher();
  const { t } = useLang();
  const [local, setLocal] = React.useState<boolean | null>(null);
  const on = local ?? enabled;

  const set = (next: boolean) => {
    setLocal(next);
    const fd = new FormData();
    fd.set('intent', 'parent-portal');
    fd.set('enabled', String(next));
    fetcher.submit(fd, { action: '/config', method: 'post' });
  };

  return (
    <div>
      <Checkbox
        checked={on}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(e.target.checked)}
        label={t('cfg_parent_portal_switch')}
      />
      <p className="m-muted" style={{ margin: '10px 0 0', fontSize: 'var(--text-sm)' }}>
        {t('cfg_parent_portal_hint')}
      </p>
    </div>
  );
}

/**
 * One openable setting. `render` is a thunk rather than an element so a section only mounts while
 * its modal is open: that is what keeps eleven fetchers and eleven drafts off the page at rest,
 * and what discards a half-typed draft when the modal is dismissed.
 */
interface ConfigEntry {
  id: string;
  icon: IconName;
  title: string;
  sub: string;
  /** Right-hand summary of what the setting is currently set to. */
  summary: React.ReactNode;
  width: number;
  render: () => React.ReactNode;
}

interface ConfigGroup {
  title: string;
  entries: ConfigEntry[];
}

/**
 * System configuration.
 *
 * Eleven settings that used to be eleven stacked cards — a page you scrolled past rather than
 * read. Each is now a row showing what it is currently set to, and opens into a modal carrying
 * the same controls as before.
 */
function SystemConfigScreen() {
  const {
    types,
    remarkCriteria,
    gradeLevels,
    classLevels,
    subjects,
    uiPrefs,
    tuitionSettings,
    rankingWeights,
    gardenSettings,
    reviewSettings,
    paymentInfo,
    parentPortal,
    checkinActivityTypes,
    checkinSettings,
    zalo,
  } = useLoaderData() as ConfigLoaderData;
  const { t } = useLang();
  const [openId, setOpenId] = React.useState<string | null>(null);

  /** "3 of 5 active" — the one thing worth knowing about a managed list without opening it. */
  const listSummary = (rows: ManagedRow[]) =>
    t('cfg_n_active', { n: rows.filter((r) => r.active).length, m: rows.length });

  const groups: ConfigGroup[] = [
    {
      title: t('cfg_grp_academics'),
      entries: [
        {
          id: 'types',
          icon: 'clipboard',
          title: t('cfg_types_title'),
          sub: t('cfg_types_sub'),
          summary: listSummary(types),
          width: 640,
          render: () => <ManagedListSection rows={types} spec={LIST_SPECS.types} />,
        },
        {
          id: 'criteria',
          icon: 'star',
          title: t('cfg_criteria_title'),
          sub: t('cfg_criteria_sub'),
          summary: listSummary(remarkCriteria),
          width: 640,
          render: () => <ManagedListSection rows={remarkCriteria} spec={LIST_SPECS.criteria} />,
        },
        {
          id: 'gradeLevels',
          icon: 'grad',
          title: t('gl_title'),
          sub: t('gl_subtitle'),
          summary: listSummary(gradeLevels),
          width: 640,
          render: () => <ManagedListSection rows={gradeLevels} spec={LIST_SPECS.gradeLevels} />,
        },
        {
          id: 'classLevels',
          icon: 'chart',
          title: t('clv_title'),
          sub: t('clv_subtitle'),
          summary: listSummary(classLevels),
          width: 640,
          render: () => <ManagedListSection rows={classLevels} spec={LIST_SPECS.classLevels} />,
        },
        {
          id: 'subjects',
          icon: 'book',
          title: t('sub_title'),
          sub: t('sub_subtitle'),
          summary: listSummary(subjects),
          width: 640,
          render: () => <ManagedListSection rows={subjects} spec={LIST_SPECS.subjects} />,
        },
        {
          id: 'checkinTypes',
          icon: 'check',
          title: t('cfg_ck_types_title'),
          sub: t('cfg_ck_types_sub'),
          summary: listSummary(checkinActivityTypes),
          width: 640,
          render: () => <CheckinActivityTypesSection rows={checkinActivityTypes} />,
        },
      ],
    },
    {
      title: t('cfg_grp_billing'),
      entries: [
        {
          id: 'tuition',
          icon: 'banknote',
          title: t('cfg_tuition_title'),
          sub: t('cfg_tuition_sub'),
          summary: t('cfg_n_billable', { n: tuitionSettings.billableStatuses.length }),
          width: 620,
          render: () => <TuitionSettingsSection settings={tuitionSettings} />,
        },
        {
          id: 'payment',
          icon: 'key',
          title: t('cfg_payment_title'),
          sub: t('cfg_payment_sub'),
          summary:
            paymentInfo.accountNumber || paymentInfo.bankName
              ? [paymentInfo.bankName, paymentInfo.accountNumber].filter(Boolean).join(' · ')
              : t('cfg_not_set'),
          width: 860,
          render: () => <PaymentInfoSection info={paymentInfo} />,
        },
      ],
    },
    {
      title: t('cfg_grp_scoring'),
      entries: [
        {
          id: 'ranking',
          icon: 'flag',
          title: t('cfg_rank_title'),
          sub: t('cfg_rank_sub'),
          summary: `${rankingWeights.attitude} / ${rankingWeights.score}`,
          width: 620,
          render: () => <RankingWeightsSection weights={rankingWeights} />,
        },
        {
          id: 'garden',
          icon: 'sprout',
          title: t('cfg_garden'),
          sub: t('cfg_garden_sub'),
          summary: t('cfg_garden_summary', {
            pct: gardenSettings.freeMinScorePct,
            wilt: gardenSettings.wiltAfterDays,
            drop: gardenSettings.dropAfterDays,
          }),
          width: 720,
          render: () => <GardenSettingsSection settings={gardenSettings} />,
        },
        {
          id: 'review',
          icon: 'repeat',
          title: t('cfg_review'),
          sub: t('cfg_review_sub'),
          summary: reviewSettings.intervals.join(' · '),
          width: 760,
          render: () => <ReviewSettingsSection intervals={reviewSettings.intervals} />,
        },
        {
          id: 'checkin',
          icon: 'gift',
          title: t('cfg_ck_settings_title'),
          sub: t('cfg_ck_settings_sub'),
          summary: t(
            checkinSettings.earnMode === 'perfect_day'
              ? 'cfg_ck_earn_perfect'
              : 'cfg_ck_earn_per_phase',
          ),
          width: 680,
          render: () => <CheckinSettingsSection settings={checkinSettings} />,
        },
      ],
    },
    {
      title: t('cfg_grp_system'),
      entries: [
        {
          id: 'zalo',
          icon: 'message',
          title: t('zalo_title'),
          sub: t('zalo_sub'),
          // `zalo_disabled` is a full sentence — too long for a row. The modal still carries it.
          summary: zalo.enabled ? t('cfg_n_linked', { n: zalo.links.length }) : t('cfg_not_set'),
          width: 640,
          render: () => <ZaloSection zalo={zalo} />,
        },
        {
          id: 'scrollbar',
          icon: 'palette',
          title: t('cfg_sb_title'),
          sub: t('cfg_sb_sub'),
          summary: t(SB_PRESETS[uiPrefs.scrollbar].tk),
          width: 720,
          render: () => <ScrollbarSection value={uiPrefs.scrollbar} />,
        },
        {
          id: 'tabbar',
          icon: 'grid',
          title: t('cfg_tb_title'),
          sub: t('cfg_tb_sub'),
          summary: t(TB_LABEL[uiPrefs.mobileTabBar]),
          width: 720,
          render: () => <TabBarSection value={uiPrefs.mobileTabBar} />,
        },
        {
          id: 'parentPortal',
          icon: 'users',
          title: t('cfg_parent_portal_title'),
          sub: t('cfg_parent_portal_sub'),
          summary: parentPortal.enabled ? t('cfg_parent_portal_on') : t('cfg_parent_portal_off'),
          width: 620,
          render: () => <ParentPortalSection enabled={parentPortal.enabled} />,
        },
      ],
    },
  ];

  const open = groups.flatMap((g) => g.entries).find((e) => e.id === openId) ?? null;

  return (
    <div className="content">
      <PageHeader title={t('cfg_title')} subtitle={t('cfg_sub')} />

      {groups.map((g) => (
        <section key={g.title} style={{ marginBottom: 22 }}>
          <h2 className="cfg-group__title">{g.title}</h2>
          <div className="m-stack">
            {g.entries.map((e) => (
              <div
                key={e.id}
                className="lrow cfg-row"
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(e.id)}
                onKeyDown={(ev) => {
                  if (ev.key !== 'Enter' && ev.key !== ' ') return;
                  ev.preventDefault();
                  setOpenId(e.id);
                }}
              >
                <span className="cfg-row__icon" aria-hidden="true">
                  <MIcon name={e.icon} size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lrow__title">{e.title}</div>
                  <div className="lrow__meta">{e.sub}</div>
                </div>
                <span className="cfg-row__value">{e.summary}</span>
                <MIcon name="chevronRight" size={18} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <Modal
          open
          onClose={() => setOpenId(null)}
          title={open.title}
          subtitle={open.sub}
          width={open.width}
        >
          {open.render()}
        </Modal>
      )}
    </div>
  );
}

export { SystemConfigScreen };
