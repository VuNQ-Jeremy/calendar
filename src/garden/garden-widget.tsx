import React from 'react';
import { Link, useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, ColorPicker } from '../ui.jsx';
import { PALETTE, colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { formatDmy, formatDmyTime } from '../../shared/logic/dates.js';
import { PlantSvg, stageKey } from './plant-art.jsx';
import { MAX_STAGE, daysBetweenVn } from '../../shared/logic/garden';
import { parseModes } from '../../shared/logic/flashcards';
import type { GardenSettings, PlantStage, PlantView } from '../../shared/logic/garden';
import type { GardenOutcome, VocabAssignmentRow } from '../../server/services/garden.js';

/**
 * The student's own plant, at the top of /vocabulary — and the one-line garden verdict the game
 * screens show when a round ends (`RoundGardenNote`, at the bottom of this file).
 *
 * Everything here is a read of what the loader already settled: this component never decides
 * whether a plant wilted or how much growth is left, it only draws it. The two writes it owns are
 * the harvest tap and the rename/repaint dialog, both posted to the `/vocabulary` route action as
 * plain FormData (no <form> — see CLAUDE.md's e2e contract).
 *
 * Dates arrive as ICT `YYYY-MM-DD` strings and are compared against the loader's `today`, never
 * against the device clock: a phone set to Sydney must not see a deadline a day early.
 */

const { Badge, Button, Card, IconButton, ProgressBar, Tag } = DS;

/** How near a deadline (or a stage drop) has to be before it is drawn as urgent. */
const URGENT_DAYS = 2;

/** Overdue / about-to-wilt ink. A literal palette hex, so it reads the same in both themes. */
const DANGER = colorOf('rose');

/** One open assignment for this student, with their own progress — `studentAssignments()`. */
export type StudentAssignmentChip = {
  id: string;
  topicId: string;
  topicName: string;
  topicSlug: string | null;
  className: string;
  deadline: string;
  /** ICT 'HH:MM' the deadline expires at, or null for end of day. */
  deadlineTime: string | null;
  requiredCount: number;
  minScorePct: number;
  /** CSV of the game modes that count, null = any — parse with `parseModes`. */
  modes: string | null;
  done: number;
};

/** The student half of the /vocabulary loader's garden payload. Null when the garden is down. */
export type StudentGardenData = {
  /** ICT today, from the server. */
  today: string;
  /** False when nothing has ever been planted — a rename would have no row to land on. */
  hasPlant: boolean;
  plant: PlantView;
  plantName: string | null;
  potColor: string;
  /** Species id — see shared/garden-art.ts. 'classic' until the student chooses otherwise. */
  species: string;
  /** Fruit harvested during the current ICT month. */
  fruitMonth: number;
  /** First class, for the "class garden" link. Null for a student in no class. */
  classId: string | null;
  assignments: StudentAssignmentChip[];
  settings: GardenSettings;
};

/** One assignment plus every member's progress — what the teacher's tracking modal lists. */
export type AssignmentBlock = {
  assignment: VocabAssignmentRow;
  rows: { studentId: string; name: string; color: string; done: number }[];
};

/** The staff half of the same payload. */
export type StaffGardenData = {
  today: string;
  assignments: AssignmentBlock[];
  classes: { id: string; name: string }[];
};

/** The round outcome the record-result action returns. Re-exported so the games need one import. */
export type RoundGarden = GardenOutcome;

/** What the three games take on top of `GameProps` to show the verdict on the round just played. */
export type GardenRoundProps = { garden?: RoundGarden | null };

function clampStage(stage: number): PlantStage {
  return Math.max(0, Math.min(MAX_STAGE, stage)) as PlantStage;
}

export function GardenWidget({ data }: { data: StudentGardenData | null }) {
  const { t } = useLang();
  // Two fetchers, not one: the harvest reply drives the celebration, and a rename landing in the
  // same slot would replay it.
  const harvestFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const nameFetcher = useFetcher();
  const [editing, setEditing] = React.useState<{ plantName: string; potColor: string } | null>(
    null,
  );
  const [flash, setFlash] = React.useState<'done' | 'failed' | null>(null);
  const [celebrating, setCelebrating] = React.useState(false);
  const [popping, setPopping] = React.useState(false);

  // A stage-up is only visible by comparing loader payloads, so the pop is triggered from the
  // change rather than from the action's reply — that also covers growth from a round played on
  // another device, which arrives through the live hub.
  const stage = data?.plant.stage ?? 0;
  const prevStage = React.useRef(stage);
  React.useEffect(() => {
    const grew = stage > prevStage.current;
    prevStage.current = stage;
    if (!grew) return;
    setPopping(true);
    const id = setTimeout(() => setPopping(false), 900);
    return () => clearTimeout(id);
  }, [stage]);

  const harvestReply = harvestFetcher.data;
  React.useEffect(() => {
    if (harvestFetcher.state !== 'idle' || !harvestReply) return;
    const ok = harvestReply.ok === true;
    setFlash(ok ? 'done' : 'failed');
    setCelebrating(ok);
    const id = setTimeout(() => {
      setFlash(null);
      setCelebrating(false);
    }, 2400);
    return () => clearTimeout(id);
  }, [harvestFetcher.state, harvestReply]);

  // The garden degrades to null for the first minutes after a deploy (see the loader). /vocabulary
  // still has to work, so the widget simply isn't there.
  if (!data) return null;

  const { plant } = data;
  const harvesting = harvestFetcher.state !== 'idle';

  const harvest = () => {
    const fd = new FormData();
    fd.set('intent', 'harvest');
    harvestFetcher.submit(fd, { method: 'post' });
  };

  const saveName = () => {
    if (!editing) return;
    const fd = new FormData();
    fd.set('intent', 'plant-update');
    fd.set('plantName', editing.plantName.trim());
    fd.set('potColor', editing.potColor);
    nameFetcher.submit(fd, { method: 'post' });
    setEditing(null);
  };

  const titleKey = plant.titleId ? `garden_title_${plant.titleId}` : null;
  const dropsSoon =
    !plant.dead &&
    plant.nextDropDate !== null &&
    daysBetweenVn(data.today, plant.nextDropDate) <= URGENT_DAYS;
  // Priority: dead beats wilting beats an empty pot. The drop warning is deliberately NOT in that
  // chain — a stage only ever drops off a plant that is already wilted, so as a rival it could
  // never win, and as an extra line it says the thing that actually matters (which day).
  const state = plant.dead
    ? t('garden_dead')
    : plant.wilted
      ? t('garden_wilting')
      : plant.stage === 0
        ? t('garden_empty')
        : null;

  return (
    <Card style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ position: 'relative', width: 128, height: 128, flex: '0 0 auto' }}>
        <PlantSvg
          stage={clampStage(plant.stage)}
          wilted={plant.wilted}
          dead={plant.dead}
          potColor={data.potColor}
          species={data.species}
          size={128}
          animateStageUp={popping}
          className={celebrating ? 'garden-harvest' : ''}
        />
        {celebrating && (
          <div className="garden-confetti" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ background: PALETTE[i % PALETTE.length].hex }} />
            ))}
          </div>
        )}
      </div>

      <div className="m-stack" style={{ flex: '1 1 260px', minWidth: 220, gap: 10 }}>
        <div className="m-row" style={{ gap: 8, alignItems: 'center' }}>
          <MIcon name="sprout" size={18} />
          {data.plantName ? (
            <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{data.plantName}</span>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {t('garden_unnamed')}
            </span>
          )}
          {data.hasPlant && (
            <IconButton
              label={t('garden_rename')}
              size="sm"
              onClick={() =>
                setEditing({ plantName: data.plantName ?? '', potColor: data.potColor })
              }
            >
              <MIcon name="edit" size={16} />
            </IconButton>
          )}
        </div>

        <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
            {t(stageKey(plant.stage, plant.dead))}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {plant.growthLeftToday > 0
              ? t('garden_growth_left', { n: plant.growthLeftToday })
              : t('garden_growth_none')}
          </span>
        </div>

        <div className="m-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {plant.streak > 0 && (
            <span
              className="m-row"
              style={{ gap: 4, alignItems: 'center', color: 'var(--text-body)' }}
            >
              <MIcon name="flame" size={16} />
              {t('garden_streak', { n: plant.streak })}
            </span>
          )}
          <Tag color="orange" dot={false}>
            {t('garden_fruit_month', { n: data.fruitMonth })}
          </Tag>
          <Tag color="green" dot={false}>
            {t('garden_fruit_total', { n: plant.fruitsTotal })}
          </Tag>
          {titleKey && (
            <Tag color="violet" dot={false}>
              {t(titleKey)}
            </Tag>
          )}
        </div>

        {state && <div style={{ color: 'var(--text-body)' }}>{state}</div>}
        {dropsSoon && (
          <div style={{ color: DANGER.ink, fontSize: 'var(--text-sm)' }}>
            {t('garden_drop_warning', { date: formatDmy(plant.nextDropDate!) })}
          </div>
        )}

        {plant.harvestReady && (
          <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant="primary"
              disabled={harvesting}
              iconLeft={<MIcon name="fruit" size={18} />}
              onClick={harvest}
            >
              {t('garden_harvest')}
            </Button>
          </div>
        )}
        {flash && (
          <div
            style={{
              color: flash === 'done' ? 'var(--text-strong)' : DANGER.ink,
              fontWeight: 600,
            }}
          >
            {t(flash === 'done' ? 'garden_harvest_done' : 'garden_harvest_failed')}
          </div>
        )}

        {data.assignments.length > 0 && (
          <div className="m-stack" style={{ gap: 6 }}>
            {data.assignments.map((a) => (
              <AssignmentChip key={a.id} chip={a} today={data.today} />
            ))}
          </div>
        )}

        {data.classId && (
          <Link
            to={`/garden/${data.classId}`}
            className="m-row"
            style={{
              gap: 4,
              alignItems: 'center',
              color: 'var(--brand)',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              textDecoration: 'none',
            }}
          >
            {t('garden_class_title')}
            <MIcon name="chevronRight" size={16} />
          </Link>
        )}
      </div>

      {editing && (
        <Modal
          open={true}
          onClose={() => setEditing(null)}
          title={t('garden_rename')}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={saveName}>
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('garden_plant_name')}</label>
            <input
              className="mochi-input"
              autoFocus={true}
              maxLength={30}
              value={editing.plantName}
              onChange={(e) => setEditing((d) => (d ? { ...d, plantName: e.target.value } : d))}
            />
          </div>
          <ColorPicker
            label={t('garden_pot_color')}
            value={editing.potColor}
            onChange={(potColor: string) => setEditing((d) => (d ? { ...d, potColor } : d))}
          />
        </Modal>
      )}
    </Card>
  );
}

function AssignmentChip({ chip, today }: { chip: StudentAssignmentChip; today: string }) {
  const { t } = useLang();
  const done = chip.done >= chip.requiredCount;
  const urgent = !done && daysBetweenVn(today, chip.deadline) <= URGENT_DAYS;
  const modes = parseModes(chip.modes);
  return (
    <div
      className="lrow"
      style={{
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        background: urgent ? DANGER.soft : undefined,
        borderRadius: 12,
      }}
    >
      <Link
        to={`/vocabulary/${chip.topicSlug ?? chip.topicId}`}
        style={{ color: 'var(--text-strong)', fontWeight: 600, textDecoration: 'none' }}
      >
        {chip.topicName}
      </Link>
      {modes &&
        modes.map((m) => (
          <Tag key={m} color="violet" dot={false}>
            {t(`fc_mode_${m}`)}
          </Tag>
        ))}
      <span
        style={{
          color: urgent ? DANGER.ink : 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <MIcon name="clock" size={14} />
        {t('garden_deadline')}: {formatDmyTime(chip.deadline, chip.deadlineTime)}
      </span>
      <span style={{ flex: 1, minWidth: 60, maxWidth: 120 }}>
        <ProgressBar
          value={Math.round((Math.min(chip.done, chip.requiredCount) * 100) / chip.requiredCount)}
          color={done ? 'green' : 'brand'}
        />
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {chip.done}/{chip.requiredCount}
      </span>
      {done && <Badge color="success">{t('garden_status_done')}</Badge>}
    </div>
  );
}

/**
 * The garden verdict on one finished round, for the three games' end panels.
 *
 * `garden` is null for a staff preview and for a round that was already recorded (an offline
 * flush), and while the result is still in flight — in all three cases the panel says nothing
 * about the plant rather than guessing.
 */
export function RoundGardenNote({ garden }: { garden: RoundGarden | null | undefined }) {
  const { t } = useLang();
  if (!garden) return null;
  const line = garden.grew
    ? t('garden_grew')
    : garden.qualified
      ? t('garden_capped')
      : t('garden_miss', { n: garden.thresholdPct });
  return (
    <div
      className="m-stack"
      style={{ gap: 6, alignItems: 'center', textAlign: 'center' }}
      data-garden-note={garden.grew ? 'grew' : garden.qualified ? 'capped' : 'miss'}
    >
      {garden.grew && <PlantSvg stage={clampStage(garden.stage)} size={48} animateStageUp={true} />}
      <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{line}</div>
      {garden.harvestReady && (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          {t('garden_harvest_ready')}
        </div>
      )}
    </div>
  );
}
