import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

/**
 * Pronunciation playback — the port of `src/flashcards/audio.ts`.
 *
 * Same two-tier behavior as the web: play the dictionary's `audioUrl` if there is one, and fall
 * back to speech synthesis (robotic, but always available and needs no network).
 *
 * `expo-audio`, not the `expo-av` the plan named — expo-av is removed from this SDK. The API is
 * `createAudioPlayer` rather than `Audio.Sound.createAsync`, and the same discipline applies:
 * **release every player.** Native audio players are a limited resource, and a 200-word session
 * that leaks one per card will exhaust them and go silent.
 */

let audioModeReady: Promise<void> | null = null;

/**
 * Configure once, lazily.
 *
 * `playsInSilentMode` matters more than it looks: phones live on silent, and a vocabulary app
 * that refuses to pronounce a word because the ringer switch is off looks broken.
 * `shouldRouteThroughEarpiece: false` keeps it on the speaker.
 */
function ensureAudioMode(): Promise<void> {
  if (!audioModeReady) {
    audioModeReady = setAudioModeAsync({
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: 'duckOthers',
    }).catch(() => {
      // A device that rejects the audio mode can still speak; don't let this break playback.
      audioModeReady = null;
    });
  }
  return audioModeReady;
}

function speak(word: string): void {
  try {
    Speech.stop();
    Speech.speak(word, { language: 'en-US', rate: 0.9 });
  } catch {
    /* no speech engine — nothing more we can do */
  }
}

/**
 * Where cached pronunciation files live. `Paths.cache` is storage the OS may reclaim when the
 * device runs low — correct for this: losing a cached mp3 costs one re-download, and
 * `expo-speech` covers the gap in the meantime.
 */
function cacheDir(): Directory {
  return new Directory(Paths.cache, 'word-audio');
}

async function cachedFile(url: string): Promise<File> {
  // The URL is hashed rather than sanitised: dictionaryapi.dev URLs contain characters that are
  // illegal in filenames, and a hash is stable across runs so the cache actually hits.
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, url);
  return new File(cacheDir(), `${hash}.mp3`);
}

/**
 * Downloads an audio file into the cache and returns its local URI, or null.
 *
 * This is what keeps pronunciation working offline: once a word has been played online, its file
 * is on disk. A word never played online still falls back to `expo-speech`, which needs no
 * network at all — so offline study always has audio of some kind.
 *
 * Uses the SDK 54+ `File`/`Directory` API, not the removed `FileSystem.downloadAsync`.
 */
async function ensureCached(url: string): Promise<string | null> {
  try {
    const target = await cachedFile(url);
    if (target.exists) return target.uri;

    const dir = cacheDir();
    if (!dir.exists) dir.create({ intermediates: true });

    // Rejects on a non-2xx and leaves no file behind, so a dead link cannot poison the cache
    // with a 404 body masquerading as audio.
    const downloaded = await File.downloadFileAsync(url, target, { idempotent: true });
    return downloaded.uri;
  } catch {
    return null;
  }
}

/**
 * Owns the single active player, so playing a new word stops the previous one and releases it.
 * Screens must call `release()` on unmount — `useWordAudio()` does it for you.
 */
export class WordAudio {
  private player: AudioPlayer | null = null;
  private disposed = false;

  async play(word: string, audioUrl?: string | null): Promise<void> {
    this.stop();
    if (this.disposed) return;

    if (!audioUrl) {
      speak(word);
      return;
    }

    await ensureAudioMode();
    if (this.disposed) return;

    // Prefer the on-disk copy; fall back to streaming the URL when the cache write failed.
    const source = (await ensureCached(audioUrl)) ?? audioUrl;
    if (this.disposed) return;

    try {
      const player = createAudioPlayer({ uri: source });
      this.player = player;
      player.play();
    } catch {
      // Dead link, unsupported codec, no decoder — the web version falls back to TTS here too.
      speak(word);
    }
  }

  stop(): void {
    Speech.stop();
    const player = this.player;
    this.player = null;
    if (player) {
      try {
        player.remove();
      } catch {
        /* already released */
      }
    }
  }

  /** Idempotent. After this the instance ignores further play() calls. */
  release(): void {
    this.disposed = true;
    this.stop();
  }
}
