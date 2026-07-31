import { describe, it, expect } from 'vitest';
import {
  FormBool,
  InviteInput,
  HomeworkInput,
  MaterialInput,
  AssessmentTypeInput,
  NotifPrefsInput,
  QuestionInput,
  QuestionInputBase,
  parsePatch,
} from '../shared/schemas';

describe('FormBool', () => {
  it("reads 'false' as false, not as a truthy string", () => {
    expect(FormBool.parse('false')).toBe(false);
  });

  it('reads the other wire spellings of false', () => {
    for (const v of ['0', 'off', 'no', '', 'False', ' FALSE ']) {
      expect(FormBool.parse(v)).toBe(false);
    }
  });

  it("reads 'true' and checkbox 'on' as true", () => {
    for (const v of ['true', 'on', 'yes', '1', 'True']) {
      expect(FormBool.parse(v)).toBe(true);
    }
  });

  it('passes real booleans through — the JSON API sends those', () => {
    expect(FormBool.parse(true)).toBe(true);
    expect(FormBool.parse(false)).toBe(false);
  });

  it('rejects values that are neither a boolean nor a string', () => {
    expect(FormBool.safeParse({}).success).toBe(false);
    expect(FormBool.safeParse(null).success).toBe(false);
  });
});

describe('InviteInput', () => {
  // A freshly generated invite posts used='false'. Coercing that to `true` made
  // the code arrive already spent: struck through in the list, and rejected by
  // redemption because it filters on !used.
  it('keeps a newly generated invite unused', () => {
    const parsed = InviteInput.parse({
      code: 'ABC-123',
      role: 'Student',
      createdAt: '2026-07-28',
      used: 'false',
    });
    expect(parsed.used).toBe(false);
  });

  it('still honours used=true', () => {
    expect(InviteInput.parse({ code: 'ABC-123', role: 'Staff', used: 'true' }).used).toBe(true);
  });

  it('defaults to unused when the field is absent', () => {
    expect(InviteInput.parse({ code: 'ABC-123', role: 'Parent' }).used).toBe(false);
  });
});

describe('form toggles can be switched off', () => {
  it('un-checks homework done', () => {
    expect(HomeworkInput.parse({ title: 'Essay', done: 'false' }).done).toBe(false);
    expect(parsePatch(HomeworkInput, { done: 'false' }).data).toEqual({ done: false });
  });

  it('un-favorites a material', () => {
    expect(MaterialInput.parse({ title: 'Notes', favorite: 'false' }).favorite).toBe(false);
    expect(parsePatch(MaterialInput, { favorite: 'false' }).data).toEqual({ favorite: false });
  });

  it('deactivates an assessment type', () => {
    expect(AssessmentTypeInput.parse({ name: 'Quiz', active: 'false' }).active).toBe(false);
  });

  it('turns notification prefs off', () => {
    const parsed = NotifPrefsInput.parse({
      classReminders: 'false',
      homeworkReminders: 'false',
      studyNudges: 'false',
    });
    expect(parsed).toMatchObject({
      classReminders: false,
      homeworkReminders: false,
      studyNudges: false,
    });
  });
});

describe('QuestionInput', () => {
  const opts = [
    { id: 'a', text: 'Hà Nội' },
    { id: 'b', text: 'Huế' },
  ];

  it('accepts one question of each type', () => {
    expect(
      QuestionInput.safeParse({ type: 'mcq', prompt: 'Capital?', options: opts, answerKey: 'a' })
        .success,
    ).toBe(true);
    expect(
      QuestionInput.safeParse({
        type: 'multi',
        prompt: 'Which are cities?',
        options: opts,
        answerKey: ['a', 'b'],
      }).success,
    ).toBe(true);
    expect(
      QuestionInput.safeParse({ type: 'text', prompt: 'Capital?', answerKey: ['Hà Nội', 'Ha Noi'] })
        .success,
    ).toBe(true);
    expect(QuestionInput.safeParse({ type: 'essay', prompt: 'Discuss the river.' }).success).toBe(
      true,
    );
  });

  it('rejects an mcq answer key that is not one of the options', () => {
    const r = QuestionInput.safeParse({
      type: 'mcq',
      prompt: 'Capital?',
      options: opts,
      answerKey: 'z',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['answerKey']);
  });

  it('rejects an mcq with a single option', () => {
    const r = QuestionInput.safeParse({
      type: 'mcq',
      prompt: 'Capital?',
      options: [opts[0]],
      answerKey: 'a',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['options']);
  });

  it('rejects a multi with no correct answers', () => {
    expect(
      QuestionInput.safeParse({ type: 'multi', prompt: 'Pick', options: opts, answerKey: [] })
        .success,
    ).toBe(false);
  });

  it('rejects a multi key that is not an option', () => {
    expect(
      QuestionInput.safeParse({
        type: 'multi',
        prompt: 'Pick',
        options: opts,
        answerKey: ['a', 'z'],
      }).success,
    ).toBe(false);
  });

  it('rejects a text question carrying options', () => {
    const r = QuestionInput.safeParse({
      type: 'text',
      prompt: 'Capital?',
      options: opts,
      answerKey: ['Hà Nội'],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === 'options')).toBe(true);
  });

  it('rejects a text question with no accepted answers', () => {
    expect(
      QuestionInput.safeParse({ type: 'text', prompt: 'Capital?', answerKey: [] }).success,
    ).toBe(false);
  });

  it('rejects an essay with an answer key or options', () => {
    expect(
      QuestionInput.safeParse({ type: 'essay', prompt: 'Discuss', answerKey: 'anything' }).success,
    ).toBe(false);
    expect(
      QuestionInput.safeParse({ type: 'essay', prompt: 'Discuss', options: opts }).success,
    ).toBe(false);
  });

  // Patches parse the unrefined base: a prompt-only edit carries no type, so the per-type
  // answer-key rules cannot be evaluated. See the comment on QuestionInputBase.
  it('patches a prompt on its own', () => {
    expect(parsePatch(QuestionInputBase, { prompt: 'Capital of Vietnam?' }).data).toEqual({
      prompt: 'Capital of Vietnam?',
    });
  });
});
