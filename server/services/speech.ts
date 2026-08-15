/**
 * Azure Speech pronunciation assessment — the pure halves of /speech-assess
 * (app/routes/speech-assess.tsx): building the request header and mapping Azure's response.
 * Kept free of fetch/env so unit tests can pin the header encoding and the score mapping
 * without a Worker.
 */

import { PRONOUNCE_PASS } from '../../shared/logic/flashcards';
import type { PronounceAssessment, PronouncePhoneme, PronounceWord } from '../../shared/schemas';

/**
 * Word/syllable/phoneme entries come in TWO shapes: the short-audio REST endpoint returns the
 * scores FLAT on each entry (`AccuracyScore`, `ErrorType` — see the rest-speech-to-text-short
 * sample), while the SDK-style shape nests them under `PronunciationAssessment`. The mapping
 * reads the nested key first and falls back to the flat one, so either variant scores.
 */
type AzureSyllable = {
  Syllable?: string;
  AccuracyScore?: number;
  PronunciationAssessment?: { AccuracyScore?: number };
  /** 100-ns ticks into the clip; used only to nest phonemes into their syllable. */
  Offset?: number;
  Duration?: number;
};

type AzurePhoneme = {
  Phoneme?: string;
  AccuracyScore?: number;
  PronunciationAssessment?: { AccuracyScore?: number };
  Offset?: number;
};

/** The slice of Azure's short-audio `format=detailed` response the mapping reads. */
export type AzureShortAudio = {
  RecognitionStatus: string;
  NBest?: {
    Lexical?: string;
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
    PronScore?: number;
    /** Present because the config asks for Granularity: 'Phoneme'. */
    Words?: {
      Word?: string;
      AccuracyScore?: number;
      ErrorType?: string;
      PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
      /** Syllable groups — Azure sends them for en-US alongside the phonemes. */
      Syllables?: AzureSyllable[];
      Phonemes?: AzurePhoneme[];
    }[];
  }[];
};

/**
 * Cap on words carried back to the client. The reference is one word and a clip is ≤5s, but
 * EnableMiscue turns anything else the student said into extra Insertion entries.
 */
const MAX_ASSESSED_WORDS = 12;

/**
 * The `Pronunciation-Assessment` header: base64 of UTF-8 JSON. The TextEncoder round-trip
 * matters — `btoa` alone throws on any non-latin1 character in the reference word.
 *
 * `PhonemeAlphabet: 'IPA'` makes Azure label each phoneme with the IPA symbol the game already
 * shows above the mic, rather than its SAPI names — the breakdown is only useful if the two match.
 */
export function pronunciationAssessmentHeader(referenceText: string): string {
  const json = JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    PhonemeAlphabet: 'IPA',
    Dimension: 'Comprehensive',
    EnableMiscue: 'True',
  });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

/**
 * Map Azure's response to the client DTO. With pronunciation assessment on, the scores sit
 * FLAT on the NBest entry (not under a nested key). Silence and noise come back as
 * RecognitionStatus values like NoMatch / InitialSilenceTimeout — those become `noSpeech`
 * so the game offers a re-record instead of grading an empty clip.
 */
export function mapAzureAssessment(json: AzureShortAudio): PronounceAssessment {
  const best = json.RecognitionStatus === 'Success' ? json.NBest?.[0] : undefined;
  if (!best) {
    return {
      accuracy: 0,
      fluency: 0,
      completeness: 0,
      pronScore: 0,
      recognized: '',
      correct: false,
      noSpeech: true,
      words: [],
    };
  }
  const accuracy = best.AccuracyScore ?? 0;
  return {
    accuracy,
    fluency: best.FluencyScore ?? 0,
    completeness: best.CompletenessScore ?? 0,
    pronScore: best.PronScore ?? 0,
    recognized: best.Lexical ?? '',
    correct: accuracy >= PRONOUNCE_PASS,
    noSpeech: false,
    words: (best.Words ?? []).slice(0, MAX_ASSESSED_WORDS).map((w) => {
      const nested = nestPhonemes(w.Syllables ?? [], w.Phonemes ?? []);
      return {
        word: w.Word ?? '',
        errorType: (w.PronunciationAssessment?.ErrorType ??
          w.ErrorType ??
          'None') as PronounceWord['errorType'],
        accuracy: w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore ?? 0,
        phonemes: (w.Phonemes ?? []).map(mapPhoneme),
        syllables: (w.Syllables ?? []).map((s, i) => ({
          ipa: s.Syllable ?? '',
          accuracy: s.PronunciationAssessment?.AccuracyScore ?? s.AccuracyScore ?? 0,
          phonemes: nested[i] ?? [],
        })),
      };
    }),
  };
}

/**
 * Attach each phoneme to its syllable, one group per syllable. Preferred signal: the syllable
 * whose audio window contains the phoneme's start tick — both come from the same alignment, so
 * containment is exact. When the response carries no usable offsets, fall back to consuming
 * phonemes left-to-right until their concatenated IPA is as long as the syllable's string (the
 * syllable IS its phonemes' symbols joined, in en-US IPA). A syllable that still ends up empty
 * is rendered by clients as its own IPA string, so nothing disappears.
 */
function nestPhonemes(syllables: AzureSyllable[], phonemes: AzurePhoneme[]): PronouncePhoneme[][] {
  const byOffset = syllables.map((s) =>
    phonemes.filter(
      (p) =>
        p.Offset != null &&
        s.Offset != null &&
        s.Duration != null &&
        p.Offset >= s.Offset &&
        p.Offset < s.Offset + s.Duration,
    ),
  );
  if (byOffset.some((group) => group.length > 0)) {
    return byOffset.map((group) => group.map(mapPhoneme));
  }
  let next = 0;
  return syllables.map((s) => {
    const target = (s.Syllable ?? '').length;
    const group: AzurePhoneme[] = [];
    let taken = 0;
    while (next < phonemes.length && taken < target) {
      taken += (phonemes[next].Phoneme ?? '').length;
      group.push(phonemes[next++]);
    }
    return group.map(mapPhoneme);
  });
}

function mapPhoneme(p: AzurePhoneme): PronouncePhoneme {
  return {
    ipa: p.Phoneme ?? '',
    accuracy: p.PronunciationAssessment?.AccuracyScore ?? p.AccuracyScore ?? 0,
  };
}
