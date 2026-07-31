import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import {
  createRoutesStub,
  Outlet,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useRevalidator,
} from 'react-router';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { cacheGet, clearCache, subscribe } from '../src/lib/cache.js';
import { K, cacheKeyForPath, invalidateAfterMutation, swrLoad } from '../src/lib/route-cache.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mirrors app/routes/_app.tsx: the sidebar badge counts come from the *layout*
 * loader, which only re-runs for mutations under these paths, and the layout
 * also revalidates the visible route when its cache entry changes underneath it.
 * Keep both in sync with the real thing.
 */
const APP_DATA_MUTATION_PATHS = ['/people', '/feedback', '/config', '/profile'];

function shouldRevalidate({ formAction, formMethod }: ShouldRevalidateFunctionArgs) {
  if (!formAction || !formMethod || formMethod.toUpperCase() === 'GET') return false;
  const path = formAction.split('?')[0];
  return APP_DATA_MUTATION_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}

function useStaleRouteRefresh() {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const location = useLocation();
  const key = cacheKeyForPath(location.pathname);
  const ref = React.useRef({ revalidator, navigation });
  ref.current = { revalidator, navigation };
  React.useEffect(() => {
    if (!key) return;
    return subscribe(key, () => {
      const cur = ref.current;
      if (
        cacheGet(key) !== undefined &&
        cur.navigation.state === 'idle' &&
        cur.revalidator.state === 'idle'
      ) {
        cur.revalidator.revalidate();
      }
    });
  }, [key]);
}

function makeStub() {
  // One row, initially unresolved. Resolving it is the mutation under test.
  const server = { status: 'new' };
  let layoutLoads = 0;
  const Stub = createRoutesStub([
    {
      id: 'layout',
      path: '/',
      loader: async () => {
        layoutLoads++;
        await sleep(15);
        return { unresolvedFeedbackCount: server.status === 'done' ? 0 : 1 };
      },
      shouldRevalidate,
      HydrateFallback: () => null,
      Component: () => {
        useStaleRouteRefresh();
        const { unresolvedFeedbackCount } = useLoaderData() as {
          unresolvedFeedbackCount: number;
        };
        return React.createElement(
          'div',
          null,
          React.createElement('span', { 'data-testid': 'badge' }, String(unresolvedFeedbackCount)),
          React.createElement(Outlet),
        );
      },
      children: [
        {
          path: 'feedback',
          // mirrors the real clientLoader: swrLoad over the server loader
          loader: async () =>
            swrLoad(K.feedback, async () => {
              await sleep(20);
              return { feedback: [{ id: 'f1', status: server.status }] };
            }),
          action: async () => {
            await sleep(20);
            server.status = 'done';
            invalidateAfterMutation('feedback'); // mirrors the real clientAction
            return { ok: true };
          },
          Component: () => {
            const { feedback } = useLoaderData() as { feedback: { id: string; status: string }[] };
            const fetcher = useFetcher();
            return React.createElement(
              'div',
              null,
              React.createElement('span', { 'data-testid': 'status' }, feedback[0].status),
              React.createElement(
                'button',
                {
                  onClick: () => {
                    const fd = new FormData();
                    fd.set('intent', 'update');
                    fetcher.submit(fd, { action: '/feedback', method: 'post' });
                  },
                },
                'Mark resolved',
              ),
            );
          },
        },
      ],
    },
  ]);
  return { Stub, getLayoutLoads: () => layoutLoads };
}

describe('sidebar badge after a feedback mutation', () => {
  beforeEach(() => clearCache());

  it('updates the layout badge when the row is resolved', async () => {
    const { Stub } = makeStub();
    await act(async () => {
      render(React.createElement(Stub, { initialEntries: ['/feedback'] }));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('new'));
    expect(screen.getByTestId('badge')).toHaveTextContent('1');

    await act(async () => {
      fireEvent.click(screen.getByText('Mark resolved'));
    });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('done'));
    await act(async () => {
      await sleep(250);
    });

    // The row is resolved, so the badge the sidebar shows must have followed it.
    expect(screen.getByTestId('badge')).toHaveTextContent('0');
  });
});
