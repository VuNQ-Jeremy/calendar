import { View } from 'react-native';
import { Apple, Flame } from 'lucide-react-native';
import { formatDmy } from '@mochi/shared/logic/dates';
import type { FruitTitleId, PlantStage } from '@mochi/shared/logic/garden';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Avatar, Body, Card, Muted } from '~/ui';
import { PlantSvg, clampStage, stageKey } from './PlantArt';
import type { GardenMemberRow } from '~/lib/types';

/**
 * One classmate's plant — the port of `MemberCard` in `src/garden/class-garden.tsx`.
 *
 * The subset of a plant a card draws. Both the live `GardenMemberRow` and a frozen
 * `GardenSnapshotMember` map into `CardMember`, so the live garden and the album cannot drift
 * apart: an album from six months ago has to keep rendering the way it did the day it was written.
 * Note the shapes differ by one field name — live has `fruitsTotal`, frozen has `fruitTotal` — which
 * is exactly why the mapping is explicit.
 */
export interface CardMember {
  studentId: string;
  name: string;
  color: string;
  plantName: string | null;
  potColor: string;
  /** Species id — see shared/garden-art.ts. */
  species: string;
  stage: PlantStage;
  wilted: boolean;
  dead: boolean;
  streak: number;
  fruitMonth: number;
  fruitTotal: number;
  titleId: FruitTitleId | null;
}

export function memberCard(m: GardenMemberRow): CardMember {
  return {
    studentId: m.studentId,
    name: m.name,
    color: m.color,
    plantName: m.plantName,
    potColor: m.potColor,
    species: m.species,
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
  note,
}: {
  m: CardMember;
  /** The viewer's own plant: brand border and soft fill, so they find themselves at a glance. */
  mine?: boolean;
  note?: React.ReactNode;
}) {
  const th = useTheme();
  const { t } = useLang();
  const healthy = !m.wilted && !m.dead && m.stage > 0;

  return (
    <Card
      style={{
        flex: 1,
        alignItems: 'center',
        gap: th.spacing[1],
        padding: th.spacing[4],
        borderColor: mine ? th.color.brand : undefined,
        backgroundColor: mine ? th.color.brandSoft : undefined,
      }}
    >
      {/* Name on a row of its own — the web learned this the hard way when sharing the row with
          icons truncated every student to a single letter. */}
      <View
        style={{
          flexDirection: 'row',
          gap: th.spacing[2],
          alignItems: 'center',
          alignSelf: 'stretch',
        }}
      >
        <Avatar name={m.name} color={m.color} size="sm" />
        <Body style={{ flex: 1, fontFamily: th.font.bodyBold }} numberOfLines={1}>
          {m.name}
        </Body>
      </View>

      {m.titleId ? <Muted>{t(`garden_title_${m.titleId}`)}</Muted> : null}

      <PlantSvg
        stage={clampStage(m.stage)}
        wilted={m.wilted}
        dead={m.dead}
        potColor={m.potColor}
        species={m.species}
        size={96}
        sway={healthy}
      />

      {m.plantName ? (
        <Body style={{ fontFamily: th.font.bodyBold, textAlign: 'center' }} numberOfLines={1}>
          {m.plantName}
        </Body>
      ) : (
        <Muted style={{ fontStyle: 'italic' }}>{t('garden_unnamed')}</Muted>
      )}

      <Muted style={{ textAlign: 'center' }}>
        {m.stage === 0 && !m.dead ? t('garden_empty_short') : t(stageKey(m.stage, m.dead))}
      </Muted>

      <View
        style={{
          flexDirection: 'row',
          gap: th.spacing[3],
          justifyContent: 'center',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {m.streak > 0 ? (
          <View
            style={{ flexDirection: 'row', gap: th.spacing[1], alignItems: 'center' }}
            accessibilityLabel={t('garden_streak', { n: m.streak })}
          >
            <Flame size={14} color={th.category.orange.ink} />
            <Muted>×{m.streak}</Muted>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: th.spacing[1], alignItems: 'center' }}>
          <Apple size={14} color={th.category.orange.ink} />
          <Muted>{t('garden_fruit_month', { n: m.fruitMonth })}</Muted>
        </View>
      </View>
      {m.fruitTotal > 0 ? <Muted>{t('garden_fruit_total', { n: m.fruitTotal })}</Muted> : null}
      {note}
    </Card>
  );
}

/**
 * The nudge only ever shown on the viewer's own card. The wilt strings are written in the second
 * person on purpose, so they must not appear under somebody else's plant.
 */
export function OwnPlantNote({ m }: { m: GardenMemberRow }) {
  const th = useTheme();
  const { t } = useLang();
  if (m.dead) return <Muted style={{ textAlign: 'center' }}>{t('garden_dead')}</Muted>;
  if (!m.wilted) return null;
  return (
    <View style={{ gap: th.spacing[1] }}>
      <Muted style={{ color: th.category.rose.ink, textAlign: 'center' }}>
        {t('garden_wilting')}
      </Muted>
      {m.nextDropDate ? (
        <Muted style={{ color: th.category.rose.ink, textAlign: 'center' }}>
          {t('garden_drop_warning', { date: formatDmy(m.nextDropDate) })}
        </Muted>
      ) : null}
    </View>
  );
}
