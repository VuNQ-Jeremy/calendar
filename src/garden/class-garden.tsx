import React from 'react';
import { Link, useFetcher, useLoaderData, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, PageHeader, Empty } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { formatDmy, formatDmyTime } from '../../shared/logic/dates.js';
import { ClassTreeSvg, PlantSvg, stageKey } from './plant-art.jsx';
import { MAX_CLASS_TREE_LEVEL, classTreeNext } from '../../shared/logic/garden';
import type { FruitTitleId, GardenSnapshotData, PlantStage } from '../../shared/logic/garden';
import type {
  ClassGarden,
  GardenEventRow,
  GardenMember,
  VocabAssignmentRow,
} from '../../server/services/garden.js';

/**
 * The shared class garden — one plant per member, plus the class's cooperative tree.
 *
 * Both roles land here, and the difference is deliberately small: students see exactly the same
 * plants the teacher does. What staff get on top is the watering can, the per-plant history, and
 * the assignment tracking table.
 *
 * The member grid is ordered by NAME, never by stage or streak (the loader does the ordering).
 * That is the whole point of this screen: it is a garden the class tends together, not a
 * leaderboard — /rankings already exists for ranking, and shaming the slowest plant in front of
 * the class is not what a plant is for. The one accountability view is the assignment table,
 * which sorts the students who are behind to the top, and which only staff can see.
 */

const { Avatar, Badge, Button, Card, IconButton, Input, ProgressBar, Tag } = DS;

/** Overdue / wilting ink. A literal hex from the palette, not a CSS variable, so it reads the
 * same in both themes as the rest of the palette does. */
const DANGER_INK = colorOf('rose').ink;

type AssignmentBlock = {
  assignment: VocabAssignmentRow;
  rows: { studentId: string; name: string; color: string; done: number }[];
};

type ClassOption = { id: string; name: string };

type GardenData = {
  mode: 'garden';
  kind: 'staff' | 'student';
  vnToday: string;
  prevMonth: string;
  garden: ClassGarden;
  classes: ClassOption[];
  snapshots: { month: string; createdAt: string }[];
  /** Staff only; `[]` for students. */
  assignments: AssignmentBlock[];
  /** Staff only; `{}` for students. Keyed by studentId — see the note on the history modal. */
  history: Record<string, GardenEventRow[]>;
  viewerStudentId: string | null;
  /** Draws the test tools. The action re-checks the role; this only decides the button. */
  isAdmin: boolean;
};

type PickerData = { mode: 'picker'; kind: 'staff'; vnToday: string; classes: ClassOption[] };
type NoClassData = { mode: 'empty'; kind: 'student'; vnToday: string };

type LoaderData = GardenData | PickerData | NoClassData;

export function ClassGardenScreen() {
  const data = useLoaderData() as LoaderData;
  if (data.mode === 'picker') return <ClassPicker classes={data.classes} />;
  if (data.mode === 'empty') return <NoClasses />;
  return <GardenView data={data} />;
}

// ---- The three top-level shapes ----

function ClassPicker({ classes }: { classes: ClassOption[] }) {
  const { t } = useLang();
  const navigate = useNavigate();
  return (
    <div className="content">
      <PageHeader title={t('garden_class_title')} subtitle={t('garden_class_sub')} />
      {classes.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {classes.map((c) => (
            <Card
              key={c.id}
              interactive={true}
              onClick={() => navigate(`/garden/${c.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
                <MIcon name="sprout" size={20} />
                <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{c.name}</span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon="sprout" title={t('garden_pick_class')} />
        </Card>
      )}
    </div>
  );
}

function NoClasses() {
  const { t } = useLang();
  return (
    <div className="content">
      <PageHeader title={t('garden_class_title')} subtitle={t('garden_class_sub')} />
      <Card>
        <Empty icon="sprout" title={t('garden_empty_short')} sub={t('garden_class_sub')} />
      </Card>
    </div>
  );
}

function GardenView({ data }: { data: GardenData }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const { garden, kind, viewerStudentId } = data;
  const isStaff = kind === 'staff';
  const [watering, setWatering] = React.useState<GardenMember | null>(null);
  const [showing, setShowing] = React.useState<GardenMember | null>(null);
  const [tweaking, setTweaking] = React.useState<GardenMember | null>(null);
  const [snapped, setSnapped] = React.useState(false);

  // The snapshot intent answers with the month it wrote, which is what turns the button into a
  // confirmation. Nothing else on this screen reads fetcher.data.
  const res = fetcher.data as { ok?: boolean; month?: string } | undefined;
  React.useEffect(() => {
    if (res?.month) setSnapped(true);
  }, [res]);

  const snapshot = () => {
    const fd = new FormData();
    fd.set('intent', 'snapshot-month');
    fd.set('month', data.prevMonth);
    fetcher.submit(fd, { method: 'post' });
  };

  const next = classTreeNext(garden.tree.points);
  const atMax = next === null || garden.tree.level >= MAX_CLASS_TREE_LEVEL;

  return (
    <div className="content">
      <PageHeader
        title={`${t('garden_class_title')} · ${garden.className}`}
        subtitle={t('garden_class_sub')}
        actions={
          isStaff && (
            <span className="m-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                iconLeft={<MIcon name="image" size={18} />}
                onClick={() => window.open(`/garden/${garden.classId}/share`, '_blank')}
              >
                {t('garden_share')}
              </Button>
              <Button
                variant="secondary"
                iconLeft={<MIcon name="clock" size={18} />}
                onClick={snapshot}
              >
                {snapped ? t('garden_snapshot_done') : t('garden_snapshot')}
              </Button>
            </span>
          )
        }
      />

      {data.classes.length > 1 && (
        <div style={{ maxWidth: 280 }}>
          <MSelect
            label={t('garden_pick_class')}
            value={garden.classId}
            onChange={(v: string) => navigate(`/garden/${v}`)}
            options={data.classes.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
      )}

      <Card>
        <div className="m-row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <ClassTreeSvg level={garden.tree.level} size={96} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{t('garden_tree')}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              {t('garden_tree_level', { n: garden.tree.level })}
            </div>
            <div style={{ marginTop: 8 }}>
              <ProgressBar
                color="green"
                value={atMax ? 100 : Math.round((garden.tree.points * 100) / (next ?? 1))}
              />
            </div>
            <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              {atMax
                ? t('garden_tree_max')
                : t('garden_tree_progress', { points: garden.tree.points, next: next ?? 0 })}
            </div>
          </div>
        </div>
      </Card>

      {garden.members.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
            gap: 16,
          }}
        >
          {garden.members.map((m) => (
            <MemberCard
              key={m.studentId}
              m={memberCard(m)}
              mine={m.studentId === viewerStudentId}
              note={m.studentId === viewerStudentId ? <OwnPlantNote m={m} /> : null}
              actions={
                isStaff && (
                  <>
                    <IconButton label={t('garden_water')} size="sm" onClick={() => setWatering(m)}>
                      <MIcon name="droplet" size={16} />
                    </IconButton>
                    <IconButton label={t('garden_history')} size="sm" onClick={() => setShowing(m)}>
                      <MIcon name="clock" size={16} />
                    </IconButton>
                    {data.isAdmin && (
                      <IconButton label={t('garden_dev')} size="sm" onClick={() => setTweaking(m)}>
                        <MIcon name="settings" size={16} />
                      </IconButton>
                    )}
                  </>
                )
              }
            />
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon="users" title={t('garden_empty_short')} />
        </Card>
      )}

      {isStaff && <AssignmentsPanel blocks={data.assignments} vnToday={data.vnToday} />}

      <AlbumLinks classId={garden.classId} snapshots={data.snapshots} />

      {watering && (
        <WaterModal member={watering} fetcher={fetcher} onClose={() => setWatering(null)} />
      )}
      {tweaking && (
        <DevModal member={tweaking} fetcher={fetcher} onClose={() => setTweaking(null)} />
      )}
      {showing && (
        <HistoryModal
          member={showing}
          events={data.history[showing.studentId] ?? []}
          onClose={() => setShowing(null)}
        />
      )}
    </div>
  );
}

// ---- The member card, shared with the album ----

/**
 * The subset of a plant a card draws. Both the live `GardenMember` and the frozen
 * `GardenSnapshotMember` are mapped into this, so /garden and the album cannot drift apart —
 * an album from six months ago has to keep rendering the way it did the day it was written.
 */
export interface CardMember {
  studentId: string;
  name: string;
  color: string;
  plantName: string | null;
  potColor: string;
  stage: PlantStage;
  wilted: boolean;
  dead: boolean;
  streak: number;
  fruitMonth: number;
  fruitTotal: number;
  titleId: FruitTitleId | null;
}

export function memberCard(m: GardenMember): CardMember {
  return {
    studentId: m.studentId,
    name: m.name,
    color: m.color,
    plantName: m.plantName,
    potColor: m.potColor,
    stage: m.stage,
    wilted: m.wilted,
    dead: m.dead,
    streak: m.streak,
    fruitMonth: m.fruitMonth,
    fruitTotal: m.fruitsTotal,
    titleId: m.titleId,
  };
}

export function MemberCard({
  m,
  mine,
  actions,
  note,
}: {
  m: CardMember;
  mine?: boolean;
  actions?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const { t } = useLang();
  const healthy = !m.wilted && !m.dead && m.stage > 0;
  return (
    <Card
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        textAlign: 'center',
        border: mine ? '1.5px solid var(--brand)' : undefined,
        background: mine ? 'var(--brand-soft)' : undefined,
      }}
    >
      {/* Name on a row of its own. Sharing it with the teacher's two icons left roughly forty
          pixels for a name on a 190px card, which truncated every student to a single letter — and
          a class garden you cannot read names in is not a class garden. */}
      <div className="m-row" style={{ gap: 8, alignItems: 'center', width: '100%' }}>
        <Avatar name={m.name} color={m.color} size="sm" />
        <span
          style={{
            fontWeight: 700,
            color: 'var(--text-strong)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'left',
          }}
        >
          {m.name}
        </span>
      </div>

      {m.titleId && <Tag color="violet">{t(`garden_title_${m.titleId}`)}</Tag>}

      <PlantSvg
        stage={m.stage}
        wilted={m.wilted}
        dead={m.dead}
        potColor={m.potColor}
        size={96}
        className={healthy ? 'garden-sway' : undefined}
      />

      {m.plantName ? (
        <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{m.plantName}</div>
      ) : (
        <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('garden_unnamed')}</div>
      )}

      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {m.stage === 0 && !m.dead ? t('garden_empty_short') : t(stageKey(m.stage, m.dead))}
      </div>

      <div
        className="m-row"
        style={{
          gap: 10,
          justifyContent: 'center',
          flexWrap: 'wrap',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {m.streak > 0 && (
          <span
            className="m-row"
            style={{ gap: 4, alignItems: 'center' }}
            // The glyph carries the meaning at a glance; the words are here for the tooltip and
            // for anything reading the card out loud.
            title={t('garden_streak', { n: m.streak })}
          >
            <MIcon name="flame" size={14} />×{m.streak}
          </span>
        )}
        <span className="m-row" style={{ gap: 4, alignItems: 'center' }}>
          <MIcon name="fruit" size={14} />
          {t('garden_fruit_month', { n: m.fruitMonth })}
        </span>
      </div>
      {m.fruitTotal > 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          {t('garden_fruit_total', { n: m.fruitTotal })}
        </div>
      )}
      {note}
      {actions && (
        <div
          className="lrow__actions"
          style={{ marginLeft: 0, marginTop: 2, justifyContent: 'center' }}
        >
          {actions}
        </div>
      )}
    </Card>
  );
}

/**
 * The nudge only ever shown on the viewer's own card. The wilt strings are written in the second
 * person on purpose, so they must not appear under somebody else's plant.
 */
function OwnPlantNote({ m }: { m: GardenMember }) {
  const { t } = useLang();
  if (m.dead) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {t('garden_dead')}
      </div>
    );
  }
  if (!m.wilted) return null;
  return (
    <div style={{ color: DANGER_INK, fontSize: 'var(--text-sm)' }}>
      <div>{t('garden_wilting')}</div>
      {m.nextDropDate && <div>{t('garden_drop_warning', { date: formatDmy(m.nextDropDate) })}</div>}
    </div>
  );
}

// ---- Staff-only: watering and history ----

function WaterModal({
  member,
  fetcher,
  onClose,
}: {
  member: GardenMember;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [note, setNote] = React.useState('');
  const save = () => {
    const fd = new FormData();
    fd.set('intent', 'water');
    fd.set('studentId', member.studentId);
    fd.set('note', note.trim());
    fetcher.submit(fd, { method: 'post' });
    onClose();
  };
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('garden_water_title', { name: member.name })}
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" iconLeft={<MIcon name="droplet" size={16} />} onClick={save}>
            {t('save')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', color: 'var(--text-body)' }}>{t('garden_water_msg')}</p>
      <Input
        label={t('garden_water_note')}
        autoFocus={true}
        value={note}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
      />
    </Modal>
  );
}

// ---- Admin-only: the test tools ----

/**
 * Dial a plant to any stage, and pretend it has been ignored for N days.
 *
 * Admin-only, and it exists because the interesting states are the slow ones: without it, seeing a
 * wilted plant means not studying for three days and seeing a dead one means waiting a month.
 * `idleDays` backdates the plant's last care rather than faking the look, so what appears is the
 * real decay — which is also why this doubles as the only end-to-end coverage of the wilt and death
 * visuals (see e2e/crud-garden3.spec.ts).
 */
function DevModal({
  member,
  fetcher,
  onClose,
}: {
  member: GardenMember;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [stage, setStage] = React.useState(String(Math.max(1, member.stage)));
  const [idleDays, setIdleDays] = React.useState('0');

  const send = (intent: 'dev-set' | 'dev-reset') => {
    const fd = new FormData();
    fd.set('intent', intent);
    fd.set('studentId', member.studentId);
    if (intent === 'dev-set') {
      fd.set('stage', stage);
      fd.set('idleDays', idleDays);
    }
    fetcher.submit(fd, { method: 'post' });
    onClose();
  };

  // Stage 0 is offered as "dead" rather than as a number, because that is what it means.
  const STAGES: PlantStage[] = [0, 1, 2, 3, 4, 5];

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('garden_dev_title', { name: member.name })}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="secondary" onClick={() => send('dev-reset')}>
            {t('garden_dev_reset')}
          </Button>
          <Button variant="primary" onClick={() => send('dev-set')}>
            {t('save')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', color: 'var(--text-body)' }}>{t('garden_dev_msg')}</p>
      <MSelect
        label={t('garden_dev_stage')}
        value={stage}
        onChange={setStage}
        options={STAGES.map((s) => ({
          value: String(s),
          label: `${s} · ${t(stageKey(s, s === 0))}`,
        }))}
      />
      {/* Raw markup rather than DS.Input: that component has no `type`, and this needs a number
          field. Same `.mochi-field` shape, so the e2e helper still finds it by its label. */}
      <div className="mochi-field">
        <label className="mochi-field__label">{t('garden_dev_idle')}</label>
        <input
          className="mochi-input"
          type="number"
          min={0}
          max={365}
          value={idleDays}
          onChange={(e) => setIdleDays(e.target.value)}
        />
      </div>
      <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {t('garden_dev_hint')}
      </p>
    </Modal>
  );
}

/**
 * `grow` covers two different things and the stage numbers are what tell them apart: a round that
 * added a stage, and a round played after the daily cap (or at fruit) which still counted as care.
 */
function eventLabel(
  t: (key: string, vars?: Record<string, string | number>) => string,
  ev: GardenEventRow,
): string {
  if (ev.type === 'water') {
    return ev.staffName ? t('garden_ev_water', { name: ev.staffName }) : t('garden_ev_water_anon');
  }
  if (ev.type === 'grow' && ev.stageAfter === ev.stageBefore) return t('garden_ev_grow_capped');
  return t(`garden_ev_${ev.type}`);
}

function HistoryModal({
  member,
  events,
  onClose,
}: {
  member: GardenMember;
  events: GardenEventRow[];
  onClose: () => void;
}) {
  const { t } = useLang();
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('garden_history_title', { name: member.name })}
      width={520}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('close')}
        </Button>
      }
    >
      {events.length ? (
        <div className="m-stack" style={{ gap: 8 }}>
          {events.map((ev) => (
            <div key={ev.id} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text-strong)' }}>{eventLabel(t, ev)}</div>
                {ev.note && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    {ev.note}
                  </div>
                )}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                {formatDmy(ev.vnDay)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="clock" title={t('garden_no_history')} />
      )}
    </Modal>
  );
}

// ---- Staff-only: assignment tracking ----

function AssignmentsPanel({ blocks, vnToday }: { blocks: AssignmentBlock[]; vnToday: string }) {
  const { t } = useLang();
  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{t('garden_assignments')}</div>
      {blocks.length ? (
        blocks.map((b) => <AssignmentCard key={b.assignment.id} block={b} vnToday={vnToday} />)
      ) : (
        <Card>
          <Empty icon="clipboard" title={t('garden_no_assignments')} />
        </Card>
      )}
    </div>
  );
}

function AssignmentCard({ block, vnToday }: { block: AssignmentBlock; vnToday: string }) {
  const { t } = useLang();
  const { assignment } = block;
  const required = assignment.requiredCount;
  const overdue = assignment.deadline < vnToday;

  // Behind first — this table IS the accountability view, unlike the plant grid above it.
  const rows = [...block.rows].sort(
    (a, b) =>
      (a.done >= required ? 1 : 0) - (b.done >= required ? 1 : 0) ||
      a.done - b.done ||
      a.name.localeCompare(b.name),
  );

  return (
    <Card>
      <div
        className="m-row"
        style={{
          gap: 10,
          alignItems: 'baseline',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{assignment.topicName}</span>
        <span className="m-row" style={{ gap: 12, flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
          <span style={{ color: overdue ? DANGER_INK : 'var(--text-muted)' }}>
            {t('garden_deadline')}: {formatDmyTime(assignment.deadline, assignment.deadlineTime)}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {t('garden_required')}: {required}
          </span>
        </span>
      </div>
      <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {t('garden_track')}
      </div>
      <div className="m-stack" style={{ gap: 6, marginTop: 6 }}>
        {rows.map((r) => {
          const done = r.done >= required;
          return (
            <div key={r.studentId} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
              <Avatar name={r.name} color={r.color} size="sm" />
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text-strong)' }}>{r.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                {r.done}/{required}
              </span>
              <Badge color={done ? 'success' : overdue ? 'danger' : 'neutral'}>
                {done
                  ? t('garden_status_done')
                  : overdue
                    ? t('garden_status_late')
                    : t('garden_status_pending')}
              </Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---- The album index ----

function AlbumLinks({
  classId,
  snapshots,
}: {
  classId: string;
  snapshots: { month: string; createdAt: string }[];
}) {
  const { t } = useLang();
  return (
    <Card>
      <div className="m-row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="m-row" style={{ gap: 6, alignItems: 'center', fontWeight: 700 }}>
          <MIcon name="image" size={18} />
          {t('garden_album')}
        </span>
        {snapshots.length ? (
          snapshots.map((s) => (
            <Link
              key={s.month}
              to={`/garden/${classId}/album/${s.month}`}
              style={{ color: 'var(--brand)', fontWeight: 600 }}
            >
              {s.month}
            </Link>
          ))
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{t('garden_album_none')}</span>
        )}
      </div>
    </Card>
  );
}

// ---- The album page ----

export type AlbumLoaderData =
  | {
      found: true;
      classId: string;
      className: string;
      month: string;
      createdAt: string;
      data: GardenSnapshotData;
    }
  | { found: false; classId: string; month: string };

/**
 * One frozen month. Deliberately the same `MemberCard` as the live garden: an album that drifted
 * away from the screen it was a photograph of would be a worse keepsake every release.
 */
export function GardenAlbumScreen() {
  const payload = useLoaderData() as AlbumLoaderData;
  const { t } = useLang();

  const back = (
    <Link
      to={`/garden/${payload.classId}`}
      className="m-row"
      style={{ gap: 6, alignItems: 'center', color: 'var(--brand)', fontWeight: 600 }}
    >
      <MIcon name="chevronLeft" size={16} />
      {t('garden_class_title')}
    </Link>
  );

  if (!payload.found) {
    return (
      <div className="content">
        <PageHeader title={t('garden_album_title', { month: payload.month })} actions={back} />
        <Card>
          <Empty icon="image" title={t('garden_album_none')} />
        </Card>
      </div>
    );
  }

  const { data } = payload;
  return (
    <div className="content">
      <PageHeader
        title={`${t('garden_album_title', { month: payload.month })} · ${payload.className}`}
        subtitle={t('garden_album_frozen', { date: formatDmy(payload.createdAt.slice(0, 10)) })}
        actions={back}
      />

      <Card>
        <div className="m-row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <ClassTreeSvg level={data.classTree.level} size={96} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{t('garden_tree')}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
              {t('garden_tree_level', { n: data.classTree.level })}
            </div>
          </div>
        </div>
      </Card>

      {data.members.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
            gap: 16,
          }}
        >
          {data.members.map((m) => (
            <MemberCard
              key={m.studentId}
              m={{
                studentId: m.studentId,
                name: m.name,
                color: m.color,
                plantName: m.plantName,
                potColor: m.potColor,
                stage: m.stage,
                wilted: m.wilted,
                dead: m.dead,
                streak: m.streak,
                fruitMonth: m.fruitMonth,
                fruitTotal: m.fruitTotal,
                titleId: m.titleId,
              }}
            />
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon="users" title={t('garden_empty_short')} />
        </Card>
      )}
    </div>
  );
}
