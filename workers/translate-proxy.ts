import { DurableObject } from 'cloudflare:workers';
import * as enrichSvc from '../server/services/enrich';
import * as generateSvc from '../server/services/generate';
import * as extractSvc from '../server/services/extract-questions';
import type { VocabEnrichItem, VocabGenerateInput, QuestionExtractInput } from '../shared/schemas';

/**
 * Durable Object that performs Anthropic API calls from a fixed region.
 *
 * Why this exists: Cloudflare serves this Worker from the data center nearest
 * the user (HKG / Hong Kong for Vietnam), and Anthropic geo-blocks Hong Kong
 * egress with `403 "Request not allowed"`. A Durable Object requested with
 * `locationHint: 'enam'` (see app/routes/enrich-vocab.tsx) runs in the US, so
 * its outbound fetch to Anthropic egresses from a supported region. The DO does
 * no storage work — it exists purely to relocate the egress point, so every
 * Anthropic-backed feature shares it, dispatched by path:
 *
 *   POST /enrich             fill in meaning/definition/IPA (app/routes/enrich-vocab.tsx)
 *   POST /generate           generate a vocab list          (app/routes/generate-vocab.tsx)
 *   POST /extract-questions  read questions off a test paper (app/routes/extract-questions.tsx)
 *
 * Bodies arrive already validated by the calling resource route.
 */
export class TranslateProxy extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (!this.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'disabled' }, { status: 503 });
    }
    const op = new URL(request.url).pathname;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    try {
      if (op === '/generate') {
        const words = await generateSvc.generateVocabWords(
          this.env.ANTHROPIC_API_KEY,
          body as VocabGenerateInput,
        );
        return Response.json({ words });
      }
      if (op === '/extract-questions') {
        const questions = await extractSvc.extractQuestions(
          this.env.ANTHROPIC_API_KEY,
          body as QuestionExtractInput,
        );
        return Response.json({ questions });
      }
      const words = await enrichSvc.enrichWords(
        this.env.ANTHROPIC_API_KEY,
        body as VocabEnrichItem[],
      );
      return Response.json({ words });
    } catch (e) {
      console.error('[translate-do] failed', {
        op,
        message: (e as Error)?.message,
        status: (e as { status?: number })?.status,
      });
      // Truncated extraction is a distinct, actionable failure ("split the file"), so it gets its
      // own label rather than the generic per-op one.
      if (e instanceof extractSvc.ExtractTruncatedError) {
        return Response.json({ error: 'extract_truncated' }, { status: 502 });
      }
      const label =
        op === '/generate'
          ? 'generate_failed'
          : op === '/extract-questions'
            ? 'extract_failed'
            : 'enrich_failed';
      return Response.json({ error: label }, { status: 502 });
    }
  }
}
