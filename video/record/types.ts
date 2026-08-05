import type { Recorder } from './recorder';

export type Walkthrough = {
  /** Also the recording directory name under `public/recordings/`. */
  id: string;
  /**
   * Event title the walkthrough creates, if any. `run.ts` deletes every event with
   * this title through the JSON API once the browser is closed, so guides can be
   * recorded repeatedly against the live app without piling up demo rows.
   */
  marker?: string;
  run: (rec: Recorder) => Promise<void>;
};
