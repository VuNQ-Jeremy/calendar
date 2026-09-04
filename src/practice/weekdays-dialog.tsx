import React from 'react';
import { DS } from '../ds/index.js';
import { Modal } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { getCal } from '../../shared/i18n/strings.js';
import { formatWeekdays, parseWeekdays } from '../../shared/logic/practice.js';

const { Button, Checkbox } = DS;

/**
 * The weekday-mask dialog, shared by the class card (first enable) and the sheet header (edit).
 *
 * On a FIRST enable it opens with nothing ticked and, if the teacher never touches a box, saves
 * `null` — the signal the server uses to derive Mon–Sat minus this class's own lesson days
 * (decision #5). Ticking anything opts into an explicit mask. When editing an existing mask the
 * boxes start from it and the save is always explicit.
 */
export function WeekdaysDialog({
  open,
  title,
  subtitle,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  initial: string | null;
  onClose: () => void;
  onSave: (weekdays: string | null) => void;
}) {
  const { t, lang } = useLang();
  const cal = getCal(lang);
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPicked(initial ? parseWeekdays(initial) : new Set());
    setTouched(false);
  }, [open, initial]);

  const toggle = (wd: number) => {
    const next = new Set(picked);
    if (next.has(wd)) next.delete(wd);
    else next.add(wd);
    setPicked(next);
    setTouched(true);
  };

  const save = () => {
    onClose(); // optimistic close, house pattern
    onSave(initial === null && !touched ? null : formatWeekdays(picked));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save}>{t('save')}</Button>
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
              onChange={() => toggle(wd)}
            />
          ))}
        </div>
        <span className="mochi-field__hint">{t('pr_weekdays_help')}</span>
      </div>
    </Modal>
  );
}
