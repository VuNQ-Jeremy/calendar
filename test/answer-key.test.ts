import { describe, it, expect } from 'vitest';
import {
  parseAnswerKey,
  applyAnswerKey,
  stripHtml,
  type KeyTarget,
} from '../shared/logic/answer-key';

// A teacher's answer key arrives as free text — pasted from a message, or read out of a second
// Word file. Everything here is about the shapes that turn up in real Vietnamese school papers,
// and about not mis-assigning an answer when the sanitizer dropped an option.

const numbers = (text: string) =>
  parseAnswerKey(text).map((e) => `${e.number}${e.letters.join('')}`);

describe('parseAnswerKey', () => {
  it('reads one answer per line in the usual punctuations', () => {
    expect(numbers('1. B\n2) C\n3 - A\n4: D')).toEqual(['1B', '2C', '3A', '4D']);
  });

  it('reads a run of answers written on one line', () => {
    expect(numbers('1. B  2. C  3. D  4. A')).toEqual(['1B', '2C', '3D', '4A']);
  });

  it('reads a key with no punctuation at all', () => {
    expect(numbers('1B 2C 3D')).toEqual(['1B', '2C', '3D']);
  });

  it('reads the Vietnamese and English question-word prefixes', () => {
    expect(numbers('Câu 1: B\nCâu 2: A')).toEqual(['1B', '2A']);
    expect(numbers('Question 12. D\nQ13. A\nBài 14 - C')).toEqual(['12D', '13A', '14C']);
  });

  it('reads several letters as a multi-select answer, however they are joined', () => {
    expect(parseAnswerKey('1. A, C').at(0)?.letters).toEqual(['A', 'C']);
    expect(parseAnswerKey('2. AC').at(0)?.letters).toEqual(['A', 'C']);
    expect(parseAnswerKey('3. B and D').at(0)?.letters).toEqual(['B', 'D']);
    expect(parseAnswerKey('4. B và D').at(0)?.letters).toEqual(['B', 'D']);
  });

  it('keeps a written-out answer as raw text rather than reading letters out of it', () => {
    const [entry] = parseAnswerKey('3. Hà Nội');
    expect(entry.letters).toEqual([]);
    expect(entry.raw).toBe('Hà Nội');
  });

  it('finds the letter in a key that explains itself', () => {
    expect(parseAnswerKey('Câu 1: Đáp án B').at(0)?.letters).toEqual(['B']);
    expect(parseAnswerKey('2. C (the only plural form)').at(0)?.letters).toEqual(['C']);
  });

  it('reads a tab-separated table, the shape a Word key pastes as', () => {
    expect(numbers('1\tB\n2\tD\n3\tA')).toEqual(['1B', '2D', '3A']);
  });

  it('reads a key that arrived as mammoth HTML', () => {
    const html = '<table><tr><td>1.</td><td>B</td></tr><tr><td>2.</td><td>C</td></tr></table>';
    expect(numbers(html)).toEqual(['1B', '2C']);
    expect(numbers('<p>1. B</p><p>2. C</p>')).toEqual(['1B', '2C']);
  });

  it('is not fooled by a number at the end of the key’s own heading', () => {
    // "TEST 10" is not question 10 — and if it were read as one, first-entry-wins would let the
    // heading shadow the real answer for 10 further down.
    const key = 'ĐÁP ÁN PRACTICE TEST 10\n\nCâu 1: D\nCâu 10: B';
    expect(numbers(key)).toEqual(['1D', '10B']);
  });

  it('is not fooled by numbers inside prose', () => {
    // A year is neither preceded by a boundary it can use nor followed by a separator or letter.
    expect(parseAnswerKey('The war ended in 1975 and the country was reunified.')).toEqual([]);
    expect(numbers('ANSWER KEY\n\n1. B')).toEqual(['1B']);
  });

  it('keeps the first answer given for a number', () => {
    expect(numbers('1. B\n2. C\n1. D')).toEqual(['1B', '2C']);
  });

  it('returns nothing for text with no key in it', () => {
    expect(parseAnswerKey('')).toEqual([]);
    expect(parseAnswerKey('Good luck everyone!')).toEqual([]);
  });
});

describe('stripHtml', () => {
  it('leaves plain text exactly as it was', () => {
    expect(stripHtml('1. B\n2. C')).toBe('1. B\n2. C');
  });

  it('keeps adjacent cells apart so their answers do not run together', () => {
    expect(stripHtml('<td>1. B</td><td>2. C</td>')).toContain('\t');
  });
});

describe('applyAnswerKey', () => {
  const target = (over: Partial<KeyTarget> = {}): KeyTarget => ({
    type: 'mcq',
    letterIds: ['a1', 'a2', 'a3', 'a4'],
    sourceNumber: 1,
    ...over,
  });

  it('resolves a letter to the option that letter was printed against', () => {
    const { applied } = applyAnswerKey([target()], parseAnswerKey('1. C'));
    expect(applied).toEqual([{ index: 0, type: 'mcq', answerKey: 'a3' }]);
  });

  /**
   * The load-bearing case. Option B was blank and dropped, so the surviving options are A, C, D.
   * Counting "C" into that array would land on D. The printed position is what the key means.
   */
  it('resolves the letter against the printed position, not the surviving options', () => {
    const { applied } = applyAnswerKey(
      [target({ letterIds: ['a1', null, 'a3', 'a4'] })],
      parseAnswerKey('1. C'),
    );
    expect(applied[0].answerKey).toBe('a3');
  });

  it('promotes a question to multi when the key names several letters', () => {
    const { applied } = applyAnswerKey([target()], parseAnswerKey('1. A, D'));
    expect(applied[0]).toEqual({ index: 0, type: 'multi', answerKey: ['a1', 'a4'] });
  });

  it('keeps a multi question multi even when the key names one letter', () => {
    const { applied } = applyAnswerKey([target({ type: 'multi' })], parseAnswerKey('1. B'));
    expect(applied[0]).toEqual({ index: 0, type: 'multi', answerKey: ['a2'] });
  });

  it('matches by the printed question number, not by position in the list', () => {
    const targets = [target({ sourceNumber: 12 }), target({ sourceNumber: 11 })];
    const { applied } = applyAnswerKey(targets, parseAnswerKey('11. A\n12. D'));
    expect(applied).toEqual([
      { index: 0, type: 'mcq', answerKey: 'a4' },
      { index: 1, type: 'mcq', answerKey: 'a1' },
    ]);
  });

  it('takes the key line as the accepted answer for a short-answer question', () => {
    const { applied } = applyAnswerKey(
      [target({ type: 'text', letterIds: [] })],
      parseAnswerKey('1. Hà Nội'),
    );
    expect(applied[0]).toEqual({ index: 0, type: 'text', answerKey: ['Hà Nội'] });
  });

  it('leaves an essay question alone — there is nothing to key', () => {
    const { applied, unmatchedNumbers } = applyAnswerKey(
      [target({ type: 'essay' })],
      parseAnswerKey('1. B'),
    );
    expect(applied).toEqual([]);
    expect(unmatchedNumbers).toEqual([1]);
  });

  it('reports a key number no question carries', () => {
    const { applied, unmatchedNumbers } = applyAnswerKey([target()], parseAnswerKey('1. B\n9. C'));
    expect(applied).toHaveLength(1);
    expect(unmatchedNumbers).toEqual([9]);
  });

  it('reports — and does not half-apply — a letter this question has no option for', () => {
    const { applied, unresolvedNumbers } = applyAnswerKey(
      [target({ letterIds: ['a1', 'a2'] })],
      parseAnswerKey('1. D'),
    );
    expect(applied).toEqual([]);
    expect(unresolvedNumbers).toEqual([1]);
  });

  it('skips a question the document never numbered', () => {
    const { applied, unmatchedNumbers } = applyAnswerKey(
      [target({ sourceNumber: null })],
      parseAnswerKey('1. B'),
    );
    expect(applied).toEqual([]);
    expect(unmatchedNumbers).toEqual([1]);
  });

  it('applies a whole forty-question key in one pass', () => {
    const key = Array.from({ length: 40 }, (_, i) => `${i + 1}. ${'ABCD'[i % 4]}`).join('  ');
    const targets = Array.from({ length: 40 }, (_, i) => target({ sourceNumber: i + 1 }));
    const { applied, unmatchedNumbers, unresolvedNumbers } = applyAnswerKey(
      targets,
      parseAnswerKey(key),
    );
    expect(applied).toHaveLength(40);
    expect(applied[2].answerKey).toBe('a3');
    expect(unmatchedNumbers).toEqual([]);
    expect(unresolvedNumbers).toEqual([]);
  });
});
