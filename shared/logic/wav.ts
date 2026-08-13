/**
 * PCM → WAV assembly for the pronounce game, shared by the web recorder
 * (src/flashcards/recorder.ts) and the mobile one (mobile/lib/use-pcm-recorder.ts). Azure's
 * short-audio endpoint accepts exactly one PCM shape — 16 kHz mono 16-bit little-endian WAV —
 * and neither platform's recorder emits it natively, so both capture raw PCM and meet here.
 * No React, no DOM, no React Native.
 */

/** Longest clip either recorder will capture. One word never needs more. */
export const MAX_CLIP_MS = 5000;

/** Convert Float32 samples in [-1, 1] (Web Audio's native format) to Int16. */
export function floatTo16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Concatenate recorder buffer chunks into one contiguous array. */
export function concatInt16(chunks: readonly Int16Array[]): Int16Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Int16Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Downsample int16 mono PCM to 16 kHz by averaging each source window — crude next to a real
 * low-pass filter, but the averaging suppresses enough aliasing for speech, and it keeps this
 * dependency-free. Identity when the input is already 16 kHz. Upsampling would fabricate
 * samples Azure then scores, so rates below 16 kHz are refused instead.
 */
export function downsampleTo16k(samples: Int16Array, inputRate: number): Int16Array {
  if (inputRate === 16000) return samples;
  if (inputRate < 16000) throw new Error(`cannot upsample ${inputRate}Hz to 16kHz`);
  const ratio = inputRate / 16000;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = end > start ? Math.round(sum / (end - start)) : 0;
  }
  return out;
}

/** Wrap int16 mono PCM in the 44-byte RIFF/WAVE header. Little-endian throughout. */
export function encodeWavPcm16(samples: Int16Array, sampleRate = 16000): ArrayBuffer {
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate = rate * blockAlign
  v.setUint16(32, 2, true); // block align = channels * bytesPerSample
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataLen, true);
  new Int16Array(buf, 44).set(samples);
  return buf;
}
