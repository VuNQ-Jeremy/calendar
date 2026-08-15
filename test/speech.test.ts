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
          syllables: [],
        },
      ],
    });
  });

  it('nests each phoneme into the syllable whose audio window contains its start', () => {
    const out = mapAzureAssessment({
      RecognitionStatus: 'Success',
      NBest: [
        {
          Lexical: 'hello',
          AccuracyScore: 91,
          Words: [
            {
              Word: 'hello',
              PronunciationAssessment: { AccuracyScore: 91, ErrorType: 'None' },
              Syllables: [
                {
                  Syllable: 'hɛ',
                  PronunciationAssessment: { AccuracyScore: 88 },
                  Offset: 1000,
                  Duration: 400,
                },
                {
                  Syllable: 'loʊ',
                  PronunciationAssessment: { AccuracyScore: 96 },
                  Offset: 1400,
                  Duration: 900,
                },
              ],
              Phonemes: [
                { Phoneme: 'h', PronunciationAssessment: { AccuracyScore: 90 }, Offset: 1000 },
                { Phoneme: 'ɛ', PronunciationAssessment: { AccuracyScore: 86 }, Offset: 1200 },
                { Phoneme: 'l', PronunciationAssessment: { AccuracyScore: 95 }, Offset: 1400 },
                { Phoneme: 'oʊ', PronunciationAssessment: { AccuracyScore: 97 }, Offset: 1800 },
              ],
            },
          ],
        },
      ],
    });
    expect(out.words[0].syllables).toEqual([
      {
        ipa: 'hɛ',
        accuracy: 88,
        phonemes: [
          { ipa: 'h', accuracy: 90 },
          { ipa: 'ɛ', accuracy: 86 },
        ],
      },
      {
        ipa: 'loʊ',
        accuracy: 96,
        phonemes: [
          { ipa: 'l', accuracy: 95 },
          { ipa: 'oʊ', accuracy: 97 },
        ],
      },
    ]);
  });

  it('reads the flat REST shape — scores directly on word/syllable/phoneme entries', () => {
    // The short-audio REST endpoint puts AccuracyScore/ErrorType FLAT on each entry (the nested
    // PronunciationAssessment shape is the SDK's). This is the shape production actually sees.
    const out = mapAzureAssessment({
      RecognitionStatus: 'Success',
      NBest: [
        {
          Lexical: 'dog',
          AccuracyScore: 98,
          Words: [
            {
              Word: 'dog',
              AccuracyScore: 98,
              ErrorType: 'None',
              Syllables: [{ Syllable: 'dɔg', AccuracyScore: 98, Offset: 1000, Duration: 3000 }],
              Phonemes: [
                { Phoneme: 'd', AccuracyScore: 100, Offset: 1000 },
                { Phoneme: 'ɔ', AccuracyScore: 97, Offset: 2000 },
                { Phoneme: 'g', AccuracyScore: 96, Offset: 3000 },
              ],
            },
          ],
        },
      ],
    });
    expect(out.words[0]).toEqual({
      word: 'dog',
      errorType: 'None',
      accuracy: 98,
      phonemes: [
        { ipa: 'd', accuracy: 100 },
        { ipa: 'ɔ', accuracy: 97 },
        { ipa: 'g', accuracy: 96 },
      ],
      syllables: [
        {
          ipa: 'dɔg',
          accuracy: 98,
          phonemes: [
            { ipa: 'd', accuracy: 100 },
            { ipa: 'ɔ', accuracy: 97 },
            { ipa: 'g', accuracy: 96 },
          ],
        },
      ],
    });
  });

  it('nests phonemes by IPA length when the response carries no offsets', () => {
    const out = mapAzureAssessment({
      RecognitionStatus: 'Success',
      NBest: [
        {
          Lexical: 'hello',
          AccuracyScore: 90,
          Words: [
            {
              Word: 'hello',
              AccuracyScore: 90,
              ErrorType: 'None',
              // No Offset/Duration anywhere — the greedy fallback consumes phonemes
              // left-to-right until each syllable's string length is covered.
              Syllables: [
                { Syllable: 'hɛ', AccuracyScore: 88 },
                { Syllable: 'loʊ', AccuracyScore: 96 },
              ],
              Phonemes: [
                { Phoneme: 'h', AccuracyScore: 90 },
                { Phoneme: 'ɛ', AccuracyScore: 86 },
                { Phoneme: 'l', AccuracyScore: 95 },
                { Phoneme: 'oʊ', AccuracyScore: 97 },
              ],
            },
          ],
        },
      ],
    });
    expect(out.words[0].syllables).toEqual([
      {
        ipa: 'hɛ',
        accuracy: 88,
        phonemes: [
          { ipa: 'h', accuracy: 90 },
          { ipa: 'ɛ', accuracy: 86 },
        ],
      },
      {
        ipa: 'loʊ',
        accuracy: 96,
        phonemes: [
          { ipa: 'l', accuracy: 95 },
          { ipa: 'oʊ', accuracy: 97 },
        ],
      },
    ]);
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
      { word: 'a', errorType: 'Insertion', accuracy: 0, phonemes: [], syllables: [] },
      {
        word: 'whisker',
        errorType: 'Mispronunciation',
        accuracy: 60,
        phonemes: [{ ipa: 'w', accuracy: 0 }],
        syllables: [],
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
