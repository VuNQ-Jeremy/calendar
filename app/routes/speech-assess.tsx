import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { createDb } from '../../server/db/index';
import { requireLearnerCookieOrBearer } from '../../server/api/auth';
import { getPronounceSettings } from '../../server/services/flashcards';
import { SPEECH_ASSESS_METRIC, trackUsage } from '../../server/services/usage';
import { ictDateOf } from '../../shared/logic/tests';
import { wavSeconds } from '../../shared/logic/wav';
import {
  mapAzureAssessment,
  pronunciationAssessmentHeader,
  type AzureShortAudio,
} from '../../server/services/speech';

// Pronunciation scoring for the vocabulary "pronounce" game. Resource route, registered
// OUTSIDE the `_app` layout (same reasoning as enrich-vocab: posting here must not touch the
// flashcards route cache) and outside `/api` (that prefix is bearer-only; the web game posts
// with a session cookie — same split as zalo-send-card). The Azure key never leaves the
// Worker: clients send a 16 kHz mono WAV clip, this forwards it and returns the mapped scores.

/**
 * Hard cap on the uploaded clip. Both recorders stop at MAX_CLIP_MS (5 s ≈ 160 KB at
 * 16 kHz mono int16); this is ~12 s of headroom before we refuse to forward the body.
 */
const MAX_AUDIO_BYTES = 400_000;

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, ctx } = context.get(cloudflareCtx);
  await requireLearnerCookieOrBearer(request, env);
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) {
    return Response.json({ error: 'disabled' }, { status: 503 });
  }

  let word: string;
  let audio: ArrayBuffer;
  try {
    const fd = await request.formData();
    word = String(fd.get('word') ?? '').trim();
    const file = fd.get('audio');
    if (!word || word.length > 100 || !(file instanceof File)) {
      return Response.json({ error: 'invalid_input' }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return Response.json({ error: 'audio_too_long' }, { status: 400 });
    }
    audio = await file.arrayBuffer();
  } catch {
    return Response.json({ error: 'invalid_input' }, { status: 400 });
  }

  const url =
    `https://${env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com` +
    `/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
        'Pronunciation-Assessment': pronunciationAssessmentHeader(word),
      },
      body: audio,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: 'upstream_timeout' }, { status: 504 });
  }

  // The free tier allows ONE concurrent assessment; 429 means another student is mid-clip.
  // Passed through as our own 429 so both clients share a single "busy, retry shortly" story.
  if (res.status === 429) return Response.json({ error: 'busy' }, { status: 429 });
  if (res.status === 401 || res.status === 403) {
    // Key or region is wrong — a config problem, not the student's. Same face as unset.
    console.error('[speech-assess] Azure refused the subscription key', res.status);
    return Response.json({ error: 'disabled' }, { status: 503 });
  }
  if (!res.ok) return Response.json({ error: 'assess_failed' }, { status: 502 });
  const db = createDb(env);
  // Usage gauge for /logs/usage: Azure billed this call (any 200 means the audio was
  // processed, whatever RecognitionStatus says), so count it — off the response path.
  ctx.waitUntil(
    trackUsage(
      db,
      SPEECH_ASSESS_METRIC,
      ictDateOf(new Date().toISOString()).slice(0, 7),
      wavSeconds(audio.byteLength),
    ),
  );
  // The forgiveness curve (/config → Pronounce scoring). Loaded after the Azure round-trip on
  // purpose: no point reading settings for a clip that failed upstream.
  const { curve } = await getPronounceSettings(db);
  const json = (await res.json()) as AzureShortAudio;
  // The raw word/syllable/phoneme block, capped so a long miscue can't blow the log line.
  // Azure's response shape has already diverged from its docs once (flat vs nested scores) —
  // this is what lets a surprising score be traced in Workers Logs / `wrangler tail`.
  console.log('[speech-assess]', {
    word,
    status: json.RecognitionStatus,
    words: JSON.stringify(json.NBest?.[0]?.Words ?? []).slice(0, 8_000),
  });
  return Response.json({ data: mapAzureAssessment(json, curve) });
}
