export const FPS = 30;

export type FormatId = 'landscape' | 'portrait' | 'square';

export type Format = {
  id: FormatId;
  width: number;
  height: number;
  /** Portrait/square stack the footage above the caption instead of overlaying it. */
  stacked: boolean;
  /** Base font size multiplier — small screens need bigger type. */
  typeScale: number;
};

export const FORMATS: Record<FormatId, Format> = {
  landscape: { id: 'landscape', width: 1920, height: 1080, stacked: false, typeScale: 1 },
  portrait: { id: 'portrait', width: 1080, height: 1920, stacked: true, typeScale: 1.5 },
  square: { id: 'square', width: 1080, height: 1080, stacked: true, typeScale: 1.3 },
};
