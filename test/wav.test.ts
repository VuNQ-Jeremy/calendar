import { describe, it, expect } from 'vitest';
import { concatInt16, downsampleTo16k, encodeWavPcm16, floatTo16 } from '../shared/logic/wav.js';

describe('floatTo16', () => {
  it('scales and clamps Web Audio floats to int16', () => {
    const out = floatTo16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0x7fff);
    expect(out[2]).toBe(-0x8000);
    expect(out[3]).toBe(0x7fff); // clamped
    expect(out[4]).toBe(-0x8000); // clamped
    expect(out[5]).toBe(Math.floor(0.5 * 0x7fff));
  });
});

describe('concatInt16', () => {
  it('joins chunks in order', () => {
    const out = concatInt16([new Int16Array([1, 2]), new Int16Array([]), new Int16Array([3])]);
    expect([...out]).toEqual([1, 2, 3]);
  });
});

describe('downsampleTo16k', () => {
  it('is the identity at 16kHz', () => {
    const pcm = new Int16Array([1, 2, 3]);
    expect(downsampleTo16k(pcm, 16000)).toBe(pcm);
  });

  it('averages 48kHz windows down to a third of the length', () => {
    const pcm = new Int16Array(48000).fill(300);
    const out = downsampleTo16k(pcm, 48000);
    expect(out.length).toBe(16000);
    // A constant signal survives the averaging untouched.
    expect(out[0]).toBe(300);
    expect(out[out.length - 1]).toBe(300);
  });

  it('handles the non-integer 44.1kHz ratio', () => {
    const out = downsampleTo16k(new Int16Array(44100).fill(-500), 44100);
    expect(out.length).toBe(16000);
    expect(out[123]).toBe(-500);
  });

  it('refuses to upsample', () => {
    expect(() => downsampleTo16k(new Int16Array(10), 8000)).toThrow();
  });
});

describe('encodeWavPcm16', () => {
  it('writes a byte-exact 44-byte RIFF header around the samples', () => {
    const samples = new Int16Array([0, 1000, -1000]);
    const buf = encodeWavPcm16(samples);
    const v = new DataView(buf);
    const tag = (off: number, len: number) => String.fromCharCode(...new Uint8Array(buf, off, len));

    expect(buf.byteLength).toBe(44 + 6);
    expect(tag(0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 6);
    expect(tag(8, 4)).toBe('WAVE');
    expect(tag(12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // byte rate
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16); // bits per sample
    expect(tag(36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(6);
    // Samples round-trip little-endian.
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(1000);
    expect(v.getInt16(48, true)).toBe(-1000);
  });
});
