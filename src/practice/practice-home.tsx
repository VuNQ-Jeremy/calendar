import React from 'react';
import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { getCal } from '../../shared/i18n/strings.js';
import { parseWeekdays, formatWeekdays } from '../../shared/logic/practice.js';
import type { PracticeSettingsRow } from '../../server/services/practice.js';
import type { ClassLite } from '../../server/services/classes.js';
import { mondayOf, usePracticeSubmit } from './common.jsx';

const { Card, Button, Tag, Checkbox } = DS;

interface HomeLoaderData {
  classes: ClassLite[];
  settings: PracticeSettingsRow[];
  today: string;
}

/**
 * Practice landing: one card per class, its opt-in switch, and the two ways in (week, ledger).
 *
 * The enable dialog deliberately starts with NO weekday boxes ticked and does not send
 * `weekdays` unless the teacher touches them — that absence is the signal the server uses to
 * derive Mon–Sat minus this class's own lesson days (decision #5). Ticking a box opts into an
 * explicit mask instead.
 */
export function PracticeHomeScreen() {
  const { classes, settings, today } = useLoaderData() as HomeLoaderData;
  const { t, lang } = useLang();
  const submit = usePracticeSubmit();
  const [confirm, confirmNode] = useConfirm();
  const [enabling, setEnabling] = React.useState<ClassLite | null>(null);
  const [picked, setPicked] = React.useState<Set<number>>(new Set());

  const byClass = new Map(settings.map((s) => [s.classId, s]));
  const cal = getCal(lang);
  const monday = mondayOf(today);
  const month = today.slice(0, 7);

  const openEnable = (cls: ClassLite) => {
    setPicked(new Set());
    setEnabling(cls);
  };

  const saveEnable = () => {
    const cls = enabling!;
    setEnabling(null); // optimistic close, house pattern
    const fields: Record<string, string> = {
      intent: 'settings',
      classId: cls.id,
      enabled: 'true',
    };
    if (picked.size) fields.weekdays = formatWeekdays(picked);
    submit(fields);
  };

  const disable = async (cls: ClassLite, current: PracticeSettingsRow) => {
    const ok = await confirm({
      title: t('pr_disable'),
      message: t('pr_disable_confirm'),
      confirmLabel: t('pr_disable'),
      danger: true,
    });
    if (!ok) return;
    submit({
      intent: 'settings',
      classId: cls.id,
      enabled: 'false',
      weekdays: current.weekdays,
    });
  };

  return (
    <div className="content pr-home">
      <PageHeader
        title={t('pr_title')}
        subtitle={t('pr_sub')}
        actions={
          <Link to="/practice/review">
            <Button variant="secondary" iconLeft={<MIcon name="check" size={16} />}>
              {t('pr_review_queue')}
            </Button>
          </Link>
        }
      />

      <div className="pr-home__list">
        {classes.map((cls) => {
          const s = byClass.get(cls.id);
          const on = !!s?.enabled;
          return (
            <Card key={cls.id} className="pr-home__card">
              <div className="pr-home__name">
                <Tag color={(cls.color as 'violet') ?? 'neutral'}>{cls.name}</Tag>
                {on && <Tag color="green">{t('pr_enabled_badge')}</Tag>}
              </div>
              <div className="pr-home__actions">
                {on ? (
                  <>
                    <Link to={`/practice/${cls.id}/week/${monday}`}>
                      <Button variant="secondary">{t('pr_open_week')}</Button>
                    </Link>
                    <Link to={`/practice/${cls.id}/ledger/${month}`}>
                      <Button variant="secondary">{t('pr_open_ledger')}</Button>
                    </Link>
                    <Button variant="ghost" onClick={() => void disable(cls, s!)}>
                      {t('pr_disable')}
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => openEnable(cls)}>{t('pr_enable')}</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Modal
        open={!!enabling}
        onClose={() => setEnabling(null)}
        title={t('pr_enable')}
        subtitle={enabling?.name}
        width={460}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnabling(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={saveEnable}>{t('save')}</Button>
          </>
        }
      >
        <div className="mochi-field">
          <label className="mochi-field__label">{t('pr_weekdays')}</label>
          <div className="pr-home__days">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
              <Checkbox
                key={wd}
                label={cal.dow[wd]}
                checked={picked.has(wd)}
                onChange={() => {
                  const next = new Set(picked);
                  if (next.has(wd)) next.delete(wd);
                  else next.add(wd);
                  setPicked(next);
                }}
              />
            ))}
          </div>
          <span className="mochi-field__hint">{t('pr_weekdays_help')}</span>
        </div>
      </Modal>

      {confirmNode}
    </div>
  );
}

/** Exported for the ledger/week screens, which show the same mask read-only. */
export const weekdayLabels = (mask: string, lang: string) => {
  const cal = getCal(lang);
  return [...parseWeekdays(mask)]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((wd) => cal.dow[wd])
    .join(', ');
};
