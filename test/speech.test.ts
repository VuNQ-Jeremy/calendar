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
    }
  });
});
