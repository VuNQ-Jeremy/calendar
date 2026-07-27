import React from 'react';
import { Pressable, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CalendarDays, Clock } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { fmtTime } from '~/lib/cal';
import { useTheme, TOUCH } from '~/theme';
import { Body, Muted } from '~/ui';

/**
 * A tappable field that opens the platform date or time picker.
 *
 * This is the mobile answer to the web's `MDatePicker` / `MTimePicker` popovers, and it is also
 * what replaces drag-to-reschedule: `src/calendar/time-grid.tsx` moves events with `onMouseDown`
 * plus `window.addEventListener('mousemove')`, which does not fire on touch at all. A long-press
 * that opens this is both buildable and better — a 40dp time slot is smaller than a fingertip.
 *
 * The picker is rendered only while open. On Android it IS a dialog (there is nothing inline to
 * lay out), and leaving it mounted keeps a stale `value` around after the field changes.
 */
export function DateTimeField({
  mode,
  label,
  /** `YYYY-MM-DD` for mode="date", `HH:MM` for mode="time". Empty means unset. */
  value,
  onChange,
  /** The day a time picker belongs to, so the Date handed to the picker is the right one. */
  dateContext,
  disabled,
}: {
  mode: 'date' | 'time';
  label?: string;
  value: string;
  onChange: (next: string) => void;
  dateContext?: string;
  disabled?: boolean;
}) {
  const th = useTheme();
  const { t, lang } = useLang();
  const [open, setOpen] = React.useState(false);

  const asDate = React.useMemo(() => {
    const base = new Date();
    base.setSeconds(0, 0);
    if (mode === 'date') {
      if (!value) return base;
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const day = dateContext ? dateContext.split('-').map(Number) : null;
    const out = day ? new Date(day[0], day[1] - 1, day[2]) : base;
    if (value) {
      const [h, mi] = value.split(':').map(Number);
      out.setHours(h, mi, 0, 0);
    }
    return out;
  }, [mode, value, dateContext]);

  const commit = (event: DateTimePickerEvent, picked?: Date) => {
    setOpen(false);
    if (event.type !== 'set' || !picked) return;
    if (mode === 'date') {
      const y = picked.getFullYear();
      const m = String(picked.getMonth() + 1).padStart(2, '0');
      const d = String(picked.getDate()).padStart(2, '0');
      onChange(`${y}-${m}-${d}`);
    } else {
      onChange(
        `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`,
      );
    }
  };

  const shown = value
    ? mode === 'date'
      ? asDate.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : fmtTime(value, true)
    : t('dp_pick_date');

  return (
    <View style={{ gap: th.spacing[2], flex: 1, minWidth: 0 }}>
      {label ? (
        <Body style={{ fontFamily: th.font.bodyBold, fontSize: th.text.sm.fontSize }}>{label}</Body>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label ?? ''} ${shown}`.trim()}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: th.spacing[2],
          minHeight: TOUCH,
          paddingHorizontal: th.spacing[4],
          borderWidth: 1.5,
          borderColor: th.color.borderStrong,
          borderRadius: th.radius.md,
          backgroundColor: disabled
            ? th.color.surfaceSunken
            : pressed
              ? th.color.surfaceHover
              : th.color.surfaceCard,
          opacity: disabled ? 0.6 : 1,
        })}
      >
        {mode === 'date' ? (
          <CalendarDays size={18} color={th.color.textMuted} />
        ) : (
          <Clock size={18} color={th.color.textMuted} />
        )}
        {value ? (
          <Body style={{ flex: 1 }} numberOfLines={1}>
            {shown}
          </Body>
        ) : (
          <Muted style={{ flex: 1 }} numberOfLines={1}>
            {shown}
          </Muted>
        )}
      </Pressable>

      {open ? (
        <DateTimePicker value={asDate} mode={mode} is24Hour={false} onChange={commit} />
      ) : null}
    </View>
  );
}
