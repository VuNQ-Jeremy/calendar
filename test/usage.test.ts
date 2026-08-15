import { describe, it, expect } from 'vitest';
import { estimateAiCostUsd } from '../shared/logic/usage.js';
import { readAiUsage } from '../server/services/enrich.js';

describe('estimateAiCostUsd', () => {
  it('prices input and output at their own haiku list rates', () => {
    // $1/MTok in, $5/MTok out
    expect(estimateAiCostUsd(1_000_000, 0)).toBe(1);
    expect(estimateAiCostUsd(0, 1_000_000)).toBe(5);
    expect(estimateAiCostUsd(500_000, 100_000)).toBe(1);
    expect(estimateAiCostUsd(0, 0)).toBe(0);
  });
});

describe('readAiUsage', () => {
  it('counts cache reads and writes as input so the gauge never shrinks under caching', () => {
    expect(
      readAiUsage({
        input_tokens: 1000,
        output_tokens: 400,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
      }),
    ).toEqual({ inputTokens: 1500, outputTokens: 400 });
  });

  it('tolerates the cache fields being absent or null', () => {
    expect(readAiUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(
      readAiUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
