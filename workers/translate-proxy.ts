import { DurableObject } from 'cloudflare:workers';
import * as translateSvc from '../server/services/translate';
import type { TranslateItem } from '../server/services/translate';

/**
 * Durable Object that performs the Anthropic API call from a fixed region.
 *
 * Why this exists: Cloudflare serves this Worker from the data center nearest
 * the user (HKG / Hong Kong for Vietnam), and Anthropic geo-blocks Hong Kong
 * egress with `403 "Request not allowed"`. A Durable Object requested with
 * `locationHint: 'enam'` (see app/routes/translate.tsx) runs in the US, so its
 * outbound fetch to Anthropic egresses from a supported region. The DO does no
 * storage work — it exists purely to relocate the egress point.
 */
export class TranslateProxy extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (!this.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'disabled' }, { status: 503 });
    }
    let items: TranslateItem[];
    try {
      items = (await request.json()) as TranslateItem[];
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    try {
      const translations = await translateSvc.translateWords(this.env.ANTHROPIC_API_KEY, items);
      return Response.json({ translations });
    } catch (e) {
      console.error('[translate-do] failed', {
        message: (e as Error)?.message,
        status: (e as { status?: number })?.status,
      });
      return Response.json({ error: 'translate_failed' }, { status: 502 });
    }
  }
}
