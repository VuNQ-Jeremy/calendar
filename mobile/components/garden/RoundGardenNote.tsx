import { View } from 'react-native';
import type { GardenOutcome } from '@mochi/shared/logic/garden';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Body, Muted } from '~/ui';
import { PlantSvg, clampStage } from './PlantArt';

/**
 * The garden's verdict on one finished round — the port of `RoundGardenNote` in
 * `src/garden/garden-widget.tsx`, shown in the three games' end panels.
 *
 * `garden` is null for a staff play, for a round that was already recorded, for a round flushed
 * offline (the outcome arrived hours after the panel closed), and while the result is still in
 * flight. In all four cases this says nothing about the plant rather than guessing — a wrong
 * "your plant grew!" is worse than no line at all.
 */
export function RoundGardenNote({ garden }: { garden: GardenOutcome | null | undefined }) {
  const th = useTheme();
  const { t } = useLang();
  if (!garden) return null;

  const line = garden.grew
    ? t('garden_grew')
    : garden.qualified
      ? t('garden_capped')
      : t('garden_miss', { n: garden.thresholdPct });

  return (
    <View style={{ alignItems: 'center', gap: th.spacing[2] }}>
      {garden.grew ? (
        <PlantSvg stage={clampStage(garden.stage)} size={48} animateStageUp={true} />
      ) : null}
      <Body style={{ fontFamily: th.font.bodyBold, textAlign: 'center' }}>{line}</Body>
      {garden.harvestReady ? (
        <Muted style={{ textAlign: 'center' }}>{t('garden_harvest_ready')}</Muted>
      ) : null}
    </View>
  );
}
