import React from 'react';
import { DS } from '../ds/index.js';
import { ColorPicker, PageHeader } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { PlantSvg, stageKey } from './plant-art.jsx';
import { SPECIES } from '../../shared/garden-art';

/**
 * Every plant in the garden, at every stage — the admin's reference sheet.
 *
 * A student only ever sees the one plant they are growing plus grey silhouettes of the rest, and
 * staff see whatever their class happens to have planted. Nobody has a view of the whole set, so
 * questions a teacher actually asks — what does mai vàng look like, how much work is a kumquat,
 * is stage 3 distinguishable from stage 4 — have no answer anywhere in the app. This is that
 * answer, and it doubles as the place a new drawing gets checked after it ships.
 *
 * The page reads nothing from the database. Species are static data in shared/garden-art.ts, so
 * this is a pure render of the registry; the route still gates on `requireAdmin`, because who may
 * look at a page is not a question the data model gets to answer.
 */

const { Button, Card, Tag } = DS;

/** What state to draw every plant in. Dead is species-agnostic, hence its own note below. */
type Mood = 'healthy' | 'wilted' | 'locked';

const MOODS: { id: Mood; tk: 'garden_show_healthy' | 'garden_show_wilted' | 'garden_show_locked' }[] =
  [
    { id: 'healthy', tk: 'garden_show_healthy' },
    { id: 'wilted', tk: 'garden_show_wilted' },
    { id: 'locked', tk: 'garden_show_locked' },
  ];

const STAGES = [1, 2, 3, 4, 5] as const;

export function SpeciesShowcaseScreen() {
  const { t } = useLang();
  const [mood, setMood] = React.useState<Mood>('healthy');
  const [potColor, setPotColor] = React.useState('cocoa');

  return (
    <>
      <PageHeader title={t('garden_show_title')} subtitle={t('garden_show_sub')} />

      <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {MOODS.map((m) => (
            <Button
              key={m.id}
              variant={mood === m.id ? 'primary' : 'secondary'}
              onClick={() => setMood(m.id)}
            >
              {t(m.tk)}
            </Button>
          ))}
        </div>
        {/* The pot is the student's own choice, so seeing a species in someone else's pot is part
            of knowing what it looks like. The real picker, not a lookalike: its swatches carry
            their colour as an inline style and mark themselves `is-active`. */}
        <ColorPicker label={t('garden_pot_color')} value={potColor} onChange={setPotColor} />
      </Card>

      <div className="m-stack" style={{ gap: 14 }}>
        {SPECIES.map((s) => (
          <Card key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
                {t(`garden_species_${s.id}` as Parameters<typeof t>[0])}
              </span>
              <Tag color={s.unlockAt === 0 ? 'green' : 'orange'} dot={false}>
                {s.unlockAt === 0
                  ? t('garden_show_starter')
                  : t('garden_show_costs', { n: s.unlockAt })}
              </Tag>
              <code style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{s.id}</code>
            </div>

            <div className="m-row" style={{ gap: 14, flexWrap: 'wrap' }}>
              {STAGES.map((stage) => (
                <div key={stage} className="m-stack" style={{ alignItems: 'center', gap: 2 }}>
                  <PlantSvg
                    stage={stage}
                    species={s.id}
                    wilted={mood === 'wilted'}
                    locked={mood === 'locked'}
                    potColor={potColor}
                    size={84}
                  />
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                    {t(stageKey(stage) as Parameters<typeof t>[0])}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Death is a state, not a species trait: every plant dies the same way, so it is shown once
          here rather than eleven times above. */}
      <Card style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <PlantSvg stage={0} dead={true} potColor={potColor} size={84} />
        <div className="m-stack" style={{ gap: 2 }}>
          <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
            {t(stageKey(0, true) as Parameters<typeof t>[0])}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {t('garden_show_dead_note')}
          </span>
        </div>
      </Card>
    </>
  );
}
