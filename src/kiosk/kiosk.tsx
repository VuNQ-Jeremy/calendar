import React from 'react';
import { createPortal } from 'react-dom';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import type { IconName } from '../icons.jsx';
import { PALETTE, colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { useCachedLoad } from '../lib/use-cached-load.js';
import { markStale } from '../lib/cache.js';
import type { CheckPhase } from '../../shared/logic/checkin.js';
import type { ChecklistItemRow, CheckRow } from '../../server/services/checkin.js';
import type { ActivityTypeRow } from '../../server/services/checkin-activity-types.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import { AssignModal } from '../garden/assign-modal.jsx';

const { Button, IconButton } = DS;

/** `/checkin?kiosk=1` — the authoring payload plus the grid's per-kid month bag counts. */
interface KioskPayload {
  items: ChecklistItemRow[];
  checks: CheckRow[];
  activityTypes: ActivityTypeRow[];
  bagsByStudent?: Record<string, number>;
}

interface KioskModalProps {
  eventId: string;
  date: string;
  classId: string;
  classes: ClassRow[];
  students: StudentRow[];
  initialPhase: CheckPhase;
  onClose: () => void;
}

/**
 * "Giao từ vựng" from the kiosk's checkout screen — same dialog as the event modal's section.
 * Its own top-level component (never inline) so the /event-previews load (for the topic
 * picker) mounts only on demand — kids tapping through checkout never pay for it, and a fresh
 * component identity on every render would otherwise unmount/remount the whole kiosk subtree.
 */
function KioskAssign({
  eventId,
  date,
  classId,
  classes,
  roster,
  onClose,
}: {
  eventId: string;
  date: string;
  classId: string;
  classes: ClassRow[];
  roster: StudentRow[];
  onClose: () => void;
}) {
  const { data } = useCachedLoad<{ topics: { id: string; name: string }[] }>(
    `prev:${eventId}:${date}`,
    `/event-previews?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
  );
  const fetcher = useFetcher<{ ok: boolean }>();
  React.useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);
  return (
    <AssignModal
      topics={data?.topics ?? []}
      classes={classes.filter((c) => c.id === classId)}
      today={date}
      onClose={onClose}
      onSubmit={(fd) => fetcher.submit(fd, { action: '/vocabulary', method: 'post' })}
      rosterStudents={roster.map((s) => ({ id: s.id, name: s.name }))}
    />
  );
}

/**
 * The classroom kiosk: a fullscreen layer over the app, handed to the class on a shared
 * tablet. It was a standalone route once; living inside `_app` instead means it reaches the
 * LIVE_HUB socket, so a list the teacher edits from their laptop mid-class arrives by push
 * and the old 60-second poll is gone.
 *
 * Mount it only while open — the data load is a hook, and a closed kiosk should not be
 * fetching. Kids never authenticate: every write rides the teacher's own staff session
 * through /checkin.
 */
export function KioskModal({
  eventId,
  date,
  classId,
  classes,
  students,
  initialPhase,
  onClose,
}: KioskModalProps) {
  const { t } = useLang();
  const [phase, setPhase] = React.useState<CheckPhase>(initialPhase);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [localChecks, setLocalChecks] = React.useState<Set<string>>(() => new Set());
  const [celebrate, setCelebrate] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);
  const fetcher = useFetcher<{ ok: boolean; checks: CheckRow[]; awarded: string[] }>();

  const kioskKey = `ck:kiosk:${eventId}:${date}`;
  const { data } = useCachedLoad<KioskPayload>(
    kioskKey,
    `/checkin?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}&kiosk=1`,
  );

  const cls = classes.find((c) => c.id === classId);
  const roster = React.useMemo(
    () =>
      (cls?.studentIds ?? [])
        .map((sid) => students.find((s) => s.id === sid))
        .filter((s): s is StudentRow => !!s),
    [cls, students],
  );
  const items = React.useMemo(
    () => (data?.items ?? []).filter((i) => i.phase === phase),
    [data, phase],
  );
  const checks = data?.checks ?? [];
  const bags = data?.bagsByStudent ?? {};

  const checksOf = React.useCallback(
    (studentId: string, forItems: ChecklistItemRow[], from: CheckRow[]) => {
      const ids = new Set(forItems.map((i) => i.id));
      return new Set(
        from.filter((c) => c.studentId === studentId && ids.has(c.itemId)).map((c) => c.itemId),
      );
    },
    [],
  );

  // Seed the tapped cells when a kid opens their board (or flips phase), and only then. A
  // background refresh must not re-seed mid-session: one triggered by an earlier tap can land
  // while a later tap is still in flight, and its older snapshot would blink the cell the kid
  // just pressed back off. Writes reconcile from their own response instead, below.
  React.useEffect(() => {
    if (!selected || !data) return;
    setLocalChecks(checksOf(selected, items, data.checks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, phase]);

  // The write's own response is authoritative for this kid's cells; a bag award additionally
  // marks the payload stale so the grid's badge catches up without waiting on the socket.
  React.useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data?.ok) return;
    if (selected) setLocalChecks(checksOf(selected, items, fetcher.data.checks));
    if (fetcher.data.awarded.length === 0) return;
    markStale(kioskKey);
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
    // Deliberately no noteLocalMutation: the echo of this write is what refreshes the teacher's
    // authoring tab (its own 'ck:' key) when the kiosk was opened from it, in this same tab.
    fetcher.submit(fd, { action: '/checkin', method: 'post' });
  };

  const student = roster.find((s) => s.id === selected) ?? null;
  const phaseTitle =
    phase === 'checkin' ? t('ck_kiosk_checkin_title') : t('ck_kiosk_checkout_title');

  const chrome = (
    <div className="kiosk-chrome">
      <div className="kiosk-phase">
        {(['checkin', 'checkout'] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`kiosk-phase__chip${p === phase ? ' is-on' : ''}`}
            onClick={() => {
              setPhase(p);
              setSelected(null);
            }}
          >
            {p === 'checkin' ? t('ck_kiosk_checkin_title') : t('ck_kiosk_checkout_title')}
          </button>
        ))}
      </div>
      {phase === 'checkout' && (
        <Button variant="secondary" onClick={() => setAssigning(true)}>
          {t('ck_assign_vocab')}
        </Button>
      )}
      <IconButton label={t('ck_kiosk_close')} onClick={onClose}>
        <MIcon name="x" size={20} />
      </IconButton>
    </div>
  );

  // Portalled to <body>, the same escape hatch MSelect's menu uses: opened from the event
  // dialog, this would otherwise sit inside `.m-dialog__body`, whose overflow clips it the
  // moment the dialog's pop animation makes `.m-dialog` a containing block for fixed children.
  return createPortal(
    <div className="kiosk-overlay">
      <div className="kiosk">
        {chrome}
        {!student ? (
          <>
            <h1 className="kiosk-title">
              {phaseTitle} · {cls?.name ?? ''}
            </h1>
            {/* Not `items.length === 0` alone: the payload loads client-side now, and a blank
                first paint would tell the class there is no checklist a beat before there is. */}
            {!data ? (
              <p className="kiosk-empty">{t('ck_kiosk_loading')}</p>
            ) : items.length === 0 ? (
              <p className="kiosk-empty">{t('ck_kiosk_empty')}</p>
            ) : (
              <>
                <p className="kiosk-sub">{t('ck_kiosk_pick_name')}</p>
                <div className="kiosk-grid">
                  {roster.map((s) => {
                    const c = colorOf(s.color);
                    const done = checksOf(s.id, items, checks).size >= items.length;
                    const bagCount = bags[s.id] ?? 0;
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
                        {bagCount > 0 && <span className="kiosk-bagbadge">🎁 {bagCount}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <h1 className="kiosk-title">{t('ck_kiosk_hello', { name: student.name })}</h1>
            <div className="kiosk-board">
              <div className="kiosk-cells">
                {items.map((item) => {
                  const special = item.kind !== 'custom';
                  const type = special
                    ? null
                    : data?.activityTypes.find((a) => a.id === item.activityTypeId);
                  const c = colorOf(
                    special
                      ? item.kind === 'homework'
                        ? 'blue'
                        : 'green'
                      : (type?.color ?? 'orange'),
                  );
                  const checked = localChecks.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`kiosk-cell${special ? ' kiosk-cell--special' : ''}`}
                      style={{
                        background: checked ? c.base : c.soft,
                        color: checked ? '#fff' : c.ink,
                        borderColor: special ? c.base : 'transparent',
                      }}
                      onClick={() => toggle(item.id)}
                    >
                      <MIcon
                        name={
                          special
                            ? item.kind === 'homework'
                              ? 'book'
                              : 'star'
                            : ((type?.icon as IconName) ?? 'star')
                        }
                        size={40}
                      />
                      {/* Both halves, not one or the other: the type says what kind of homework
                          this was, the label says which — "Vocabulary" over "10 words: Animals". */}
                      {special ? (
                        <span className="kiosk-cell-type">
                          {t(item.kind === 'homework' ? 'ck_sq_homework' : 'ck_sq_vocab')}
                        </span>
                      ) : (
                        type && <span className="kiosk-cell-type">{type.name}</span>
                      )}
                      {item.label && <span className="kiosk-cell-label">{item.label}</span>}
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
          </>
        )}

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

        {assigning && (
          <KioskAssign
            eventId={eventId}
            date={date}
            classId={classId}
            classes={classes}
            roster={roster}
            onClose={() => setAssigning(false)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
