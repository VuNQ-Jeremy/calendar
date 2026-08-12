import * as Speech from 'expo-speech';

/**
 * Pronunciation playback — the port of `src/flashcards/audio.ts`.
 *
 * Speech synthesis only, matching the web. Cards used to carry a recorded `audioUrl` from
 * dictionaryapi.dev, downloaded and cached on disk here, and preferred over synthesis. That lookup
 * is gone — AI now fills every card field and it cannot record audio — so the player, the audio
 * mode and the file cache all went with it. Synthesis needs no network, so offline study still has
 * audio for every word, including ones no dictionary knows.
 */

function speak(text: string, rate = 0.9): void {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'en-US', rate });
  } catch {
    /* no speech engine — nothing more we can do */
  }
}

/**
 * Kept as a class, and kept behind `useWordAudio()`, so playback still stops when the screen that
 * started it goes away: a card read aloud as the user swipes to the next one is worse than silence.
 */
export class WordAudio {
  private disposed = false;

  /** `rate` defaults to 0.9 (the word-reading pace); the listen game's slow replay passes lower. */
  play(text: string, rate?: number): void {
    if (this.disposed) return;
    speak(text, rate);
  }

  stop(): void {
    Speech.stop();
  }

  /** Idempotent. After this the instance ignores further play() calls. */
  release(): void {
    this.disposed = true;
    this.stop();
  }
}
