import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PracticeExcuseRequestInput } from '@mochi/shared/schemas';
import * as api from './endpoints';
import { qk } from './query';

/**
 * Practice data hooks.
 *
 * `staleTime: 0` + `refetchOnMount: 'always'` is deliberate and differs from every other query in
 * this app: the response is computed against the SERVER's ICT day, and the whole feature turns on
 * that boundary. A cached list restored from disk after midnight would show yesterday's tasks as
 * still submittable, which is exactly the lie the student would act on.
 */
export function usePracticeMy(enabled = true) {
  return useQuery({
    queryKey: qk.practice,
    queryFn: api.practice.my,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled,
  });
}

export function useSubmitPractice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { form: FormData; onProgress?: (pct: number) => void }) =>
      api.practice.submit(args.form, args.onProgress),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.practice }),
  });
}

export function useRequestExcuse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeExcuseRequestInput) => api.practice.requestExcuse(input),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.practice }),
  });
}
