import { describe, it, expect } from 'vitest';
import { backoffDelay, closeOutcome, gameSocketUrl } from '../lib/game-socket';

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

describe('closeOutcome', () => {
  it('reports not_found for a socket refused on the very first attempt', () => {
    // Never opened (a 401/426 refuses before the handshake completes) and no attempt yet made —
    // the best available guess is a mistyped room code, not a generic "connection lost".
    expect(closeOutcome(false, 0)).toEqual({ errorCode: 'not_found' });
  });

  it('follows the 1s/2s/4s backoff once a socket has opened, then gives up as connection_lost', () => {
    expect(closeOutcome(true, 0)).toEqual({ retryInMs: 1000 });
    expect(closeOutcome(true, 1)).toEqual({ retryInMs: 2000 });
    expect(closeOutcome(true, 2)).toEqual({ retryInMs: 4000 });
    expect(closeOutcome(true, 3)).toEqual({ errorCode: 'connection_lost' });
  });
});
