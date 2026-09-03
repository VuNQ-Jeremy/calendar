import { describe, it, expect, beforeEach } from 'vitest';
import AsyncStorage from './stubs/async-storage';
import {
  clearTimer,
  elapsedMs,
  fmtDuration,
  ictHm,
  isHm,
  readTimer,
  startTimer,
  stopTimer,
  timeRange,
} from '../lib/practice-timer';

/**
 * The timer is the only self-reported number in the feature, and it survives a lock screen or an
 * app kill because it stores an INSTANT rather than a tick count. These tests pin that, and pin
 * the ICT conversion — a phone on another timezone must still report the school's wall clock,
 * because a teacher reads "20:05–20:40" as evening study.
 */
beforeEach(() => AsyncStorage.__reset());

describe('practice timer — persistence', () => {
  it('round-trips a start and keeps startedAt across a stop', async () => {
    const started = await startTimer('t1', new Date('2031-03-03T13:05:00Z'));
    expect(started.startedAt).toBe('2031-03-03T13:05:00.000Z');
    expect(await readTimer('t1')).toEqual(started);

    const stopped = await stopTimer('t1', new Date('2031-03-03T13:40:00Z'));
    expect(stopped.startedAt).toBe('2031-03-03T13:05:00.000Z');
    expect(stopped.stoppedAt).toBe('2031-03-03T13:40:00.000Z');
    expect(await readTimer('t1')).toEqual(stopped);
  });

  it('stopping without a start still records something', async () => {
    const s = await stopTimer('t2', new Date('2031-03-03T13:40:00Z'));
    expect(s.startedAt).toBe('2031-03-03T13:40:00.000Z');
    expect(s.stoppedAt).toBe('2031-03-03T13:40:00.000Z');
  });

  it('clears, and an unknown id reads empty', async () => {
    await startTimer('t3', new Date('2031-03-03T13:05:00Z'));
    await clearTimer('t3');
    expect(await readTimer('t3')).toEqual({ startedAt: null, stoppedAt: null });
    expect(await readTimer('never-started')).toEqual({ startedAt: null, stoppedAt: null });
  });
});

describe('practice timer — formatting', () => {
  it('reports ICT wall clock, not UTC', () => {
    expect(ictHm('2031-03-03T13:05:00Z')).toBe('20:05');
    expect(ictHm('2031-03-03T17:30:00Z')).toBe('00:30'); // past midnight ICT
  });

  it('a running timer ranges up to "now"', () => {
    const running = { startedAt: '2031-03-03T13:05:00Z', stoppedAt: null };
    expect(timeRange(running, new Date('2031-03-03T13:26:00Z'))).toEqual({
      from: '20:05',
      to: '20:26',
    });
    const stopped = { startedAt: '2031-03-03T13:05:00Z', stoppedAt: '2031-03-03T13:40:00Z' };
    // `now` is ignored once stopped.
    expect(timeRange(stopped, new Date('2031-03-03T23:00:00Z'))).toEqual({
      from: '20:05',
      to: '20:40',
    });
    expect(timeRange({ startedAt: null, stoppedAt: null }, new Date())).toBe(null);
  });

  it('measures elapsed against now while running', () => {
    const running = { startedAt: '2031-03-03T13:05:00Z', stoppedAt: null };
    expect(elapsedMs(running, new Date('2031-03-03T13:06:05Z'))).toBe(65_000);
    expect(elapsedMs({ startedAt: null, stoppedAt: null }, new Date())).toBe(0);
  });

  it('formats durations', () => {
    expect(fmtDuration(65_000)).toBe('1:05');
    expect(fmtDuration(3_600_000)).toBe('1:00:00');
    expect(fmtDuration(0)).toBe('0:00');
  });

  it('validates an edited HH:mm', () => {
    expect(isHm('20:05')).toBe(true);
    expect(isHm('00:00')).toBe(true);
    expect(isHm('24:00')).toBe(false);
    expect(isHm('7:05')).toBe(false);
  });
});
