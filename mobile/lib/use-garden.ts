import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ictDateOf } from '@mochi/shared/logic/tests';
import * as api from './endpoints';
import { qk } from './query';
import type { PlantPatchInput } from '@mochi/shared/schemas';

/**
 * The garden's reads and writes.
 *
 * ## The one rule that shapes this file
 *
 * A plant is DERIVED, never stored settled (`shared/logic/garden.ts`, `docs/api.md` "The garden").
 * It wilts after N idle days and drops a stage every M days after that, and those transitions land
 * at ICT midnight for every reader simultaneously — with or without the daily cron. So:
 *
 *   - **Never compute decay here.** `settlePlant` is importable from shared and must not be called.
 *     The endpoint settles on read; the client's job is to render what it is told.
 *   - **Never serve a plant across a day boundary.** The query cache is written through to
 *     AsyncStorage, so a phone opened the next morning would otherwise restore yesterday's healthy
 *     plant from disk and present it as current. The ICT day is part of the key (`qk.gardenPlant`)
 *     precisely so that entry becomes unreachable rather than stale.
 *   - **Never compare against the device clock.** Every rendered date decision — a deadline chip's
 *     urgency, the drop warning — measures against the `today` the response carries. A phone set to
 *     Sydney must not show a deadline a day early.
 *
 * `ictToday()` reads the device clock, and that is fine for one narrow purpose: choosing a cache
 * key. A phone an hour off picks the neighbouring key and fetches; it never renders a wrong date.
 */
function ictToday(): string {
  return ictDateOf(new Date().toISOString());
}

// ---- Reads ----

/**
 * The student's own plant.
 *
 * `staleTime: 0` plus `refetchOnMount: 'always'` on top of the day-scoped key: the plant is the one
 * thing in this app that changes without anyone touching it, and it is cheap (one settled read, no
 * writes). Between them, opening the vocabulary screen always shows the truth.
 */
export function usePlant(enabled = true) {
  return useQuery({
    queryKey: qk.gardenPlant(ictToday()),
    queryFn: api.garden.plant,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled,
  });
}

/** One class's shared garden. Same freshness reasoning as the plant — every member decays too. */
export function useClassGarden(classId: string | undefined) {
  return useQuery({
    queryKey: qk.gardenClass(classId ?? '', ictToday()),
    queryFn: () => api.garden.classGarden(classId as string),
    enabled: !!classId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Which album months exist for a class. */
export function useSnapshots(classId: string | undefined) {
  return useQuery({
    queryKey: qk.gardenSnapshots(classId ?? ''),
    queryFn: () => api.garden.listSnapshots(classId as string),
    enabled: !!classId,
  });
}

/**
 * One frozen month. `staleTime: Infinity` — a snapshot is a photograph; it cannot change, and the
 * album is the one garden read that is safe to keep across a day boundary.
 */
export function useSnapshot(classId: string | undefined, month: string | undefined) {
  return useQuery({
    queryKey: qk.gardenSnapshot(classId ?? '', month ?? ''),
    queryFn: () => api.garden.getSnapshot(classId as string, month as string),
    enabled: !!classId && !!month,
    staleTime: Infinity,
    retry: false, // a month that was never saved is a 404, and retrying it twice is pointless
  });
}

// ---- Writes ----

/**
 * Rename the plant / repaint the pot.
 *
 * The reply is the full refreshed plant, so it goes straight into the cache — the editor closes
 * onto the new name with no round trip. The blanket garden invalidate still runs behind it, because
 * the name also appears on the student's card in the class garden.
 */
export function useUpdatePlant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: PlantPatchInput) => api.garden.updatePlant(patch),
    onSuccess: (row) => {
      qc.setQueryData(qk.gardenPlant(ictToday()), row);
      void qc.invalidateQueries({ queryKey: ['garden'] });
    },
  });
}

/**
 * Bank a fruit and replant a seed.
 *
 * A 409 (`not_ripe` / `dead`) is a normal outcome, not an incident: it is what a double tap looks
 * like. The caller shows the "couldn't harvest" flash and re-reads, because whatever the plant's
 * real state is, the screen no longer knows it.
 */
export function useHarvest() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['garden'] });
  return useMutation({
    mutationFn: api.garden.harvest,
    onSuccess: refresh,
    onError: refresh,
    retry: false,
  });
}
