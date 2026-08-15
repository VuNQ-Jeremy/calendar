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
 * List price per million tokens for claude-haiku-4-5 — the model behind both AI features
 * (server/services/enrich.ts and generate.ts). If the model ever changes, update these with
 * it; the stored token counts stay correct either way, only the estimate moves.
 */
export const AI_INPUT_USD_PER_MTOK = 1;
export const AI_OUTPUT_USD_PER_MTOK = 5;

/** Rough list-price cost of a month's tokens, in USD. An estimate, not an invoice. */
export function estimateAiCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * AI_INPUT_USD_PER_MTOK + outputTokens * AI_OUTPUT_USD_PER_MTOK) / 1_000_000;
}
