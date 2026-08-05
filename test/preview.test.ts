import { describe, it, expect } from 'vitest';
import {
  ictDateOfUtc,
  isPreviewEmpty,
  previewLine,
  testTouchesOccurrence,
  type ComposedPreview,
  type PreviewTestLite,
} from '../shared/logic/preview.js';

function test_(over: Partial<PreviewTestLite> = {}): PreviewTestLite {
  return {
    id: 't1',
    title: 'Unit 5 quiz',
    mode: 'online',
    date: null,
    openAt: null,
    closeAt: null,
    ...over,
  };
}

function composed(over: Partial<ComposedPreview> = {}): ComposedPreview {
  return { focusText: '', vocabTopic: null, tests: [], ...over };
}

describe('ictDateOfUtc', () => {
  it('reads a UTC instant as the Vietnamese calendar day', () => {
    expect(ictDateOfUtc('2026-08-05T03:00:00.000Z')).toBe('2026-08-05'); // 10:00 ICT
  });

  it('rolls forward for late-evening UTC, which is already tomorrow in Vietnam', () => {
    // 18:00 UTC is 01:00 the next day in ICT — the case a UTC-only comparison gets wrong.
    expect(ictDateOfUtc('2026-08-05T18:00:00.000Z')).toBe('2026-08-06');
  });

  it('does not roll back for early-morning UTC', () => {
    expect(ictDateOfUtc('2026-08-05T00:00:00.000Z')).toBe('2026-08-05'); // 07:00 ICT
  });

  it('returns empty for an unparseable stamp rather than throwing', () => {
    expect(ictDateOfUtc('not a date')).toBe('');
  });
});

describe('testTouchesOccurrence', () => {
  it('matches a test dated on the session day', () => {
    expect(testTouchesOccurrence(test_({ date: '2026-08-05' }), '2026-08-05')).toBe(true);
  });

  it('ignores a test dated on another day', () => {
    expect(testTouchesOccurrence(test_({ date: '2026-08-04' }), '2026-08-05')).toBe(false);
  });

  it('matches an online window that covers the session day', () => {
    const t = test_({ openAt: '2026-08-04T01:00:00.000Z', closeAt: '2026-08-07T01:00:00.000Z' });
    expect(testTouchesOccurrence(t, '2026-08-05')).toBe(true);
  });

  it('treats a window with no close as a single day', () => {
    const t = test_({ openAt: '2026-08-05T02:00:00.000Z' });
    expect(testTouchesOccurrence(t, '2026-08-05')).toBe(true);
    expect(testTouchesOccurrence(t, '2026-08-06')).toBe(false);
  });

  it('compares the window in ICT days, not UTC days', () => {
    // Opens 20:00 UTC on the 5th = 03:00 ICT on the 6th. The session is on the 6th.
    const t = test_({ openAt: '2026-08-05T20:00:00.000Z' });
    expect(testTouchesOccurrence(t, '2026-08-06')).toBe(true);
    expect(testTouchesOccurrence(t, '2026-08-05')).toBe(false);
  });

  it('does not match a test with neither a date nor a window', () => {
    expect(testTouchesOccurrence(test_(), '2026-08-05')).toBe(false);
  });
});

describe('previewLine', () => {
  it('is empty when there is nothing to say', () => {
    expect(previewLine(composed())).toBe('');
    expect(isPreviewEmpty(composed())).toBe(true);
  });

  it('treats whitespace-only teacher text as nothing', () => {
    expect(previewLine(composed({ focusText: '   \n ' }))).toBe('');
    expect(isPreviewEmpty(composed({ focusText: '  ' }))).toBe(true);
  });

  it('puts the teacher text first, then tests, then vocabulary', () => {
    const line = previewLine(
      composed({
        focusText: 'Unit 5 — câu điều kiện',
        tests: [test_({ title: 'Quiz 5' })],
        vocabTopic: { id: 'v1', name: 'Unit 5', slug: 'unit-5', wordCount: 20 },
      }),
    );
    expect(line).toBe('Học: Unit 5 — câu điều kiện · Kiểm tra: Quiz 5 · Ôn từ vựng: Unit 5');
  });

  it('joins several test titles', () => {
    const line = previewLine(
      composed({ tests: [test_({ title: 'A' }), test_({ id: 't2', title: 'B' })] }),
    );
    expect(line).toBe('Kiểm tra: A, B');
  });

  it('carries the auto part alone when the teacher wrote nothing', () => {
    expect(previewLine(composed({ tests: [test_({ title: 'Quiz 5' })] }))).toBe('Kiểm tra: Quiz 5');
    expect(isPreviewEmpty(composed({ tests: [test_()] }))).toBe(false);
  });

  it('truncates to the cap with an ellipsis', () => {
    const line = previewLine(composed({ focusText: 'x'.repeat(200) }), 40);
    expect(line).toHaveLength(40);
    expect(line.endsWith('…')).toBe(true);
  });

  it('leaves a line at the cap untouched', () => {
    const line = previewLine(composed({ focusText: 'abc' }), 8); // 'Học: abc' is exactly 8
    expect(line).toBe('Học: abc');
  });
});
