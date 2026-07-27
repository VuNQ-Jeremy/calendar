import { useEffect, useMemo, useRef } from 'react';
import { WordAudio } from './audio';

/**
 * A `WordAudio` bound to the component's lifetime.
 *
 * The `release()` in the cleanup is the whole point: without it every screen that plays a word
 * leaks a native audio player, and after a couple of hundred cards playback stops working with
 * no error message.
 */
export function useWordAudio(): (word: string, audioUrl?: string | null) => void {
  const ref = useRef<WordAudio | null>(null);
  const audio = useMemo(() => {
    ref.current = new WordAudio();
    return ref.current;
  }, []);

  useEffect(() => () => audio.release(), [audio]);

  return (word, audioUrl) => {
    void audio.play(word, audioUrl);
  };
}
