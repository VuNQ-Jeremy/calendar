import { View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Muted } from './Type';

/**
 * The persistent "you are offline" strip, plus the pending-sync count.
 *
 * Both are reassurance, not warnings: the app works offline by design, and the point of showing
 * this is so a student never wonders whether their score was lost.
 */
export function OfflineBanner({ pending = 0 }: { pending?: number }) {
  const th = useTheme();
  const { t } = useLang();
  const net = useNetInfo();
  const offline = net.isConnected === false;

  if (!offline && pending === 0) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: th.spacing[2],
        paddingHorizontal: th.spacing[4],
        paddingVertical: th.spacing[2],
        backgroundColor: offline ? th.ramp.sand[300] : th.color.brandSoft,
      }}
    >
      {offline ? (
        <CloudOff size={16} color={th.color.textBody} />
      ) : (
        <RefreshCw size={16} color={th.color.brandSoftInk} />
      )}
      <Muted style={{ flex: 1, color: offline ? th.color.textBody : th.color.brandSoftInk }}>
        {offline ? t('m_offline_banner') : t('m_sync_pending', { n: pending })}
      </Muted>
    </View>
  );
}
