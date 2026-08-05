/**
 * The contract between the recorder and the compositions.
 *
 * The recorder owns *timing and geometry*; the catalog owns *words*. Keeping
 * them apart means re-recording footage never rewrites captions, and rewording a
 * caption never invalidates a recording.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

export type ManifestStep = {
  id: string;
  /** Milliseconds from the sync flash to the start of this step's actions. */
  tStartMs: number;
  tEndMs: number;
  /** What to zoom at, in viewport CSS pixels. Absent = stay wide. */
  target?: Rect;
  /** Where the script clicked, for the cursor pulse. */
  click?: Point;
};

export type Manifest = {
  id: string;
  recordedAt: string;
  baseUrl: string;
  /**
   * The coordinate space every `Rect` and `Point` above lives in. The page is not
   * zoomed and the video is encoded at the viewport size, so this doubles as the
   * frame size compositions normalise against.
   */
  viewport: { width: number; height: number };
  /** Encoded dimensions of the .webm. Equal to `viewport`; see record/recorder.ts. */
  pixelSize: { width: number; height: number };
  /**
   * First frame (at {@link FPS}) on which the orange sync flash is visible. This is
   * step time zero. `null` until `npm run sync` has read the pixels.
   */
  syncFlashFrame: number | null;
  /** First frame after the flash has cleared — where usable footage begins. */
  footageStartFrame: number | null;
  durationMs: number;
  steps: ManifestStep[];
};

/**
 * Frames to skip inside the recording before the footage is worth showing.
 * The flash itself lives between `syncFlashFrame` and this point.
 */
export function trimBefore(m: Manifest): number {
  return m.footageStartFrame ?? 0;
}

/** Frames between step time zero and the first frame the composition shows. */
export function syncLead(m: Manifest): number {
  if (m.syncFlashFrame == null || m.footageStartFrame == null) return 0;
  return m.footageStartFrame - m.syncFlashFrame;
}
