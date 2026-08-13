import { describe, it, expect } from 'vitest';
import { mapAzureAssessment, pronunciationAssessmentHeader } from '../server/services/speech.js';

describe('pronunciationAssessmentHeader', () => {
  it('base64-decodes to the exact assessment config', () => {
    const decoded = JSON.parse(
      Buffer.from(pronunciationAssessmentHeader('hello'), 'base64').toString('utf8'),
    );
    expect(decoded).toEqual({
      ReferenceText: 'hello',
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      PhonemeAlphabet: 'IPA',
      Dimension: 'Comprehensive',
      EnableMiscue: 'True',
    });
  });

  it('survives non-latin1 reference text (btoa alone would throw)', () => {
    const decoded = JSON.parse(
      Buffer.from(pronunciationAssessmentHeader('café ngõ'), 'base64').toString('utf8'),
    );
    expect(decoded.ReferenceText).toBe('café ngõ');
  });
});

describe('mapAzureAssessment', () => {
  it('reads the flat NBest scores and applies the pass threshold', () => {
    const out = mapAzureAssessment({
      RecognitionStatus: 'Success',
      NBest: [
        {
          Lexical: 'hello',
          AccuracyScore: 85.5,
          FluencyScore: 90,
          CompletenessScore: 100,
          PronScore: 88,
          Words: [
            {
              Word: 'hello',
              PronunciationAssessment: { AccuracyScore: 85.5, ErrorType: 'None' },
              Phonemes: [
                { Phoneme: 'h', PronunciationAssessment: { AccuracyScore: 95 } },
                { Phoneme: 'ə', PronunciationAssessment: { AccuracyScore: 40 } },
              ],
            },
          ],
        },
      ],
    });
    expect(out).toEqual({
      accuracy: 85.5,
      fluency: 90,
      completeness: 100,
      pronScore: 88,
      recognized: 'hello',
      correct: true,
      noSpeech: false,
      words: [
        {
          word: 'hello',
          errorType: 'None',
          accuracy: 85.5,
          phonemes: [
            { ipa: 'h', accuracy: 95 },
            { ipa: 'ə', accuracy: 40 },
          ],
        },
      ],
    });
  });

  it('fails a score under 70 without flagging noSpeech', () => {
    const out = mapAzureAssessment({
      RecognitionStatus: 'Success',
      NBest: [{ Lexical: 'hallo', AccuracyScore: 42 }],
    });
    expect(out.correct).toBe(false);
    expect(out.noSpeech).toBe(false);
    expect(out.accuracy).toBe(42);
    expect(out.words).toEqual([]); // no Words in the payload — never undefined
  });

  it('keeps miscue words and defaults every missing score to 0', () => {
    const out = mapAzureAssessment({
      RecognitionStatus: 'Success',
      NBest: [
        {
          Lexical: 'a whisker',
          AccuracyScore: 60,
          Words: [
            { Word: 'a', PronunciationAssessment: { ErrorType: 'Insertion' } },
            {
              Word: 'whisker',
              PronunciationAssessment: { AccuracyScore: 60, ErrorType: 'Mispronunciation' },
              Phonemes: [{ Phoneme: 'w' }],
            },
          ],
        },
      ],
    });
    expect(out.words).toEqual([
      { word: 'a', errorType: 'Insertion', accuracy: 0, phonemes: [] },
      {
        word: 'whisker',
        errorType: 'Mispronunciation',
        accuracy: 60,
        phonemes: [{ ipa: 'w', accuracy: 0 }],
      },
    ]);
  });

  it('treats silence statuses and missing NBest as noSpeech, never a throw', () => {
    for (const payload of [
      { RecognitionStatus: 'NoMatch' },
      { RecognitionStatus: 'InitialSilenceTimeout' },
      { RecognitionStatus: 'Success' }, // Success but no NBest at all
      { RecognitionStatus: 'Success', NBest: [] },
    ]) {
      const out = mapAzureAssessment(payload);
      expect(out.noSpeech).toBe(true);
      expect(out.correct).toBe(false);
      expect(out.accuracy).toBe(0);
      expect(out.words).toEqual([]);
    }
  });
});
