import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { FlipGame } from '../src/flashcards/game-flip.jsx';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { EXIT_MS } from '../shared/logic/flip-gesture';

/**
 * The swipe hand-off: when a card is swiped away, the NEXT word has to be on screen while the old
 * card is still flying out — not after it lands.
 *
 * The original implementation only advanced from the fly-out's completion callback, so the screen
 * sat empty for the whole exit plus a render. These tests pin the ordering that fixed it; they are
 * about WHEN each word is in the DOM, which is exactly what regressed.
 */

const word = (id: string, text: string, ipa: string, en: string, vi: string) => ({
  id,
  topicId: 't1',
  sortOrder: 0,
  word: text,
  ipa,
  partOfSpeech: null,
  meaningEn: en,
  meaningVi: vi,
  definitionEn: '',
  exampleEn: null,
  exampleAnswer: null,
  audioUrl: '',
  topicIds: [],
  // No picture: these assertions are about which word is in the DOM when, and an image element
  // would only add noise. The imageless card is also still the common case.
  imageKey: null,
  createdAt: '2026-01-01T00:00:00Z',
});

const WORDS = [
  word('w1', 'hello', '/həˈləʊ/', 'a greeting', 'xin chào'),
  word('w2', 'head', '/hed/', 'the top part', 'cái đầu'),
  word('w3', 'heart', '/hɑːt/', 'the organ', 'trái tim'),
];

/** jsdom reports every element as 0x0, so the commit test needs a real width to compare against. */
const CARD_W = 480;

// jsdom implements neither pointer-capture method; the component calls both during a drag.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});

function renderGame(onFinish = vi.fn()) {
  const utils = render(
    <LanguageProvider>
      <FlipGame words={WORDS} onExit={vi.fn()} onFinish={onFinish} />
    </LanguageProvider>,
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(CARD_W);
  return utils;
}

/** A committed swipe: past COMMIT_RATIO of the card width, so `shouldCommit` says yes. */
function swipe(el: HTMLElement, dir: 1 | -1 = 1) {
  const dist = CARD_W * 0.6 * dir;
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 20 * dir, clientY: 0 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: dist, clientY: 0 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: dist, clientY: 0 });
}

function card() {
  return document.querySelector('.fc-card-enter') as HTMLElement;
}

describe('flip game card hand-off', () => {
  it('shows the next word while the swiped card is still flying out', () => {
    vi.useFakeTimers();
    try {
      renderGame();
      expect(screen.getByText('hello')).toBeInTheDocument();
      expect(screen.queryByText('head')).not.toBeInTheDocument();

      act(() => swipe(card()));

      // The moment of truth: mid fly-out, BOTH are mounted — the outgoing card as a ghost and the
      // incoming word underneath it. Before the fix, 'head' only appeared after EXIT_MS.
      act(() => {
        vi.advanceTimersByTime(Math.floor(EXIT_MS / 2));
      });
      expect(screen.getByText('head')).toBeInTheDocument();
      expect(screen.getByText('hello')).toBeInTheDocument();

      // Once the exit lands the ghost is dropped and only the new word remains.
      act(() => {
        vi.advanceTimersByTime(EXIT_MS);
      });
      expect(screen.getByText('head')).toBeInTheDocument();
      expect(screen.queryByText('hello')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('advances on a button press with the same fly-out', () => {
    vi.useFakeTimers();
    try {
      renderGame();
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /know/i }));
      });
      act(() => {
        vi.advanceTimersByTime(Math.floor(EXIT_MS / 2));
      });
      expect(screen.getByText('head')).toBeInTheDocument();
      expect(screen.getByText('hello')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the round alive until the last card has finished flying', () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    try {
      renderGame(onFinish);
      for (let i = 0; i < WORDS.length; i++) {
        act(() => swipe(card()));
        // Not yet: the final card is still in the air, so the end screen must not have taken over.
        if (i === WORDS.length - 1) expect(onFinish).not.toHaveBeenCalled();
        act(() => {
          vi.advanceTimersByTime(EXIT_MS + 20);
        });
      }
      expect(onFinish).toHaveBeenCalledTimes(1);
      expect(onFinish.mock.calls[0][0]).toMatchObject({ mode: 'flip', total: WORDS.length });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not flip the card when a drag ends', () => {
    vi.useFakeTimers();
    try {
      renderGame();
      const el = card();
      // A drag that does NOT commit: it must settle back without also flipping to the meaning.
      act(() => {
        fireEvent.pointerDown(el, { pointerId: 1, clientX: 0, clientY: 0, button: 0 });
        fireEvent.pointerMove(el, { pointerId: 1, clientX: 30, clientY: 0 });
        fireEvent.pointerUp(el, { pointerId: 1, clientX: 30, clientY: 0 });
        fireEvent.click(el);
      });
      expect(screen.getByText('hello')).toBeInTheDocument();
      // Still on the word side: a plain tap is what flips, not the tail of a drag.
      expect(card()).toBe(el);
    } finally {
      vi.useRealTimers();
    }
  });
});
