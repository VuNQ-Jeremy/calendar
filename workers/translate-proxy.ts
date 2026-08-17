import { DurableObject } from 'cloudflare:workers';
import * as enrichSvc from '../server/services/enrich';
import * as generateSvc from '../server/services/generate';
import { createRawDb } from '../server/db/internal';
import { trackAiUsage } from '../server/services/usage';
import { ictDateOf } from '../shared/logic/tests';
import type { AiUsage } from '../shared/logic/usage';
import type { VocabEnrichInput, VocabGenerateInput } from '../shared/schemas';

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
 *   POST /enrich   fill in meaning/definition/IPA (app/routes/enrich-vocab.tsx)
 *   POST /generate generate a vocab list          (app/routes/generate-vocab.tsx)
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
    // Token gauge for /logs/usage — off the response path. The DO shares the Worker's env, so
    // D1 is reachable from here; Anthropic bills whether or not the words survive sanitizing,
    // so the count happens right where the call returns.
    const track = (usage: AiUsage) =>
      this.ctx.waitUntil(
        trackAiUsage(createRawDb(this.env), ictDateOf(new Date().toISOString()).slice(0, 7), usage),
      );
    try {
      if (op === '/generate') {
        const { words, usage } = await generateSvc.generateVocabWords(
          this.env.ANTHROPIC_API_KEY,
          body as VocabGenerateInput,
        );
        track(usage);
        return Response.json({ words });
      }
      const { words, usage } = await enrichSvc.enrichWords(
        this.env.ANTHROPIC_API_KEY,
        body as VocabEnrichInput,
      );
      track(usage);
      return Response.json({ words });
    } catch (e) {
      console.error('[translate-do] failed', {
        op,
        message: (e as Error)?.message,
        status: (e as { status?: number })?.status,
      });
      const label = op === '/generate' ? 'generate_failed' : 'enrich_failed';
      return Response.json({ error: label }, { status: 502 });
    }
  }
}
