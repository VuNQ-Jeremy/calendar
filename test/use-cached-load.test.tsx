import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { cacheSet, clearCache, isStale, markStale } from '../src/lib/cache.js';
import { useCachedLoad } from '../src/lib/use-cached-load.js';

/**
 * useCachedLoad backs the calendar event modal's attendance and event-material
 * tabs. The behaviour under test is the stale branch: without it a live update
 * marking an `att:` key stale was a silent no-op, so a roster edited by someone
 * else never appeared.
 */

const KEY = 'att:evt-1:2026-08-03';
const URL_ = '/attendance?eventId=evt-1&date=2026-08-03';

let loads = 0;

function Probe() {
  const { data } = useCachedLoad<{ records: { studentId: string }[] }>(KEY, URL_);
  return (
    <div data-testid="out">{data ? data.records.map((r) => r.studentId).join(',') : 'none'}</div>
  );
}

function stub(records: string[]) {
  return createRoutesStub([
    { path: '/', Component: Probe },
    {
      path: '/attendance',
      loader: () => {
        loads++;
        return { records: records.map((studentId) => ({ studentId })) };
      },
    },
  ]);
}

beforeEach(() => {
  clearCache();
  loads = 0;
});

describe('useCachedLoad', () => {
  it('fetches once on a cache miss and caches the result', async () => {
    const Stub = stub(['s1']);
    render(<Stub initialEntries={['/']} />);

    expect(screen.getByTestId('out').textContent).toBe('none');
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('s1'));
    expect(loads).toBe(1);
  });

  it('serves a fresh cache hit without touching the network', async () => {
    cacheSet(KEY, { records: [{ studentId: 'cached' }] });
    const Stub = stub(['s1']);
    render(<Stub initialEntries={['/']} />);

    expect(screen.getByTestId('out').textContent).toBe('cached');
    // Give an unwanted load room to happen.
    await new Promise((r) => setTimeout(r, 50));
    expect(loads).toBe(0);
  });

  it('serves a stale hit instantly, then refreshes it underneath', async () => {
    cacheSet(KEY, { records: [{ studentId: 'old' }] });
    markStale('att:');
    expect(isStale(KEY)).toBe(true);

    const Stub = stub(['fresh']);
    render(<Stub initialEntries={['/']} />);

    // Stale data is shown immediately — the modal must not blank mid-edit.
    expect(screen.getByTestId('out').textContent).toBe('old');
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('fresh'));
    expect(loads).toBe(1);
    expect(isStale(KEY)).toBe(false);
  });

  it('refreshes again when a later broadcast marks the key stale', async () => {
    cacheSet(KEY, { records: [{ studentId: 'old' }] });
    const Stub = stub(['fresh']);
    render(<Stub initialEntries={['/']} />);

    expect(loads).toBe(0);
    markStale('att:');
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('fresh'));
    expect(loads).toBe(1);
  });

  it('claims the refresh so one stale flag causes exactly one fetch', async () => {
    cacheSet(KEY, { records: [{ studentId: 'old' }] });
    markStale('att:');

    const Stub = stub(['fresh']);
    render(<Stub initialEntries={['/']} />);

    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('fresh'));
    await new Promise((r) => setTimeout(r, 80));
    expect(loads).toBe(1);
  });
});
