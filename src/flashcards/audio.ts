/**
 * Speak a word with the browser's speech synthesis.
 *
 * Cards used to carry a recorded `audioUrl` from dictionaryapi.dev, played in preference to this.
 * That lookup is gone (AI now fills every card field, and it cannot record audio), so synthesis is
 * the only path — robotic, but available for every word including ones no dictionary knows.
 */
export function playWord(word: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    /* no speech support */
  }
}
