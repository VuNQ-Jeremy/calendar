/**
 * Microphone capture for the pronounce game (web half; the mobile twin is
 * mobile/lib/use-pcm-recorder.ts). MediaRecorder is useless here — it emits webm/opus or
 * mp4/aac and Azure's short-audio endpoint takes only 16 kHz mono PCM WAV (or OGG/opus,
 * which no browser emits) — so this captures raw PCM through Web Audio and assembles the
 * WAV itself via shared/logic/wav.ts.
 */

import { concatInt16, downsampleTo16k, encodeWavPcm16, floatTo16 } from '../../shared/logic/wav';

export type WebRecorder = {
  /** Resolves once the mic is live. Rejects with a DOMException on permission denial. */
  start(): Promise<void>;
  /** Stops mic + audio context and returns the finished 16 kHz mono WAV. */
  stop(): Promise<{ blob: Blob; durationMs: number }>;
  /** Tear down without producing a clip (unmount, re-record). Safe to call twice. */
  cancel(): void;
};

export function createRecorder(): WebRecorder {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let startedAt = 0;
  const chunks: Int16Array[] = [];

  const teardown = () => {
    processor?.disconnect();
    processor = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void ctx?.close().catch(() => {});
    ctx = null;
  };

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      // Ask the browser to run the graph at 16 kHz so it does the resampling; some engines
      // ignore or reject the hint, so ctx.sampleRate (not the request) is what stop() trusts.
      try {
        ctx = new AudioContext({ sampleRate: 16000 });
      } catch {
        ctx = new AudioContext();
      }
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor over AudioWorklet on purpose: deprecated but universal, and it spares
      // us shipping a separate worklet module file through the bundler for a 5-second clip.
      processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        chunks.push(floatTo16(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      // Chrome only runs a ScriptProcessor that is connected to the destination; the node
      // produces silence, so nothing is audible.
      processor.connect(ctx.destination);
      startedAt = Date.now();
    },

    async stop() {
      const rate = ctx?.sampleRate ?? 16000;
      teardown();
      const pcm = downsampleTo16k(concatInt16(chunks), rate);
      chunks.length = 0;
      return {
        blob: new Blob([encodeWavPcm16(pcm)], { type: 'audio/wav' }),
        durationMs: Date.now() - startedAt,
      };
    },

    cancel() {
      teardown();
      chunks.length = 0;
    },
  };
}
