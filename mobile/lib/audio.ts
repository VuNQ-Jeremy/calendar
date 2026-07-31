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

function speak(word: string): void {
  try {
    Speech.stop();
    Speech.speak(word, { language: 'en-US', rate: 0.9 });
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

  play(word: string): void {
    if (this.disposed) return;
    speak(word);
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
