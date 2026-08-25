import { describe, it, expect } from 'vitest';
import { backoffDelay, gameSocketUrl } from '../lib/game-socket';

/**
 * `lib/game-socket.ts` — the mobile PvP battle room client (F33/F34).
 *
 * Only the pure helpers are tested here: URL scheme derivation and the reconnect backoff
 * schedule. The socket wiring itself needs a live WebSocket and is exercised end to end by
 * `test-worker/game-room.test.js` and the manual verification steps in the ship checklist.
 */

describe('gameSocketUrl', () => {
  it('maps http to ws and appends the code', () => {
    expect(gameSocketUrl('http://api.example.com', 'QZ4X')).toBe(
      'ws://api.example.com/game-ws?code=QZ4X',
    );
  });

  it('maps https to wss', () => {
    expect(gameSocketUrl('https://api.example.com', 'QZ4X')).toBe(
      'wss://api.example.com/game-ws?code=QZ4X',
    );
  });

  it('URI-encodes the code', () => {
    expect(gameSocketUrl('https://api.example.com', 'a b')).toBe(
      'wss://api.example.com/game-ws?code=a%20b',
    );
  });
});

describe('backoffDelay', () => {
  it('follows 1s, 2s, 4s for the first three attempts', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(2)).toBe(4000);
  });

  it('gives up after 3 attempts', () => {
    expect(backoffDelay(3)).toBeNull();
  });
});
