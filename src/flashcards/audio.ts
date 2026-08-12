/**
 * Speak any English text with the browser's speech synthesis. `rate` defaults to 0.9 (the
 * original word-reading pace); the listen game's slow replay passes a lower rate.
 *
 * Cards used to carry a recorded `audioUrl` from dictionaryapi.dev, played in preference to this.
 * That lookup is gone (AI now fills every card field, and it cannot record audio), so synthesis is
 * the only path — robotic, but available for every word including ones no dictionary knows.
 */
export function playSentence(text: string, rate = 0.9): void {
  if (typeof window === 'undefined') return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    window.speechSynthesis.speak(u);
  } catch {
    /* no speech support */
  }
}

/** Speak a single word — the original entry point, now a thin call over `playSentence`. */
export function playWord(word: string): void {
  playSentence(word);
}
