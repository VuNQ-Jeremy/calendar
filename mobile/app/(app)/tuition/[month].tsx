import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Copy, Share2 } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { getToken } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { qk } from '~/lib/query';
import { useTheme, TOUCH } from '~/theme';
import { Badge, Body, Button, Card, Heading, Muted, Screen, Tag } from '~/ui';
import { formatVnd } from '@mochi/shared/logic/fees';
import { formatDmy } from '@mochi/shared/logic/dates';
import { monthLabel } from '@mochi/shared/logic/month';

/**
 * One closed month: what was billed, what is still owed, and how to pay it.
 *
 * The fee lines here are the SAME frozen rows the admin screen and the printed slip read — nothing
 * is recomputed on the phone, so a student and the office can never be looking at two different
 * numbers.
 *
 * The slip is rendered as a PNG by the Worker (server/slip/), not drawn here: the web's rasterizer
 * needs a DOM. All three web themes are available, and the picked one is shared straight into Zalo.
 */

/** The web's three themes, in the same order as src/tuition/slip-themes.tsx. */
const THEMES = [
  { id: 'cute-pastel', tk: 'slip_theme_cute' },
  { id: 'minimal', tk: 'slip_theme_minimal' },
  { id: 'classic', tk: 'slip_theme_classic' },
] as const;

const STATUS_TONE = {
  paid: { color: 'green', tk: 'tuition_status_paid' },
  partial: { color: 'orange', tk: 'tuition_status_partial' },
  unpaid: { color: 'rose', tk: 'tuition_status_unpaid' },
} as const;

export default function MyTuitionMonthScreen() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { month } = useLocalSearchParams<{ month: string }>();

  const { data, isLoading } = useQuery({
    queryKey: qk.myTuitionMonth(month),
    queryFn: () => api.myTuition.month(month),
    // Payments land after the close — see qk.myTuition.
    staleTime: 0,
  });

  const [theme, setTheme] = React.useState<string>('cute-pastel');
  const [sharing, setSharing] = React.useState(false);
  const [shareFailed, setShareFailed] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
  };

  /** Download the PNG with the bearer header, then hand it to the share sheet. */
  const shareSlip = async () => {
    setSharing(true);
    setShareFailed(false);
    try {
      const token = await getToken();
      if (!token) throw new Error('no token');
      const dir = new Directory(Paths.cache, 'slips');
      if (!dir.exists) dir.create({ intermediates: true });
      // Themed name: sharing two themes of the same month must not reuse the first file.
      const target = new File(dir, `phieu-thu-${month}-${theme}.png`);
      if (target.exists) target.delete();
      const downloaded = await File.downloadFileAsync(api.myTuition.slipUrl(month, theme), target, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!(await Sharing.isAvailableAsync())) {
        setShareFailed(true);
        return;
      }
      await Sharing.shareAsync(downloaded.uri, {
        mimeType: 'image/png',
        dialogTitle: t('tuition_print_slip'),
      });
    } catch {
      setShareFailed(true);
    } finally {
      setSharing(false);
    }
  };

  if (isLoading && !data) {
    return (
      <Screen edges={{ top: true }}>
        <ScreenHeader title={t('tuition_me_title')} />
        <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
      </Screen>
    );
  }
  if (!data) return null;

  const { fee, paymentInfo } = data;
  const tone = STATUS_TONE[fee.status];

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={monthLabel(data.month, lang)} subtitle={t('tuition_me_title')} />

      <ScrollView contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}>
        <Card style={{ gap: th.spacing[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
            <Badge color={tone.color}>{t(tone.tk)}</Badge>
          </View>

          {fee.lines.map((line) => (
            <View key={line.classId} style={{ gap: th.spacing[1] }}>
              <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
                <Heading style={{ flex: 1 }}>{line.className}</Heading>
                <Body style={{ fontFamily: th.font.bodyBold }}>{formatVnd(line.amountVnd)}</Body>
              </View>
              <Muted>
                {t('tuition_me_sessions', {
                  n: line.sessions,
                  price: formatVnd(line.unitPriceVnd),
                })}
              </Muted>
              {/* Months closed before migration 0021 stored no dates — the count above is all
                  there is for those, so the chip row simply does not render. */}
              {line.dates.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[1] }}>
                  {line.dates.map((d, i) => (
                    <Tag key={`${d}-${i}`}>{formatDmy(d)}</Tag>
                  ))}
                </View>
              ) : null}
            </View>
          ))}

          <View style={{ gap: th.spacing[1] }}>
            <TotalRow label={t('tuition_me_billed')} value={formatVnd(fee.billedVnd)} />
            {fee.adjustmentVnd !== 0 ? (
              <TotalRow
                label={
                  t('tuition_adjustment') +
                  (fee.adjustmentNote ? ` (${fee.adjustmentNote})` : '')
                }
                value={formatVnd(fee.adjustmentVnd)}
              />
            ) : null}
            <TotalRow label={t('tuition_total_due')} value={formatVnd(fee.dueVnd)} strong />
            {fee.paidVnd > 0 ? (
              <TotalRow
                label={t('tuition_paid_amount') + (fee.paidAt ? ` · ${formatDmy(fee.paidAt)}` : '')}
                value={formatVnd(fee.paidVnd)}
              />
            ) : null}
            {fee.outstandingVnd > 0 ? (
              <TotalRow
                label={t('tuition_outstanding')}
                value={formatVnd(fee.outstandingVnd)}
                strong
                danger
              />
            ) : null}
          </View>
        </Card>

        <Card style={{ gap: th.spacing[3] }}>
          <Heading>{t('tuition_pay_title')}</Heading>
          {paymentInfo ? (
            <>
              {paymentInfo.bankName ? (
                <CopyRow
                  label={t('tuition_pay_bank')}
                  value={paymentInfo.bankName}
                  onCopy={copy}
                  copied={copied}
                />
              ) : null}
              {paymentInfo.accountNumber ? (
                <CopyRow
                  label={t('tuition_pay_account')}
                  value={paymentInfo.accountNumber}
                  onCopy={copy}
                  copied={copied}
                />
              ) : null}
              {paymentInfo.accountHolder ? (
                <CopyRow
                  label={t('tuition_pay_holder')}
                  value={paymentInfo.accountHolder}
                  onCopy={copy}
                  copied={copied}
                />
              ) : null}
              {paymentInfo.memo ? (
                <CopyRow
                  label={t('tuition_pay_memo')}
                  value={paymentInfo.memo}
                  onCopy={copy}
                  copied={copied}
                />
              ) : null}
              {/* The server omits the QR once nothing is outstanding — a code that would transfer
                  0 ₫ is not something to put in front of someone who has already paid. */}
              {paymentInfo.vietQrUrl ? (
                <View style={{ alignItems: 'center', gap: th.spacing[2] }}>
                  <Image
                    source={{ uri: paymentInfo.vietQrUrl }}
                    style={{ width: 240, height: 320 }}
                    resizeMode="contain"
                    accessibilityLabel={t('tuition_pay_qr_hint')}
                  />
                  <Muted>{t('tuition_pay_qr_hint')}</Muted>
                </View>
              ) : null}
            </>
          ) : (
            <Muted>{t('tuition_pay_none')}</Muted>
          )}
        </Card>

        <Card style={{ gap: th.spacing[3] }}>
          <Heading>{t('tuition_print_slip')}</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
            {THEMES.map((slipTheme) => (
              <Pressable
                key={slipTheme.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: theme === slipTheme.id }}
                onPress={() => setTheme(slipTheme.id)}
                hitSlop={8}
              >
                <Badge color={theme === slipTheme.id ? 'green' : 'neutral'}>
                  {t(slipTheme.tk)}
                </Badge>
              </Pressable>
            ))}
          </View>
          <Button block loading={sharing} onPress={() => void shareSlip()}>
            {t('tuition_slip_share')}
          </Button>
          {shareFailed ? (
            <Body style={{ color: th.status.danger }}>{t('tuition_slip_failed')}</Body>
          ) : null}
        </Card>

        <View style={{ height: TOUCH }} />
      </ScrollView>
    </Screen>
  );
}

function TotalRow({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
      <Body style={{ flex: 1, color: th.color.textMuted }}>{label}</Body>
      <Body
        style={{
          fontFamily: strong ? th.font.bodyBold : th.font.body,
          color: danger ? th.status.danger : undefined,
        }}
      >
        {value}
      </Body>
    </View>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
  copied: string | null;
}) {
  const th = useTheme();
  const { t } = useLang();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('copy')} ${label}`}
      onPress={() => onCopy(label, value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2], minHeight: TOUCH }}
    >
      <View style={{ flex: 1 }}>
        <Muted>{label}</Muted>
        <Body selectable>{value}</Body>
      </View>
      {copied === label ? (
        <Muted>{t('copied')}</Muted>
      ) : (
        <Copy size={18} color={th.color.textMuted} />
      )}
    </Pressable>
  );
}
