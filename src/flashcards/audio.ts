/**
 * Play a word's pronunciation. Prefers the dictionary-provided audio URL and
 * falls back to the browser's speech synthesis (robotic but always available)
 * when there is no URL or the audio fails to play (dead link / autoplay block).
 */
export function playWord(word: string, audioUrl?: string | null): void {
  if (typeof window === 'undefined') return;
  const tts = () => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch {
      /* no speech support */
    }
  };
  if (audioUrl) {
    try {
      const a = new Audio(audioUrl);
      a.play().catch(tts);
    } catch {
      tts();
    }
  } else {
    tts();
  }
}
