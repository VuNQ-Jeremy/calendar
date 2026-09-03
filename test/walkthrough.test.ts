import { describe, it, expect } from 'vitest';
import { JOURNEYS, STORIES, WT_PREFIX } from '../shared/walkthrough';

/**
 * shared/walkthrough.ts is data, not logic, so what is worth testing is the invariants the tour
 * driver and the checklist screen are allowed to ASSUME — each of which, broken, produces a story
 * that silently cannot be completed rather than an error anybody would see.
 */
describe('walkthrough story data', () => {
  it('story ids are unique and journeys resolve', () => {
    const ids = STORIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const jids = new Set(JOURNEYS.map((j) => j.id));
    for (const s of STORIES) expect(jids.has(s.journey)).toBe(true);
  });

  // The checklist's Run button opens `story.route`; the driver then auto-ticks the first step when
  // it reports ready on `steps[0].route`. If the two ever disagree, Run lands the user on one
  // screen while the tour waits for another, and the story stalls on step one with no message.
  it('every story starts by going to its own route', () => {
    for (const s of STORIES) {
      expect(s.steps.length).toBeGreaterThan(0);
      const first = s.steps[0];
      expect(first.kind).toBe('goto');
      if (first.kind === 'goto') expect(first.route).toBe(s.route);
    }
  });

  /**
   * A story the driver TYPES into must put the rows it created back.
   *
   * The rule is keyed on `fill`, not on `tag === 'write'`, because four of the student stories are
   * writes with nothing to undo: reviewing a deck, playing a face-off, growing the garden and
   * sitting a test all record real progress for the designated test student, and the product
   * offers no delete affordance for any of it. Demanding a cleanup step there would only produce
   * a step that lies.
   */
  it('stories that pre-fill a form end with a cleanup step, and every filled value is prefixed', () => {
    for (const s of STORIES) {
      if (s.steps.some((st) => st.kind === 'fill')) {
        expect(/cleanup/i.test(s.steps[s.steps.length - 1].text), s.id).toBe(true);
      }
      for (const st of s.steps)
        if (st.kind === 'fill')
          for (const f of st.fields) expect(f.value.startsWith(WT_PREFIX), s.id).toBe(true);
    }
  });

  // `caution` means the screen writes real production data — attendance, grades, money. Those
  // stories are read-and-warn only: the driver must never be handed something to press there.
  it('caution stories never carry a mutating driver step', () => {
    for (const s of STORIES)
      if (s.tag === 'caution')
        expect(
          s.steps.some((st) => st.kind === 'submit' || st.kind === 'fill'),
          s.id,
        ).toBe(false);
  });

  // The whole catalogue, and the journeys it is grouped under. A story that lost its journey, or a
  // journey nothing points at, would render an empty group on the checklist.
  it('covers all 29 stories across all 7 journeys', () => {
    expect(STORIES).toHaveLength(29);
    expect(new Set(JOURNEYS.map((j) => j.id)).size).toBe(JOURNEYS.length);
    for (const j of JOURNEYS) expect(STORIES.some((s) => s.journey === j.id)).toBe(true);
  });

  // The badge on a story card is driven by this list, and a filename that does not exist would
  // render a link to nothing. Cheap shape check — the files themselves live in e2e/.
  it('names spec files, not bare spec names', () => {
    for (const s of STORIES) for (const f of s.specs) expect(f).toMatch(/^[a-z0-9-]+\.spec\.ts$/);
  });

  // Student and parent stories need a different account signed in; the checklist says so only if
  // the data says so. Staff journeys must not quietly contain a story that needs somebody else.
  it('tags each story with the account that can run it', () => {
    const roleOf = new Map(JOURNEYS.map((j) => [j.id, j.role]));
    for (const s of STORIES) {
      const expected = { Staff: 'staff', Student: 'student', Parent: 'parent' }[
        roleOf.get(s.journey)!
      ];
      expect(s.account, s.id).toBe(expected);
    }
  });
});
