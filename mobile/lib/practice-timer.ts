/**
 * Practice timer state.
 *
 * Persisting `startedAt` (not a tick count) is what makes the timer honest across a lock screen
 * or an app kill: elapsed is always `now - startedAt`, so a student who backgrounds the app
 * halfway through a task comes back to the real number rather than a stalled one.
 *
 * The reported range is ICT wall-clock, not the device's: it is written into a column a teacher
 * reads, and a phone left on another timezone would otherwise report 13:05 for 20:05.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = (id: string) => `mochi_practice_timer_v1:${id}`;

export type TimerState = { startedAt: string | null; stoppedAt: string | null };

export const EMPTY_TIMER: TimerState = { startedAt: null, stoppedAt: null };

export async function readTimer(id: string): Promise<TimerState> {
  try {
    const raw = await AsyncStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as TimerState) : { ...EMPTY_TIMER };
  } catch {
    // A corrupt or unavailable store must not block the student from submitting.
    return { ...EMPTY_TIMER };
  }
}

export async function startTimer(id: string, now: Date): Promise<TimerState> {
  const s: TimerState = { startedAt: now.toISOString(), stoppedAt: null };
  await AsyncStorage.setItem(KEY(id), JSON.stringify(s));
  return s;
}

/** Stopping without a start still records one — the student pressed stop, so something happened. */
export async function stopTimer(id: string, now: Date): Promise<TimerState> {
  const cur = await readTimer(id);
  const s: TimerState = {
    startedAt: cur.startedAt ?? now.toISOString(),
    stoppedAt: now.toISOString(),
  };
  await AsyncStorage.setItem(KEY(id), JSON.stringify(s));
  return s;
}

export async function clearTimer(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY(id));
  } catch {
    /* storage unavailable */
  }
}

/** 'HH:mm' in ICT for a UTC instant (the school's clock, not the device's). */
export function ictHm(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** '20:50'–'21:26' from a timer state; null until started. While running, `to` is "now". */
export function timeRange(s: TimerState, now: Date): { from: string; to: string } | null {
  if (!s.startedAt) return null;
  return { from: ictHm(s.startedAt), to: ictHm(s.stoppedAt ?? now.toISOString()) };
}

/** Elapsed milliseconds of a timer state, measured against `now` while it is still running. */
export function elapsedMs(s: TimerState, now: Date): number {
  if (!s.startedAt) return 0;
  const end = s.stoppedAt ? new Date(s.stoppedAt).getTime() : now.getTime();
  return Math.max(0, end - new Date(s.startedAt).getTime());
}

/** 'm:ss' / 'h:mm:ss' elapsed. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** The student may edit the range before submitting; both halves must stay 'HH:mm'. */
export const isHm = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
