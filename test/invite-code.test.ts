import { describe, it, expect, vi } from 'vitest';
import { makeInviteCode, normalizeInviteCode } from '../shared/logic/invite-code';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

describe('makeInviteCode', () => {
  it('produces the XXX-XXX contract shape', () => {
    for (let i = 0; i < 50; i++) {
      expect(makeInviteCode()).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    }
  });

  it('only uses the unambiguous alphabet (no I, O, 0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      for (const ch of makeInviteCode().replace('-', '')) {
        expect(CHARS).toContain(ch);
      }
    }
  });

  it('does not use Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    makeInviteCode();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('draws from crypto.getRandomValues', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    makeInviteCode();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('maps every byte value into the alphabet without bias', () => {
    // 256 % 32 === 0, so each of the 32 chars must claim exactly 8 byte values.
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
      const b = buf as Uint8Array;
      for (let i = 0; i < b.length; i++) b[i] = 255;
      return buf;
    });
    expect(makeInviteCode()).toBe(`${CHARS[31].repeat(3)}-${CHARS[31].repeat(3)}`);
    spy.mockRestore();
  });

  it('round-trips through normalizeInviteCode', () => {
    const code = makeInviteCode();
    expect(normalizeInviteCode(code.toLowerCase())).toBe(code);
  });
});
