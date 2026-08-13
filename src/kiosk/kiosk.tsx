import React from 'react';
import { useFetcher, useLoaderData, useRevalidator } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import type { IconName } from '../icons.jsx';
import { PALETTE, colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import type { CheckPhase, CheckinSettings } from '../../shared/logic/checkin.js';
import type { ChecklistItemRow, CheckRow } from '../../server/services/checkin.js';
import type { ActivityTypeRow } from '../../server/services/checkin-activity-types.js';

const { Button } = DS;

interface RosterStudent {
  id: string;
  name: string;
  color: string;
}

interface KioskLoaderData {
  eventId: string;
  date: string;
  phase: CheckPhase;
  className: string;
  roster: RosterStudent[];
  items: ChecklistItemRow[];
  checks: CheckRow[];
  activityTypes: ActivityTypeRow[];
  settings: CheckinSettings;
  /** This month's túi mù count per student — the grid's small reward badge. */
  bagsByStudent: Record<string, number>;
}

/**
 * The classroom kiosk. No app shell, no route cache, no live socket — it polls instead
 * (60s + on tab focus) because LIVE_HUB only reaches routes inside `_app`. Two views:
 * a name grid, and one kid's fullscreen personal board. Every write goes through the
 * teacher's own session via /checkin; the kids never authenticate.
 */
export function KioskScreen() {
  const data = useLoaderData() as KioskLoaderData;
  const { t } = useLang();
  const revalidator = useRevalidator();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [localChecks, setLocalChecks] = React.useState<Set<string>>(() => new Set());
  const [celebrate, setCelebrate] = React.useState(false);
  const fetcher = useFetcher<{ ok: boolean; checks: CheckRow[]; awarded: string[] }>();

  React.useEffect(() => {
    const id = setInterval(() => revalidator.revalidate(), 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') revalidator.revalidate();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed the tapped-cell state whenever a kid is (re)selected or fresh data lands.
  React.useEffect(() => {
    if (!selected) return;
    const itemIds = new Set(data.items.map((i) => i.id));
    setLocalChecks(
      new Set(
        data.checks.filter((c) => c.studentId === selected && itemIds.has(c.itemId)).map((c) => c.itemId),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, data]);

  React.useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data?.ok) return;
    if (fetcher.data.awarded.length === 0) return;
    setCelebrate(true);
    const timer = setTimeout(() => {
      setCelebrate(false);
      setSelected(null);
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const toggle = (itemId: string) => {
    if (!selected) return;
    const wasChecked = localChecks.has(itemId);
    const next = new Set(localChecks);
    if (wasChecked) next.delete(itemId);
    else next.add(itemId);
    setLocalChecks(next);
    const fd = new FormData();
    fd.set('intent', 'check');
    fd.set('itemId', itemId);
    fd.set('studentId', selected);
    fd.set('checked', String(!wasChecked));
    fetcher.submit(fd, { action: '/checkin', method: 'post' });
  };

  const doneCount = (sid: string) =>
    data.checks.filter((c) => c.studentId === sid && data.items.some((i) => i.id === c.itemId))
      .length;

  const student = data.roster.find((s) => s.id === selected) ?? null;
  const phaseTitle =
    data.phase === 'checkin' ? t('ck_kiosk_checkin_title') : t('ck_kiosk_checkout_title');

  if (!student) {
    return (
      <div className="kiosk">
        <h1 className="kiosk-title">
          {phaseTitle} · {data.className}
        </h1>
        {data.items.length === 0 ? (
          <p className="kiosk-empty">{t('ck_kiosk_empty')}</p>
        ) : (
          <>
            <p className="kiosk-sub">{t('ck_kiosk_pick_name')}</p>
            <div className="kiosk-grid">
              {data.roster.map((s) => {
                const c = colorOf(s.color);
                const done = doneCount(s.id) >= data.items.length;
                const bags = data.bagsByStudent[s.id] ?? 0;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="kiosk-card"
                    style={{ background: c.soft }}
                    onClick={() => setSelected(s.id)}
                  >
                    <span className="kiosk-avatar" style={{ background: c.base }}>
                      {s.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="kiosk-name">{s.name}</span>
                    {done && (
                      <span className="kiosk-donebadge" aria-hidden="true">
                        <MIcon name="check" size={16} />
                      </span>
                    )}
                    {bags > 0 && <span className="kiosk-bagbadge">🎁 {bags}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="kiosk">
      <h1 className="kiosk-title">{t('ck_kiosk_hello', { name: student.name })}</h1>
      <div className="kiosk-board">
        <div className="kiosk-cells">
          {data.items.map((item) => {
            const type = data.activityTypes.find((a) => a.id === item.activityTypeId);
            const c = colorOf(type?.color ?? 'orange');
            const checked = localChecks.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className="kiosk-cell"
                style={{
                  background: checked ? c.base : c.soft,
                  color: checked ? '#fff' : c.ink,
                }}
                onClick={() => toggle(item.id)}
              >
                <MIcon name={(type?.icon as IconName) ?? 'star'} size={40} />
                <span className="kiosk-cell-label">{item.label || type?.name}</span>
                {checked && (
                  <span className="kiosk-cell-check" aria-hidden="true">
                    <MIcon name="check" size={22} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="kiosk-actions">
          <Button variant="secondary" size="lg" onClick={() => setSelected(null)}>
            {t('ck_kiosk_not_you')}
          </Button>
          <Button variant="primary" size="lg" onClick={() => setSelected(null)}>
            {t('ck_kiosk_done')}
          </Button>
        </div>
      </div>

      {celebrate && (
        <div className="kiosk-celebrate">
          <div className="garden-confetti" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ background: PALETTE[i % PALETTE.length].hex }} />
            ))}
          </div>
          <div className="kiosk-bag-msg">{t('ck_bag_earned')}</div>
        </div>
      )}
    </div>
  );
}
