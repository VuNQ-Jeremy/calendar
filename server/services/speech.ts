/**
 * Azure Speech pronunciation assessment — the pure halves of /speech-assess
 * (app/routes/speech-assess.tsx): building the request header and mapping Azure's response.
 * Kept free of fetch/env so unit tests can pin the header encoding and the score mapping
 * without a Worker.
 */

import { PRONOUNCE_PASS } from '../../shared/logic/flashcards';
import type { PronounceAssessment, PronounceWord } from '../../shared/schemas';

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
      PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
      Phonemes?: { Phoneme?: string; PronunciationAssessment?: { AccuracyScore?: number } }[];
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
    words: (best.Words ?? []).slice(0, MAX_ASSESSED_WORDS).map((w) => ({
      word: w.Word ?? '',
      errorType: (w.PronunciationAssessment?.ErrorType ?? 'None') as PronounceWord['errorType'],
      accuracy: w.PronunciationAssessment?.AccuracyScore ?? 0,
      phonemes: (w.Phonemes ?? []).map((p) => ({
        ipa: p.Phoneme ?? '',
        accuracy: p.PronunciationAssessment?.AccuracyScore ?? 0,
      })),
    })),
  };
}
