import { describe, it, expect } from 'vitest';
import { flashcardImagePath } from '../shared/logic/flashcards.js';

/**
 * Words store an R2 object key, and the serving route re-adds the `flashcards/` prefix itself — so
 * this helper's job is to hand over only the filename. Getting that wrong either breaks every
 * picture or, worse, lets a key address another part of the bucket.
 */
describe('flashcardImagePath', () => {
  it('turns a stored key into a serving path', () => {
    expect(flashcardImagePath('flashcards/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg')).toBe(
      '/flashcard-images/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg',
    );
  });

  it('keeps png and webp keys intact', () => {
    expect(flashcardImagePath('flashcards/a.png')).toBe('/flashcard-images/a.png');
    expect(flashcardImagePath('flashcards/a.webp')).toBe('/flashcard-images/a.webp');
  });

  it('returns null for a word with no picture', () => {
    // Every card render path leans on this: no picture must mean "render as before", not a broken
    // <img> with an empty src.
    expect(flashcardImagePath(null)).toBeNull();
    expect(flashcardImagePath(undefined)).toBeNull();
    expect(flashcardImagePath('')).toBeNull();
  });

  it('refuses a key with a nested path rather than emitting a traversable URL', () => {
    // Belt and braces with the route's own regex: a key that is not the shape we mint gets no URL
    // at all, so nothing can reach another prefix of the bucket through this helper.
    expect(flashcardImagePath('flashcards/nested/evil.jpg')).toBeNull();
    expect(flashcardImagePath('flashcards/../zalo/card.png')).toBeNull();
  });
});
