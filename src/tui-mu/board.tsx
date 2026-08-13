import React from 'react';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { PageHeader, Empty, MSelect, useConfirm } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { monthLabel, shiftMonth } from '../../shared/logic/month.js';
import { qualifiedTier } from '../../shared/logic/checkin.js';
import type { CheckinTier, TuiMuMonthTally } from '../../shared/logic/checkin.js';
import type { ClassLite } from '../../server/services/classes.js';
import type { GiftRedemptionRow } from '../../server/services/checkin.js';

const { Card, Button, Avatar, Badge } = DS;

interface RosterStudent {
  id: string;
  name: string;
  color: string;
}

interface TuiMuLoaderData {
  disabled: boolean;
  classId: string | null;
  month: string;
  currentMonth: string;
  classes: ClassLite[];
  roster?: RosterStudent[];
  tallies?: Record<string, TuiMuMonthTally>;
  tiers?: CheckinTier[];
  redemptions?: GiftRedemptionRow[];
}

const MONTH_WINDOW = 12;

export function TuiMuBoardScreen() {
  const data = useLoaderData() as TuiMuLoaderData;
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [confirm, confirmNode] = useConfirm();

  if (data.disabled) {
    return (
      <div className="content">
        <PageHeader title={t('tm_title')} subtitle={t('tm_sub')} />
        <Card style={{ padding: 18 }}>
          <Empty icon="gift" title={t('tm_disabled')} />
        </Card>
      </div>
    );
  }

  const { classId, month, currentMonth, classes, roster = [], tallies = {}, tiers = [], redemptions = [] } =
    data;

  const monthOptions = React.useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let i = 0; i <= MONTH_WINDOW; i++) {
      const m = shiftMonth(currentMonth, -i);
      opts.push({ value: m, label: monthLabel(m, lang) });
    }
    return opts;
  }, [currentMonth, lang]);

  const goto = (nextClassId: string, nextMonth: string) =>
    navigate(`/tui-mu/${nextClassId}/${nextMonth}`);

  const redeem = async (studentId: string, studentName: string, tier: CheckinTier) => {
    const ok = await confirm({
      title: t('tm_redeem'),
      message: t('tm_redeem_confirm', { label: tier.label, name: studentName }),
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'redeem-gift');
    fd.set('studentId', studentId);
    fd.set('month', month);
    fd.set('tierBags', String(tier.bags));
    fetcher.submit(fd, { action: '/tui-mu', method: 'post' });
  };

  return (
    <div className="content">
      <PageHeader title={t('tm_title')} subtitle={t('tm_sub')} />

      <Card style={{ padding: 14, marginBottom: 18 }}>
        <div className="assess-filters">
          <MSelect
            label={t('assess_class')}
            value={classId ?? ''}
            onChange={(v) => goto(v, month)}
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
          />
          <MSelect
            label={t('assess_month')}
            value={month}
            onChange={(m) => goto(classId ?? classes[0]?.id ?? '', m)}
            options={monthOptions}
          />
        </div>
      </Card>

      {!classId ? (
        <Card style={{ padding: 18 }}>
          <Empty icon="gift" title={t('tm_no_class')} />
        </Card>
      ) : roster.length === 0 ? (
        <Card style={{ padding: 18 }}>
          <Empty icon="gift" title={t('tm_no_class')} />
        </Card>
      ) : (
        <Card style={{ padding: 18 }}>
          <div className="m-stack" style={{ gap: 8 }}>
            {roster.map((s) => {
              const tally = tallies[s.id];
              const tier = tally ? qualifiedTier(tally.bags, tiers) : null;
              const redeemedThisTier =
                tier != null &&
                redemptions.some((r) => r.studentId === s.id && r.tierBags === tier.bags);
              return (
                <div key={s.id} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
                  <Avatar name={s.name} color={s.color} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{s.name}</div>
                    <div className="lrow__meta">
                      {t('tm_bags')}: {tally?.bags ?? 0} · {t('tm_misses')}: {tally?.misses ?? 0} ·{' '}
                      {t('tm_streak')}: {tally?.streak ?? 0}
                    </div>
                  </div>
                  {tier ? (
                    <>
                      <Badge color="orange">
                        {t('tm_tier')}: {tier.label}
                      </Badge>
                      {redeemedThisTier ? (
                        <Badge color="green">{t('tm_redeemed')}</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          iconLeft={<MIcon name="gift" size={16} />}
                          onClick={() => redeem(s.id, s.name, tier)}
                        >
                          {t('tm_redeem')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <span
                      className="m-muted"
                      style={{ fontSize: 'var(--text-sm)', color: colorOf('cocoa').ink }}
                    >
                      🎁 {tally?.bags ?? 0}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {confirmNode}
    </div>
  );
}
