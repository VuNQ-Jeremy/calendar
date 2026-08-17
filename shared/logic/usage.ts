/**
 * Anthropic API usage metrics for the /logs Usage tab — shared between the server (which
 * counts, in usage_counters) and the web screen (which renders the card and prices the
 * estimate). One API call writes two rows per month: input tokens and output tokens, so the
 * cost estimate can price each side at its own rate.
 */

export const AI_INPUT_METRIC = 'ai-input-tokens';
export const AI_OUTPUT_METRIC = 'ai-output-tokens';

/** One Anthropic call's token spend, as the AI services report it to the counters. */
export type AiUsage = { inputTokens: number; outputTokens: number };

/**
 * List price per million tokens for claude-haiku-4-5 — the model behind the AI generator and the
 * interactive `fast` enrichment tier, which is nearly all traffic.
 */
export const AI_INPUT_USD_PER_MTOK = 1;
export const AI_OUTPUT_USD_PER_MTOK = 5;

/**
 * The same, for the opt-in `best` enrichment tier (claude-opus-5) — 5x the fast tier on both sides.
 */
export const AI_BEST_INPUT_USD_PER_MTOK = 5;
export const AI_BEST_OUTPUT_USD_PER_MTOK = 25;

/**
 * Rough list-price cost of a month's tokens, in USD. An estimate, not an invoice — and specifically
 * a LOWER BOUND once the `best` tier has been used.
 *
 * `usage_counters` stores two rows per month (input, output) with no model dimension, so a month
 * that mixed Haiku and Opus 5 cannot be priced exactly from what is stored. This prices everything
 * at the fast tier, because that is nearly all traffic; a bulk backfill on the `best` tier costs up
 * to 5x what this reports for its share of the tokens.
 *
 * To make it exact, give the counters a model dimension — write `ai-input-tokens-best` /
 * `ai-output-tokens-best` alongside the existing pair (the table is keyed by
 * `(tenant_id, month, metric)`, so new metric names need no migration) and price each pair with its
 * own constants.
 */
export function estimateAiCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * AI_INPUT_USD_PER_MTOK + outputTokens * AI_OUTPUT_USD_PER_MTOK) / 1_000_000;
}
