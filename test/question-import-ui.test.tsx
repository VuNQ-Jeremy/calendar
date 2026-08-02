import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { Modal } from '../src/ui.jsx';
import { QuestionInput } from '../shared/schemas';
import { toPayload } from '../src/tests/question-import.jsx';
import { validateDraft, type QuestionDraft } from '../src/tests/question-editor.jsx';

// Regressions from the question-import review screen. Both bugs here were silent: one threw away a
// whole imported file on a stray keypress, the other turned one bad row into a failed batch.

function withLang(el: React.ReactElement) {
  return React.createElement(LanguageProvider, null, el);
}

describe('nested Modal escape handling', () => {
  it('closes only the top dialog, so an inner dialog cannot discard the outer one', () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      withLang(
        <>
          <Modal open onClose={closeOuter} title="Outer">
            outer body
          </Modal>
          <Modal open onClose={closeInner} title="Inner">
            inner body
          </Modal>
        </>,
      ),
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeInner).toHaveBeenCalledTimes(1);
    // The whole point: the review modal behind the row editor must survive the keypress.
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it('still closes a lone dialog on escape', () => {
    const onClose = vi.fn();
    render(
      withLang(
        <Modal open onClose={onClose} title="Only">
          body
        </Modal>,
      ),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hands escape back to the outer dialog once the inner one unmounts', () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    function Nest({ innerOpen }: { innerOpen: boolean }) {
      return (
        <>
          <Modal open onClose={closeOuter} title="Outer">
            outer body
          </Modal>
          {innerOpen && (
            <Modal open onClose={closeInner} title="Inner">
              inner body
            </Modal>
          )}
        </>
      );
    }
    const { rerender } = render(withLang(<Nest innerOpen />));
    rerender(withLang(<Nest innerOpen={false} />));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeInner).not.toHaveBeenCalled();
    expect(closeOuter).toHaveBeenCalledTimes(1);
  });

  it('keeps the stack ordered when the outer dialog re-renders with a fresh onClose', () => {
    // `onClose` is nearly always an inline arrow, so it changes identity every render. If the
    // effect depended on it, the outer dialog would re-register and steal the top of the stack.
    const closeInner = vi.fn();
    const outerCalls: number[] = [];
    function Nest({ tick }: { tick: number }) {
      return (
        <>
          <Modal open onClose={() => outerCalls.push(tick)} title="Outer">
            outer body
          </Modal>
          <Modal open onClose={closeInner} title="Inner">
            inner body
          </Modal>
        </>
      );
    }
    const { rerender } = render(withLang(<Nest tick={1} />));
    rerender(withLang(<Nest tick={2} />));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(outerCalls).toEqual([]);
  });
});

describe('toPayload', () => {
  const draft = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
    type: 'mcq',
    prompt: 'Pick one',
    context: '',
    gradeLevelId: '',
    difficulty: '',
    tags: [],
    options: [
      { id: 'a', text: 'Alpha' },
      { id: 'b', text: 'Bravo' },
    ],
    answerKey: 'a',
    explanation: '',
    ...over,
  });

  /**
   * The load-bearing one: `validateDraft` tolerates a blank option (the editor filters them on
   * save), so a row could pass the review screen's own check and then 400 the entire batch on
   * `QuestionOption.text.min(1)` — taking every other selected question down with it.
   */
  it('drops a blank option that validateDraft deliberately tolerates', () => {
    const d = draft({
      options: [
        { id: 'a', text: 'Alpha' },
        { id: 'b', text: 'Bravo' },
        { id: 'c', text: '   ' },
      ],
    });
    expect(validateDraft(d)).toBeNull();
    expect(toPayload(d).options.map((o) => o.id)).toEqual(['a', 'b']);
    expect(QuestionInput.safeParse(toPayload(d)).success).toBe(true);
  });

  it('trims option text and clamps every field to the server limits', () => {
    const d = draft({
      prompt: 'p'.repeat(4200),
      options: [
        { id: 'a', text: `  ${'o'.repeat(600)}  ` },
        { id: 'b', text: ' Bravo ' },
      ],
      explanation: 'e'.repeat(2500),
      tags: [' tag ', 't'.repeat(80)],
    });
    const payload = toPayload(d);
    expect(payload.prompt).toHaveLength(4000);
    expect(payload.options[0].text).toHaveLength(500);
    expect(payload.options[1].text).toBe('Bravo');
    expect(payload.explanation).toHaveLength(2000);
    expect(payload.tags).toEqual(['tag', 't'.repeat(50)]);
    expect(QuestionInput.safeParse(payload).success).toBe(true);
  });

  it('drops a multi answer key pointing at an option that was blanked out', () => {
    const d = draft({
      type: 'multi',
      options: [
        { id: 'a', text: 'Alpha' },
        { id: 'b', text: 'Bravo' },
        { id: 'c', text: '' },
      ],
      answerKey: ['a', 'c'],
    });
    expect(toPayload(d).answerKey).toEqual(['a']);
    expect(QuestionInput.safeParse(toPayload(d)).success).toBe(true);
  });

  it('strips options from text and essay questions and nulls an essay answer key', () => {
    const text = toPayload(draft({ type: 'text', answerKey: [' Hà Nội ', '  '] }));
    expect(text.options).toEqual([]);
    expect(text.answerKey).toEqual(['Hà Nội']);
    expect(QuestionInput.safeParse(text).success).toBe(true);

    const essay = toPayload(draft({ type: 'essay', answerKey: null }));
    expect(essay.options).toEqual([]);
    expect(essay.answerKey).toBeNull();
    expect(QuestionInput.safeParse(essay).success).toBe(true);
  });

  it('turns the empty select values into nulls', () => {
    const payload = toPayload(draft({ gradeLevelId: '', difficulty: '', explanation: '  ' }));
    expect(payload.gradeLevelId).toBeNull();
    expect(payload.difficulty).toBeNull();
    expect(payload.explanation).toBeNull();
  });

  it('carries the passage through, trimmed, and nulls a blank one', () => {
    const passage = 'Read the passage.\n\nWater covers most of the planet.';
    expect(toPayload(draft({ context: `  ${passage}  ` })).context).toBe(passage);
    expect(toPayload(draft({ context: '   ' })).context).toBeNull();
    expect(toPayload(draft({ context: 'c'.repeat(9000) })).context).toHaveLength(8000);
    expect(QuestionInput.safeParse(toPayload(draft({ context: passage }))).success).toBe(true);
  });
});
