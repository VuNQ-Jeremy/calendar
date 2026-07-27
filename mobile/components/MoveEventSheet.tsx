import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { DateTimeField } from '~/components/DateTimeField';
import { useLang } from '~/lib/i18n';
import { addMin, toMin } from '~/lib/cal';
import { useTheme } from '~/theme';
import { Button, Heading, Muted } from '~/ui';
import type { EventRow } from '~/lib/types';

export interface MoveTarget {
  event: EventRow;
  /** The occurrence's date — for a recurring event this is not `event.date`. */
  date: string;
}

/**
 * "Move to…" — the replacement for drag-to-reschedule.
 *
 * `src/calendar/time-grid.tsx` moves events with `onMouseDown` + `window.addEventListener`
 * ('mousemove'/'mouseup'). Those are mouse events: they do not fire on touch at all, so the
 * feature does not port — it has to be rebuilt. A drag on a 40dp time slot would also fight the
 * scroll view for every gesture, and lose.
 *
 * Semantics copy `move()` in `src/calendar/index.tsx:113-124` exactly, including the one rule that
 * is easy to get wrong: **a recurring event's date is never rewritten.** Moving one Tuesday
 * occurrence of a weekly class would silently move every occurrence, so only the time changes. The
 * duration is preserved.
 */
export function MoveEventSheet({
  target,
  onClose,
  onMove,
}: {
  target: MoveTarget | null;
  onClose: () => void;
  onMove: (patch: { id: string; date?: string; start: string; end: string }) => void;
}) {
  const th = useTheme();
  const { t } = useLang();

  const recurring = !!target && !!target.event.recurrence && target.event.recurrence !== 'none';
  const [date, setDate] = React.useState('');
  const [start, setStart] = React.useState('');

  // Reseed whenever a new event is long-pressed. `target.event.id` alone is not enough: the same
  // recurring event can be moved from two different occurrences.
  const key = target ? `${target.event.id}:${target.date}` : null;
  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!target || !key || seeded.current === key) return;
    seeded.current = key;
    setDate(target.date);
    setStart(target.event.start ?? '09:00');
  }, [target, key]);

  if (!target) return null;

  const submit = () => {
    const ev = target.event;
    const from = ev.start ?? '09:00';
    // Preserve the length of the event, as the web's drag does.
    const duration = ev.end ? Math.max(15, toMin(ev.end) - toMin(from)) : 60;
    onMove({
      id: ev.id,
      date: recurring ? undefined : date,
      start,
      end: addMin(start, duration),
    });
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the scrim dismisses, as the web modal's backdrop does. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(60,40,25,0.45)', justifyContent: 'flex-end' }}
      >
        {/* An inner Pressable with no handler swallows taps so they do not reach the scrim. */}
        <Pressable
          style={{
            backgroundColor: th.color.surfaceCard,
            borderTopLeftRadius: th.radius.xl,
            borderTopRightRadius: th.radius.xl,
            padding: th.spacing[5],
            paddingBottom: th.spacing[10],
            gap: th.spacing[4],
          }}
        >
          <Heading>{t('ev_move_to')}</Heading>
          <Muted numberOfLines={2}>{target.event.title}</Muted>

          <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
            <DateTimeField
              mode="date"
              label={t('ev_date')}
              value={date}
              onChange={setDate}
              // A recurring event's stored date defines the whole series; moving one occurrence's
              // date would move all of them. Locked, with the reason stated below.
              disabled={recurring}
            />
            <DateTimeField
              mode="time"
              label={t('ev_start')}
              value={start}
              onChange={setStart}
              dateContext={date}
            />
          </View>

          {recurring ? <Muted>{t('ev_move_recurring_note')}</Muted> : null}

          <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
            <Button variant="secondary" style={{ flex: 1 }} onPress={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="primary" style={{ flex: 1 }} onPress={submit}>
              {t('save')}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
