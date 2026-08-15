import { describe, it, expect } from 'vitest';
import { mapAzureAssessment, pronunciationAssessmentHeader } from '../server/services/speech.js';
import { forgiveScore } from '../shared/logic/flashcards.js';
import { wavSeconds } from '../shared/logic/wav.js';

describe('wavSeconds', () => {
  it('converts a 16 kHz mono int16 WAV byte length to seconds', () => {
    expect(wavSeconds(44)).toBe(0); // header only
    expect(wavSeconds(44 + 32000)).toBe(1); // one second of samples
    expect(wavSeconds(44 + 160000)).toBe(5); // a full MAX_CLIP_MS clip
    expect(wavSeconds(0)).toBe(0); // never negative on a short/odd body
  });
});

describe('forgiveScore', () => {
  it('applies each curve preset', () => {
    // [raw, off, round5, boost5, round10, squeeze]
    const table: [number, number, number, number, number, number][] = [
      [98, 98, 100, 100, 100, 99],
      [92, 92, 95, 97, 100, 94],
      [87, 87, 90, 92, 90, 90],
      [71, 71, 75, 76, 80, 78],
      [68, 68, 70, 73, 70, 76],
      [60, 60, 60, 65, 60, 70],
      [40, 40, 40, 45, 40, 55],
      [100, 100, 100, 100, 100, 100],
    ];
    for (const [raw, off, round5, boost5, round10, squeeze] of table) {
      expect(forgiveScore(raw, 'off')).toBe(off);
      expect(forgiveScore(raw, 'round5')).toBe(round5);
      expect(forgiveScore(raw, 'boost5')).toBe(boost5);
      expect(forgiveScore(raw, 'round10')).toBe(round10);
      expect(forgiveScore(raw, 'squeeze')).toBe(squeeze);
    }
  });

  it('never lifts 0 — kindness is for attempts, not silence', () => {
    for (const curve of ['off', 'round5', 'boost5', 'round10', 'squeeze'] as const) {
      expect(forgiveScore(0, curve)).toBe(0);
    }
  });
});

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
      curve: 'off',
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

  it('passes on the FORGIVEN score but keeps the DTO raw', () => {
    // raw 68 fails at 70; round5 lifts it to 70, so `correct` flips — but `accuracy`
    // stays 68 (clients apply the echoed curve to what they display; the drawer shows raw).
    const payload = {
      RecognitionStatus: 'Success',
      NBest: [{ Lexical: 'bird', AccuracyScore: 68 }],
    };
    const raw = mapAzureAssessment(payload);
    expect(raw.correct).toBe(false);
    expect(raw.curve).toBe('off');
    const forgiven = mapAzureAssessment(payload, 'round5');
    expect(forgiven.correct).toBe(true);
    expect(forgiven.accuracy).toBe(68);
    expect(forgiven.curve).toBe('round5');
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
