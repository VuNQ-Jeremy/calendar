import { useEffect, useMemo, useRef } from 'react';
import { WordAudio } from './audio';

/**
 * A `WordAudio` bound to the component's lifetime.
 *
 * The `release()` in the cleanup is what stops a word being read aloud after the screen that
 * started it has gone — a card still talking over the next one reads as a bug.
 */
export function useWordAudio(): (text: string, rate?: number) => void {
  const ref = useRef<WordAudio | null>(null);
  const audio = useMemo(() => {
    ref.current = new WordAudio();
    return ref.current;
  }, []);

  useEffect(() => () => audio.release(), [audio]);

  return (text, rate) => audio.play(text, rate);
}
