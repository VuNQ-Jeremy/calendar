import React from 'react';
import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { PracticeSettingsRow } from '../../server/services/practice.js';
import type { ClassLite } from '../../server/services/classes.js';
import { usePracticeSubmit } from './common.jsx';
import { WeekdaysDialog } from './weekdays-dialog.jsx';

const { Card, Button, Tag } = DS;

interface HomeLoaderData {
  classes: ClassLite[];
  settings: PracticeSettingsRow[];
  today: string;
}

/**
 * Practice landing: one card per class, its opt-in switch, and ONE way in — the sheet for the
 * current month. Week planner, review queue and ledger all live inside the sheet now.
 */
export function PracticeHomeScreen() {
  const { classes, settings, today } = useLoaderData() as HomeLoaderData;
  const { t } = useLang();
  const submit = usePracticeSubmit();
  const [confirm, confirmNode] = useConfirm();
  const [enabling, setEnabling] = React.useState<ClassLite | null>(null);

  const byClass = new Map(settings.map((s) => [s.classId, s]));
  const month = today.slice(0, 7);

  const enable = (cls: ClassLite, weekdays: string | null) => {
    const fields: Record<string, string> = { intent: 'settings', classId: cls.id, enabled: 'true' };
    if (weekdays) fields.weekdays = weekdays;
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
    submit({ intent: 'settings', classId: cls.id, enabled: 'false', weekdays: current.weekdays });
  };

  return (
    <div className="content pr-home">
      <PageHeader title={t('pr_title')} subtitle={t('pr_sub')} />

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
                    <Link to={`/practice/${cls.id}/${month}`}>
                      <Button>{t('pr_open_sheet')}</Button>
                    </Link>
                    <Button variant="ghost" onClick={() => void disable(cls, s!)}>
                      {t('pr_disable')}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setEnabling(cls)}>
                    {t('pr_enable')}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <WeekdaysDialog
        open={!!enabling}
        title={t('pr_enable')}
        subtitle={enabling?.name}
        initial={null}
        onClose={() => setEnabling(null)}
        onSave={(weekdays) => enabling && enable(enabling, weekdays)}
      />

      {confirmNode}
    </div>
  );
}
