import { describe, it, expect } from 'vitest';
import {
  FormBool,
  InviteInput,
  HomeworkInput,
  MaterialInput,
  AssessmentTypeInput,
  NotifPrefsInput,
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
