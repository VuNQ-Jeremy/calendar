import React from 'react';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { concatInt16, downsampleTo16k, encodeWavPcm16 } from '@mochi/shared/logic/wav';

/**
 * Microphone capture for the pronounce game (mobile half; the web twin is
 * src/flashcards/recorder.ts). expo-audio's `useAudioRecorder` cannot emit anything Azure
 * accepts on Android (no WAV, no OGG/OPUS in its encoder enums), so this uses
 * `useAudioStream` instead: raw PCM buffers into JS, assembled into a 16 kHz mono WAV by
 * shared/logic/wav.ts — the same code the web recorder runs.
 */

export type PcmClip = {
  /** file:// URI of a finished 16 kHz mono WAV in the cache directory. */
  uri: string;
  durationMs: number;
  /** Delete the clip file (best-effort). Call after a successful upload. */
  dispose: () => void;
};

export type PcmRecorder = {
  /** Resolves false when mic permission is denied — show fc_pron_mic_denied. */
  start(): Promise<boolean>;
  /** Stops the stream and writes the WAV. Only valid after a successful start(). */
  stop(): Promise<PcmClip>;
  /** Tear down without producing a clip (unmount, re-record). Safe to call twice. */
  cancel(): void;
};

export function usePcmRecorder(): PcmRecorder {
  const chunks = React.useRef<Int16Array[]>([]);
  // The ACTUAL rate the hardware delivered — phones often ignore the 16 kHz request and hand
  // back 44.1/48 kHz; downsampleTo16k fixes that at stop() time.
  const actualRate = React.useRef(16000);
  const startedAt = React.useRef(0);

  const { stream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => {
      chunks.current.push(new Int16Array(buffer.data));
      actualRate.current = buffer.sampleRate;
    },
  });

  // Never leave the mic running when the screen goes away.
  React.useEffect(
    () => () => {
      try {
        stream.stop();
      } catch {
        // Already stopped — expected on every clean path.
      }
    },
    [stream],
  );

  return {
    async start() {
      let perm = await getRecordingPermissionsAsync();
      if (!perm.granted) perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return false;
      // allowsRecording routes the iOS session for capture; playsInSilentMode keeps the model
      // pronunciation audible with the mute switch on. Harmless on Android.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      chunks.current = [];
      startedAt.current = Date.now();
      await stream.start();
      return true;
    },

    async stop() {
      stream.stop();
      // Hand the audio session back to playback so expo-speech keeps using the loud speaker.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const pcm = downsampleTo16k(concatInt16(chunks.current), actualRate.current);
      chunks.current = [];
      const wav = encodeWavPcm16(pcm);
      const f = new File(Paths.cache, `pron-${Date.now()}.wav`);
      f.write(new Uint8Array(wav));
      return {
        uri: f.uri,
        durationMs: Date.now() - startedAt.current,
        dispose: () => {
          try {
            f.delete();
          } catch {
            // Cache files are reclaimed by the OS anyway.
          }
        },
      };
    },

    cancel() {
      try {
        stream.stop();
      } catch {
        // Already stopped.
      }
      chunks.current = [];
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    },
  };
}
