import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { FlashcardTopicsScreen } from '../../src/flashcards/index.jsx';
import { tenantDbFor, type TenantDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireLearner, requireStaff, type SessionUser } from '../../server/services/auth';
import * as flashcardsSvc from '../../server/services/flashcards';
import * as gardenSvc from '../../server/services/garden';
import * as classesSvc from '../../server/services/classes';
import * as curriculaSvc from '../../server/services/vocab-curricula';
import * as gradeLevelsSvc from '../../server/services/grade-levels';
import * as checkinSvc from '../../server/services/checkin';
import {
  FlashcardTopicInput,
  FlashcardTopicWithWordsInput,
  PlantPatchInput,
  VocabAssignmentInput,
  VocabCurriculumInput,
  VocabImportInput,
  VocabUnitInput,
  parsePatch,
} from '../../shared/schemas';
import { plantView, monthOfVn } from '../../shared/logic/garden';
import { ictDateOf } from '../../shared/logic/tests';
import type { StaffGardenData, StudentGardenData } from '../../src/garden/garden-widget.jsx';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

/**
 * The garden half of the loader — the only part of this page allowed to fail.
 *
 * A deploy can reach the edge minutes before its D1 migration does, and /vocabulary is the
 * flashcards screen first and the garden second. So every garden read lives inside one try/catch
 * and degrades to null: no plant widget, no assignment panel, but the topics still list. The UI
 * treats null as "not there yet" rather than as an error.
 */
async function loadGarden(
  db: TenantDb,
  su: SessionUser,
): Promise<{ garden: StudentGardenData | null; gardenStaff: StaffGardenData | null }> {
  // The Worker clock is UTC and the school is UTC+7: every day boundary here is an ICT one.
  const nowIso = new Date().toISOString();
  const today = ictDateOf(nowIso);
  try {
    if (su.kind === 'student') {
      const studentId = su.user.id;
      const [settings, record, assignments, classesOf] = await Promise.all([
        gardenSvc.getGardenSettings(db),
        gardenSvc.getPlant(db, studentId),
        // The instant, not the day: an assignment with a clock time closes when that time passes.
        gardenSvc.studentAssignments(db, studentId, nowIso),
        gardenSvc.studentClasses(db, studentId),
      ]);
      // Settled in memory, never written — a read of the plant stays a read (shared/logic/garden).
      const plant = plantView(record?.state ?? null, settings, today);
      // Fruit-this-month is derived from the event log rather than stored, and a plant that has
      // never fruited cannot have fruited this month — so the read is skipped entirely.
      const fruitMonth = plant.fruitsTotal
        ? (await gardenSvc.plantHistory(db, studentId, 200)).filter(
            (e) => e.type === 'harvest' && e.vnDay.startsWith(monthOfVn(today)),
          ).length
        : 0;
      return {
        garden: {
          today,
          hasPlant: record !== null,
          plant,
          plantName: record?.plantName ?? null,
          potColor: record?.potColor ?? 'orange',
          species: record?.species ?? 'classic',
          fruitMonth,
          classId: classesOf[0]?.id ?? null,
          assignments,
          settings,
        },
        gardenStaff: null,
      };
    }

    const [rows, classList] = await Promise.all([
      gardenSvc.listAssignments(db, {}),
      classesSvc.listLite(db),
    ]);
    // One progress read per assignment. The tracking modal opens on a row that is already loaded
    // (no second round trip), and a school runs a handful of assignments at a time, not hundreds.
    // The row is handed in so `assignmentProgress` does not re-join its way back to what we just
    // listed — that lookup, once per assignment, was the whole cost of this loader.
    const blocks = await Promise.all(
      rows.map(async (assignment) => ({
        assignment,
        rows: (await gardenSvc.assignmentProgress(db, assignment.id, assignment))?.rows ?? [],
      })),
    );
    return {
      garden: null,
      gardenStaff: { today, assignments: blocks, classes: classList },
    };
  } catch (err) {
    console.error('garden unavailable on /vocabulary', err);
    return { garden: null, gardenStaff: null };
  }
}

/**
 * What the student owes a review on today, or null.
 *
 * Degrades to null on failure for the same reason the garden does: this page is the topics list
 * first, and a deploy that lands before its migration must not take that down. Staff get null
 * because only students have mastery rows to schedule.
 */
async function loadReview(db: TenantDb, su: SessionUser) {
  if (su.kind !== 'student') return null;
  const today = ictDateOf(new Date().toISOString());
  try {
    const { groups, total } = await flashcardsSvc.listDueForStudent(db, su.user.id, today);
    return { today, total, groups };
  } catch (err) {
    console.error('review due list unavailable on /vocabulary', err);
    return null;
  }
}

/**
 * The student's own túi mù chip, next to the garden widget. Same degrade-to-null posture as
 * loadGarden/loadReview: this page is the topics list first, and a chip is not worth a 500.
 * Null for staff (only students earn bags) and while the admin's `showStudentView` toggle is off.
 */
async function loadTuiMu(db: TenantDb, su: SessionUser) {
  if (su.kind !== 'student') return null;
  try {
    const settings = await checkinSvc.getCheckinSettings(db);
    if (!settings.showStudentView) return null;
    const month = ictDateOf(new Date().toISOString()).slice(0, 7);
    return await checkinSvc.studentMonthTally(db, su.user.id, month);
  } catch (err) {
    console.error('túi mù tally unavailable on /vocabulary', err);
    return null;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const su = await requireLearner(request, env);
  const db = tenantDbFor(env, su);
  const topics = await flashcardsSvc.listTopics(db);
  const [{ garden, gardenStaff }, review, tuiMu, curricula, units, vocabTopics, gradeLevels] =
    await Promise.all([
      loadGarden(db, su),
      loadReview(db, su),
      loadTuiMu(db, su),
      // Not wrapped in a degrade-to-null like the garden: the curriculum rail is part of the topics
      // list, and the tables have shipped, so a failure here is a real fault worth seeing.
      curriculaSvc.list(db),
      curriculaSvc.unitsByTopic(db),
      flashcardsSvc.listVocabTopics(db),
      // `db.raw`: khối is global since 0049, so the service takes a plain Db and there is no fence.
      gradeLevelsSvc.list(db.raw),
    ]);
  // Gates the AI generator in the UI — same flag the topic page passes down.
  return {
    topics,
    kind: su.kind,
    canUseAi: Boolean(env.ANTHROPIC_API_KEY),
    garden,
    gardenStaff,
    review,
    tuiMu,
    curricula,
    /** `topicId -> { curriculumId, unitNo }` for every deck that is filed as a unit. */
    units,
    /** The global tag catalog, for the word dialog and the import review screen. */
    vocabTopics,
    /** Global khối, for the curriculum dialog's grade picker. */
    gradeLevels,
    /** Only a platform admin may write the shared library tier. */
    isPlatformAdmin: su.isPlatformAdmin,
  };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.flashcards, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  // The handle is built from the resolved session, not from `env` alone, so it can only be made
  // AFTER one of the two guards below has run. That is why there is no shared `db` up here.
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  // The two student intents are handled BEFORE the staff guard below, which redirects students
  // away. Both act on the caller's own plant and on nothing else: the student id comes from the
  // session, never from the form, so there is no plant to point them at but their own.
  if (intent === 'harvest' || intent === 'plant-update') {
    const su = await requireLearner(request, env);
    if (su.kind !== 'student') return Response.json({ error: 'forbidden' }, { status: 403 });
    const db = tenantDbFor(env, su);

    if (intent === 'harvest') {
      const result = await gardenSvc.harvest(db, su.user.id);
      // 409, not 400: a plant that isn't ripe (or a second tap that lost the race) is a state
      // conflict, and the status keeps the live hub from broadcasting a no-op.
      if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 409 });
      return { ok: true, fruitsTotal: result.fruitsTotal };
    }

    const plantRaw = Object.fromEntries(formData) as Record<string, unknown>;
    // A cleared name field posts '', and '' has to reach the row as NULL — "unnamed" is the
    // absence of a name, not a name that happens to be empty.
    if (plantRaw.plantName === '') plantRaw.plantName = null;
    const parsed = parsePatch(PlantPatchInput, plantRaw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const updated = await gardenSvc.updatePlant(db, su.user.id, parsed.data);
    // 409 for the same reason harvest uses it: a species refused because the plant is mid-growth
    // (or not yet earned) is a state conflict, not a malformed request.
    if (!updated.ok) return Response.json({ ok: false, error: updated.error }, { status: 409 });
    return { ok: true };
  }

  const staff = await requireStaff(request, env); // topic CRUD and assignments are staff-only
  const db = tenantDbFor(env, staff);

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await flashcardsSvc.removeTopic(db, id, { isPlatformAdmin: staff.isPlatformAdmin });
    return { ok: true };
  }

  if (intent === 'assign-delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await gardenSvc.deleteAssignment(db, id);
    return { ok: true };
  }

  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  if (raw.description === '') raw.description = null;
  if (raw.note === '') raw.note = null;

  /* ── Curriculum ──────────────────────────────────────────────────────────────────────────────
   *
   * `intoLibrary` and `isPlatformAdmin` are passed explicitly rather than read inside the service:
   * a service has no session, and making the caller name the tier keeps "this write targets the
   * shared library" visible at the route, which is where a reviewer looks.
   */

  if (intent === 'curriculum-create') {
    const parsed = VocabCurriculumInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const row = await curriculaSvc.create(db, parsed.data, {
      intoLibrary: raw.intoLibrary === 'true',
      isPlatformAdmin: staff.isPlatformAdmin,
    });
    return { ok: true, id: row.id };
  }

  if (intent === 'curriculum-update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(VocabCurriculumInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await curriculaSvc.update(db, id, parsed.data, { isPlatformAdmin: staff.isPlatformAdmin });
    return { ok: true };
  }

  if (intent === 'curriculum-delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await curriculaSvc.remove(db, id, { isPlatformAdmin: staff.isPlatformAdmin });
    return { ok: true };
  }

  /** File one deck as unit N of a curriculum, or unfile it with an empty `curriculumId`. */
  if (intent === 'unit-attach') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = VocabUnitInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await curriculaSvc.setUnit(db, id, parsed.data);
    return { ok: true };
  }

  /**
   * A whole workbook in one POST. The payload is JSON in a form field rather than form fields,
   * because it is a nested units/words tree — the same shape the question importer posts.
   */
  if (intent === 'curriculum-import') {
    let payload: unknown;
    try {
      payload = JSON.parse((formData.get('payload') as string) ?? '{}');
    } catch {
      return Response.json({ error: 'bad payload json' }, { status: 400 });
    }
    const parsed = VocabImportInput.safeParse(payload);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const result = await curriculaSvc.importUnits(db, parsed.data.curriculumId, parsed.data.units, {
      isPlatformAdmin: staff.isPlatformAdmin,
      intoLibrary: raw.intoLibrary === 'true',
    });
    return { ok: true, ...result };
  }

  if (intent === 'assign-create') {
    const parsed = VocabAssignmentInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const created = await gardenSvc.createAssignment(db, parsed.data, staff.user.id);
    return { ok: true, id: created };
  }

  if (intent === 'assign-update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(VocabAssignmentInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await gardenSvc.updateAssignment(db, id, parsed.data);
    return { ok: true };
  }

  if (intent === 'create') {
    const parsed = FlashcardTopicInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await flashcardsSvc.createTopic(db, parsed.data);
    return { ok: true };
  }

  // AI generation: the words were reviewed client-side, so the topic and its words are written
  // together — a failure can't leave an empty topic behind. Returns the slug so the screen can
  // navigate straight into the new topic.
  if (intent === 'generate-topic') {
    try {
      raw.words = JSON.parse((formData.get('words') as string) ?? '[]');
    } catch {
      return Response.json({ error: 'invalid words json' }, { status: 400 });
    }
    const parsed = FlashcardTopicWithWordsInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const { words, ...topic } = parsed.data;
    const created = await flashcardsSvc.createTopicWithWords(db, topic, words);
    return { ok: true, topic: created };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(FlashcardTopicInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    // The flag, like the curriculum intents above, is passed from the session rather than read
    // inside the service: without it a platform admin's edit of a LIBRARY deck updates zero rows
    // and still returns ok, which is how recolouring one silently did nothing.
    await flashcardsSvc.updateTopic(db, id, parsed.data, {
      isPlatformAdmin: staff.isPlatformAdmin,
    });
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('flashcards', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('flashcards');
  }
}

export default function Flashcards() {
  return <FlashcardTopicsScreen />;
}
