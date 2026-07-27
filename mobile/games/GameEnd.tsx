import { View } from 'react-native';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Body, Button, Muted, Title } from '~/ui';

/**
 * The shared round-complete panel. All three games end the same way on the web — a heading, a
 * score line, optional detail, then Play again / Exit — so it lives in one place here.
 */
export function GameEnd({
  headline,
  sub,
  children,
  onReplay,
  onExit,
}: {
  headline: string;
  sub?: string;
  children?: React.ReactNode;
  onReplay: () => void;
  onExit: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: th.spacing[4],
        padding: th.spacing[6],
      }}
    >
      <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold }}>{t('fc_round_done')}</Title>
      <Body style={{ ...th.text.xl, color: th.color.textStrong }}>{headline}</Body>
      {sub ? <Muted>{sub}</Muted> : null}
      {children}
      <View style={{ flexDirection: 'row', gap: th.spacing[3], marginTop: th.spacing[2] }}>
        <Button onPress={onReplay}>{t('fc_play_again')}</Button>
        <Button variant="secondary" onPress={onExit}>
          {t('fc_exit')}
        </Button>
      </View>
    </View>
  );
}
