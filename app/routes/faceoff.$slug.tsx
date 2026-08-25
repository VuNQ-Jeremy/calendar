import type { LoaderFunctionArgs } from 'react-router';
import { FaceoffScreen } from '../../src/flashcards/faceoff.jsx';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireLearner } from '../../server/services/auth';
import * as flashcardsSvc from '../../server/services/flashcards';
import * as peopleSvc from '../../server/services/people';

/**
 * The tabletop 1v1 face-off — same-device split-screen duel, no room, no networking (see the
 * spec's face-off decision). A full-bleed page outside the app shell, like /battle.
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const su = await requireLearner(request, env);
  const db = tenantDbFor(env, su);
  const topic = await flashcardsSvc.getTopicBySlug(db, params.slug!);
  if (!topic) throw new Response('Not found', { status: 404 });
  const words = await flashcardsSvc.listWords(db, topic.id);
  // Player pickers are staff-only: recording a duel needs real student ids, and only a teacher's
  // tablet session may post one (see game-rooms.tsx's faceoff-result intent).
  const students = su.kind === 'staff' ? await peopleSvc.listStudents(db) : [];
  return {
    topic,
    words,
    students: students.map((s) => ({ id: s.id, name: s.name })),
    isStaff: su.kind === 'staff',
  };
}

export default function Faceoff() {
  return <FaceoffScreen />;
}
