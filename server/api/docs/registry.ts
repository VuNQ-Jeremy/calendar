import { z } from 'zod';
import * as c from '../../../shared/api-contract';
import {
  AssessmentTypeInput,
  AssessmentTypeReorder,
  AttendanceSaveInput,
  BehaviorRecordInput,
  ChangePasswordInput,
  ClassInput,
  ClassMaterialsSaveInput,
  EventInput,
  EventMaterialsSaveInput,
  FeedbackInput,
  FlashcardImportInput,
  FlashcardResultBatch,
  FlashcardTopicInput,
  FlashcardTopicWithWordsInput,
  FlashcardWordInput,
  GardenSettingsInput,
  GradeLevelInput,
  GradeLevelReorder,
  InviteInput,
  LoginInput,
  MaterialInput,
  MonthlyRemarkInput,
  NotifPrefsInput,
  ParentInput,
  ParentPortalInput,
  PlantPatchInput,
  ProfileInput,
  PushRegisterInput,
  RedeemInviteInput,
  RemarkCriteriaReorder,
  RemarkCriterionInput,
  RequestResetInput,
  ScoreRecordInput,
  SessionPreviewInput,
  StaffInput,
  StudentInput,
  SubjectInput,
  ThemeInput,
  TuitionMonth,
  UiPrefsInput,
  VocabAssignmentInput,
  WaterInput,
  ZaloPairInput,
} from '../../../shared/schemas';
import type { DocAuthLevel, OperationDoc, ParamDoc, PathDoc, ResponseDoc } from './types';

/**
 * Every endpoint under `/api/*`, described once.
 *
 * This is the input to `build-spec.ts`, which turns it into the OpenAPI document at
 * /docs/openapi.json. Adding a route to `app/routes.ts` without adding it here fails
 * `test/api-docs-completeness.test.ts`; adding it with the wrong methods fails
 * `test-worker/api-docs.test.js`.
 *
 * Request schemas come from `shared/schemas.ts` (what a client may send); response schemas from
 * `shared/api-contract.ts` (what the server sends back). Neither is restated here.
 *
 * The builder adds, so entries below never repeat them:
 *   - 401 `unauthorized` to every non-public operation, and 403 `forbidden` above level 'any';
 *   - 400 `invalid_json` and 422 `validation_failed` to every operation with a JSON body;
 *   - the `{ data }` wrapper around every 2xx payload.
 */

/** An error response with no body worth describing beyond its code. */
const err = (code: string, note?: string): ResponseDoc => ({
  description: note ? `\`${code}\` — ${note}` : `\`${code}\``,
});

const ok = (schema: z.ZodType | undefined, description: string): ResponseDoc => ({
  schema,
  description,
});

const idParam = (name = 'id', description?: string): ParamDoc => ({
  name,
  in: 'path',
  required: true,
  description,
});

/* ── The collection factory ────────────────────────────────────────────────────────────────── */

/**
 * The four operations `crud()` in `server/api/handler.ts` serves, as two paths: the collection
 * and its `/{id}` form. PATCH and DELETE take the id from either, because `requireId` reads
 * `params.id ?? ?id=` — so `DELETE /api/events?id=x` works just as well as `DELETE /api/events/x`.
 */
function crudDoc(cfg: {
  routePattern: string;
  base: string;
  tag: string;
  /** Level for the writes. */
  level: DocAuthLevel;
  /** Level for the list, when reading is looser than writing. Defaults to `level`. */
  readLevel?: DocAuthLevel;
  input: z.ZodObject<z.ZodRawShape>;
  row: z.ZodType;
  /** Singular noun for the generated summaries, e.g. 'event'. */
  entity: string;
  plural?: string;
  /** Routes whose service has no update function — PATCH answers 405. */
  noPatch?: boolean;
  /** Overrides for services that do not hand back the row they just wrote. */
  createResult?: z.ZodType;
  updateResult?: z.ZodType;
  deleteResult?: z.ZodType;
  listQuery?: ParamDoc[];
  listNote?: string;
}): PathDoc[] {
  const plural = cfg.plural ?? `${cfg.entity}s`;
  const write = cfg.level;
  const read = cfg.readLevel ?? cfg.level;

  const collection: OperationDoc[] = [
    {
      method: 'get',
      auth: read,
      summary: `List ${plural}`,
      description: cfg.listNote,
      params: cfg.listQuery,
      responses: { 200: ok(z.array(cfg.row), `Every ${cfg.entity}.`) },
    },
    {
      method: 'post',
      auth: write,
      summary: `Create a ${cfg.entity}`,
      request: { schema: cfg.input },
      responses: {
        200: ok(cfg.createResult ?? cfg.row, `The ${cfg.entity} as stored.`),
      },
    },
  ];

  const byId: OperationDoc[] = [];
  if (!cfg.noPatch) {
    byId.push({
      method: 'patch',
      auth: write,
      summary: `Update a ${cfg.entity}`,
      params: [idParam()],
      request: { schema: cfg.input, patch: true },
      responses: {
        200: ok(cfg.updateResult ?? cfg.row, `The ${cfg.entity} after the change.`),
        400: err('missing_id', 'no `:id` and no `?id=`'),
      },
    });
  } else {
    byId.push({
      method: 'patch',
      auth: write,
      summary: `Not supported for ${plural}`,
      description: `There is no update path for ${plural}; reissue instead.`,
      params: [idParam()],
      responses: { 405: err('method_not_allowed') },
    });
  }
  byId.push({
    method: 'delete',
    auth: write,
    summary: `Delete a ${cfg.entity}`,
    params: [idParam()],
    responses: {
      200: ok(cfg.deleteResult ?? c.IdAck, 'The id that was removed.'),
      400: err('missing_id', 'no `:id` and no `?id=`'),
    },
  });

  return [
    { path: cfg.base, routePattern: cfg.routePattern, tag: cfg.tag, operations: collection },
    {
      path: `${cfg.base}/{id}`,
      routePattern: cfg.routePattern,
      tag: cfg.tag,
      operations: byId,
    },
  ];
}

/* ── Auth ──────────────────────────────────────────────────────────────────────────────────── */

const auth: PathDoc[] = [
  {
    path: '/api/auth/login',
    routePattern: 'api/auth/login',
    tag: 'Auth',
    operations: [
      {
        method: 'post',
        auth: 'public',
        summary: 'Exchange email and password for a bearer token',
        description:
          'The token is returned raw and stored only as a SHA-256 hash, so a database dump ' +
          'cannot be replayed. Mobile sessions last 90 days and slide forward on use.',
        request: { schema: LoginInput },
        responses: {
          200: ok(c.LoginResponse, 'A new session.'),
          401: err('invalid_credentials', 'wrong email or password'),
        },
      },
    ],
  },
  {
    path: '/api/auth/redeem-invite',
    routePattern: 'api/auth/redeem-invite',
    tag: 'Auth',
    operations: [
      {
        method: 'post',
        auth: 'public',
        summary: 'Create an account from an invite code and sign in',
        description:
          'Signup is invite-only. A code minted from a person page attaches the account to that ' +
          'existing student/staff/parent row and the posted `name` is ignored — the school’s ' +
          'spelling wins. Codes created through `POST /api/invites` carry no link and do create ' +
          'the person on redeem.',
        request: { schema: RedeemInviteInput },
        responses: {
          200: ok(c.LoginResponse, 'A new session, same shape as login.'),
          400: err('invalid_invite', 'unknown, spent or expired code'),
        },
      },
    ],
  },
  {
    path: '/api/auth/request-reset',
    routePattern: 'api/auth/request-reset',
    tag: 'Auth',
    operations: [
      {
        method: 'post',
        auth: 'public',
        summary: 'Start a password reset',
        description:
          'Answers `ok` whether or not the address has an account — the endpoint must not confirm ' +
          'which emails exist.',
        request: { schema: RequestResetInput },
        responses: { 200: ok(c.RequestResetResult, 'Accepted.') },
      },
    ],
  },
  {
    path: '/api/auth/me',
    routePattern: 'api/auth/me',
    tag: 'Auth',
    operations: [
      {
        method: 'get',
        auth: 'any',
        summary: 'The signed-in person and their account',
        responses: { 200: ok(c.MeResponse, 'The caller.') },
      },
    ],
  },
  {
    path: '/api/auth/logout',
    routePattern: 'api/auth/logout',
    tag: 'Auth',
    operations: [
      {
        method: 'post',
        auth: 'any',
        summary: 'Revoke the bearer token used to make this call',
        description: 'Sessions are per-device: this ends one, never the others.',
        responses: { 200: ok(c.OkAck, 'The session is gone.') },
      },
    ],
  },
  {
    path: '/api/auth/change-password',
    routePattern: 'api/auth/change-password',
    tag: 'Auth',
    operations: [
      {
        method: 'post',
        auth: 'any',
        summary: 'Change the account password',
        description:
          'Evicts every OTHER session, the browser included; the device that made the change ' +
          'keeps its token. Present the resulting 401 elsewhere as a re-login, not a crash.',
        request: { schema: ChangePasswordInput },
        responses: {
          200: ok(c.OkAck, 'Changed.'),
          400: err('wrong_current_password'),
        },
      },
    ],
  },
];

/* ── App ───────────────────────────────────────────────────────────────────────────────────── */

const app: PathDoc[] = [
  {
    path: '/api/bootstrap',
    routePattern: 'api/bootstrap',
    tag: 'App',
    operations: [
      {
        method: 'get',
        auth: 'any',
        summary: 'Everything a cold start needs, in one round trip',
        description:
          'The roster fields (`classes`, `students`, `assessmentTypes`, `theme`) are present only ' +
          'for staff — students and parents must never be sent the school’s student list.',
        responses: { 200: ok(c.Bootstrap, 'The caller, their prefs, and the roster if staff.') },
      },
    ],
  },
  {
    path: '/api/dashboard',
    routePattern: 'api/dashboard',
    tag: 'App',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: "Today's sessions",
        description: '`today` is the server’s ICT day, not the caller’s.',
        responses: { 200: ok(c.DashboardResponse, "Today's events and the class list.") },
      },
    ],
  },
  {
    path: '/api/profile',
    routePattern: 'api/profile',
    tag: 'App',
    operations: [
      {
        method: 'get',
        auth: 'any',
        summary: "The caller's own profile",
        responses: { 200: ok(c.ProfileRow, 'The caller, with the ACCOUNT email.') },
      },
      {
        method: 'patch',
        auth: 'any',
        summary: "Update the caller's own profile",
        description:
          'Name, contact details and colour only — never role or id. The reply is the updated ' +
          'person row, whose shape depends on whether the caller is staff, a student or a parent.',
        request: { schema: ProfileInput, patch: true },
        responses: { 200: ok(c.ProfilePatchResult, 'The updated person row.') },
      },
    ],
  },
  {
    path: '/api/checkin/summary',
    routePattern: 'api/checkin/summary',
    tag: 'App',
    operations: [
      {
        method: 'get',
        auth: 'user',
        summary: "One student's túi mù month",
        description:
          'Students get their own; only staff may pass `?studentId=`. When an admin has switched ' +
          'the student view off the whole payload is `{ disabled: true }`.',
        params: [
          {
            name: 'studentId',
            in: 'query',
            description: 'Staff only. Students always get their own summary.',
          },
        ],
        responses: {
          200: ok(c.CheckinSummary, 'The month, or the disabled marker.'),
          400: err('missing_student', 'a staff caller passed no `?studentId=`'),
          403: err('forbidden', 'a non-staff caller passed `?studentId=`'),
        },
      },
    ],
  },
];

/* ── Collections ───────────────────────────────────────────────────────────────────────────── */

const collections: PathDoc[] = [
  ...crudDoc({
    routePattern: 'api/events/:id?',
    base: '/api/events',
    tag: 'Events',
    level: 'staff',
    input: EventInput,
    row: c.EventRow,
    entity: 'event',
  }),
  ...crudDoc({
    routePattern: 'api/classes/:id?',
    base: '/api/classes',
    tag: 'People & classes',
    level: 'staff',
    input: ClassInput,
    row: c.ClassRow,
    entity: 'class',
    plural: 'classes',
  }),
  ...crudDoc({
    routePattern: 'api/students/:id?',
    base: '/api/students',
    tag: 'People & classes',
    level: 'staff',
    input: StudentInput,
    row: c.StudentRow,
    entity: 'student',
  }),
  ...crudDoc({
    routePattern: 'api/staff/:id?',
    base: '/api/staff',
    tag: 'People & classes',
    level: 'staff',
    input: StaffInput,
    row: c.StaffRow,
    entity: 'staff member',
    plural: 'staff',
  }),
  ...crudDoc({
    routePattern: 'api/parents/:id?',
    base: '/api/parents',
    tag: 'People & classes',
    level: 'staff',
    input: ParentInput,
    row: c.ParentRow,
    entity: 'parent',
  }),
  ...crudDoc({
    routePattern: 'api/invites/:id?',
    base: '/api/invites',
    tag: 'People & classes',
    level: 'staff',
    input: InviteInput,
    row: c.InviteRow,
    entity: 'invite',
    noPatch: true,
  }),
  ...crudDoc({
    routePattern: 'api/feedback/:id?',
    base: '/api/feedback',
    tag: 'App',
    level: 'staff',
    input: FeedbackInput,
    row: c.FeedbackRow,
    entity: 'feedback item',
    plural: 'feedback',
    listNote: 'Newest first.',
  }),
  ...crudDoc({
    routePattern: 'api/assessments/scores/:id?',
    base: '/api/assessments/scores',
    tag: 'Assessments',
    level: 'staff',
    input: ScoreRecordInput,
    row: c.ScoreRecordRow,
    entity: 'score',
  }),
  ...crudDoc({
    routePattern: 'api/assessments/behavior/:id?',
    base: '/api/assessments/behavior',
    tag: 'Assessments',
    level: 'staff',
    input: BehaviorRecordInput,
    row: c.BehaviorRecordRow,
    entity: 'behaviour record',
  }),
  ...crudDoc({
    routePattern: 'api/assessments/remarks/:id?',
    base: '/api/assessments/remarks',
    tag: 'Assessments',
    level: 'staff',
    input: MonthlyRemarkInput,
    row: c.MonthlyRemarkRow,
    entity: 'monthly remark',
    listNote:
      'Creating a remark upserts on (studentId, month): one remark per student per month, ever.',
  }),
  ...crudDoc({
    routePattern: 'api/assessment-types/:id?',
    base: '/api/assessment-types',
    tag: 'Config',
    level: 'admin',
    input: AssessmentTypeInput,
    row: c.AssessmentTypeRow,
    entity: 'assessment type',
  }),
  ...crudDoc({
    routePattern: 'api/grade-levels/:id?',
    base: '/api/grade-levels',
    tag: 'Config',
    level: 'admin',
    input: GradeLevelInput,
    row: c.GradeLevelRow,
    entity: 'grade level',
  }),
  ...crudDoc({
    routePattern: 'api/remark-criteria/:id?',
    base: '/api/remark-criteria',
    tag: 'Config',
    level: 'admin',
    readLevel: 'staff',
    input: RemarkCriterionInput,
    row: c.RemarkCriterionRow,
    entity: 'remark criterion',
    plural: 'remark criteria',
  }),
  ...crudDoc({
    routePattern: 'api/subjects/:id?',
    base: '/api/subjects',
    tag: 'Config',
    level: 'admin',
    readLevel: 'staff',
    input: SubjectInput,
    row: c.SubjectRow,
    entity: 'subject',
  }),
  ...crudDoc({
    routePattern: 'api/flashcards/topics/:id?',
    base: '/api/flashcards/topics',
    tag: 'Vocabulary',
    level: 'staff',
    readLevel: 'user',
    input: FlashcardTopicInput,
    row: c.FlashcardTopicRow,
    entity: 'topic',
    listNote: 'Readable by students, who play them.',
    // The topic service returns void, so the route replies with the refreshed list instead.
    createResult: z.array(c.FlashcardTopicRow),
    updateResult: z.array(c.FlashcardTopicRow),
    deleteResult: z.array(c.FlashcardTopicRow),
  }),
  ...crudDoc({
    routePattern: 'api/garden/assignments/:id?',
    base: '/api/garden/assignments',
    tag: 'Garden',
    level: 'staff',
    input: VocabAssignmentInput,
    row: c.VocabAssignmentRow,
    entity: 'vocabulary assignment',
    listQuery: [{ name: 'classId', in: 'query', description: 'Restrict to one class.' }],
    // createAssignment returns the bare id; update and delete return void.
    createResult: c.IdAck,
    updateResult: c.IdAck,
  }),
];

/* ── Materials ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The upload body. Every `MaterialInput` field arrives as a form field beside the file, so this
 * cannot come from the Zod schema — a `File` has no Zod representation.
 */
const materialMultipart: Record<string, unknown> = {
  type: 'object',
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'The document itself. Omit for a link-type material. 20 MB maximum.',
    },
    title: { type: 'string', maxLength: 200 },
    type: { type: 'string', enum: ['notes', 'worksheet', 'video', 'link', 'curriculum'] },
    url: { type: 'string', maxLength: 2000 },
    fileName: { type: 'string', maxLength: 500 },
    favorite: { type: 'string', enum: ['true', 'false'] },
    addedAt: { type: 'string' },
  },
  required: ['title'],
};

const materials: PathDoc[] = [
  {
    path: '/api/materials',
    routePattern: 'api/materials/:id?',
    tag: 'Materials',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'List materials',
        responses: { 200: ok(z.array(c.MaterialRow), 'Every material.') },
      },
      {
        method: 'post',
        auth: 'staff',
        summary: 'Add a material, with or without a file',
        description:
          'Accepts `multipart/form-data` with a `file` part, or a plain JSON body for a ' +
          'link-type material. The size check runs before validation, so an oversized upload ' +
          'is a 413 whatever else the body says. A zero-byte part counts as no file.',
        request: { contentType: 'multipart/form-data', rawBody: materialMultipart },
        responses: {
          200: ok(c.MaterialRow, 'The stored material, including its R2 `fileKey`.'),
          413: err('file_too_large', 'over the 20 MB cap'),
        },
      },
    ],
  },
  {
    path: '/api/materials/{id}',
    routePattern: 'api/materials/:id?',
    tag: 'Materials',
    operations: [
      {
        method: 'patch',
        auth: 'staff',
        summary: 'Update a material, optionally replacing its file',
        params: [idParam()],
        request: { contentType: 'multipart/form-data', rawBody: materialMultipart },
        responses: {
          200: ok(c.MaterialRow, 'The material after the change.'),
          400: err('missing_id'),
          413: err('file_too_large'),
        },
      },
      {
        method: 'delete',
        auth: 'staff',
        summary: 'Delete a material and its stored file',
        params: [idParam()],
        responses: { 200: ok(c.IdAck, 'The id that was removed.'), 400: err('missing_id') },
      },
    ],
  },
];

/* ── Config reordering ─────────────────────────────────────────────────────────────────────── */

const reorder = (path: string, routePattern: string, schema: z.ZodType, what: string): PathDoc => ({
  path,
  routePattern,
  tag: 'Config',
  operations: [
    {
      method: 'post',
      auth: 'admin',
      summary: `Reorder ${what}`,
      description: 'Send every id in the order you want; positions are rewritten to match.',
      request: { schema },
      responses: { 200: ok(c.OkAck, 'Reordered.') },
    },
  ],
});

const reorders: PathDoc[] = [
  reorder(
    '/api/assessment-types/reorder',
    'api/assessment-types/reorder',
    AssessmentTypeReorder,
    'assessment types',
  ),
  reorder(
    '/api/remark-criteria/reorder',
    'api/remark-criteria/reorder',
    RemarkCriteriaReorder,
    'remark criteria',
  ),
  reorder(
    '/api/grade-levels/reorder',
    'api/grade-levels/reorder',
    GradeLevelReorder,
    'grade levels',
  ),
];

/* ── Scheduling ────────────────────────────────────────────────────────────────────────────── */

const scheduling: PathDoc[] = [
  {
    path: '/api/attendance',
    routePattern: 'api/attendance',
    tag: 'Scheduling',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'Attendance for one occurrence',
        params: [
          { name: 'eventId', in: 'query', required: true },
          { name: 'date', in: 'query', required: true, description: 'ICT `YYYY-MM-DD`.' },
        ],
        responses: {
          200: ok(z.array(c.AttendanceRow), 'One row per marked student.'),
          400: err('missing_event_or_date'),
        },
      },
      {
        method: 'post',
        auth: 'staff',
        summary: 'Replace attendance for one occurrence',
        description:
          'The whole occurrence is rewritten from `records`: a student left out is unmarked, not ' +
          'left as they were.',
        request: { schema: AttendanceSaveInput },
        responses: { 200: ok(z.array(c.AttendanceRow), 'The occurrence as it now stands.') },
      },
    ],
  },
  {
    path: '/api/event-materials',
    routePattern: 'api/event-materials',
    tag: 'Scheduling',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'Which materials are attached to which sessions',
        description:
          'With `?eventId=` the reply is that event’s material ids; without it, every link ' +
          'in the school as `{ eventId, materialId }` pairs.',
        params: [{ name: 'eventId', in: 'query' }],
        responses: { 200: ok(c.EventMaterialLinks, 'Ids, or pairs — see the description.') },
      },
      {
        method: 'post',
        auth: 'staff',
        summary: "Replace one event's material links",
        request: { schema: EventMaterialsSaveInput },
        responses: { 200: ok(z.array(z.string()), 'The material ids now attached.') },
      },
    ],
  },
  {
    path: '/api/class-materials',
    routePattern: 'api/class-materials',
    tag: 'Scheduling',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'Which materials belong to which classes',
        description:
          'With `?classId=` the reply is that class’s material ids; without it, every link in ' +
          'the school as `{ classId, materialId }` pairs. Materials are a shared library — one ' +
          'material may belong to any number of classes, and to events besides.',
        params: [{ name: 'classId', in: 'query' }],
        responses: { 200: ok(c.ClassMaterialLinks, 'Ids, or pairs — see the description.') },
      },
      {
        method: 'post',
        auth: 'staff',
        summary: "Replace one class's material links",
        description:
          'Replace-set: the ids you send become that class’s whole set. Other classes keep ' +
          'their own links to the same material.',
        request: { schema: ClassMaterialsSaveInput },
        responses: { 200: ok(z.array(z.string()), 'The material ids now attached.') },
      },
    ],
  },
  {
    path: '/api/event-previews',
    routePattern: 'api/event-previews',
    tag: 'Scheduling',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'The "nhắc buổi sau" note for one occurrence',
        params: [
          { name: 'eventId', in: 'query', required: true },
          { name: 'date', in: 'query', required: true, description: 'ICT `YYYY-MM-DD`.' },
        ],
        responses: {
          200: ok(c.SessionPreviewPayload, '`preview` is null when nobody has written one.'),
          400: err('missing_event_or_date'),
        },
      },
      {
        method: 'post',
        auth: 'staff',
        summary: 'Write the note for one occurrence',
        request: { schema: SessionPreviewInput },
        responses: { 200: ok(c.SessionPreviewRow, 'The saved note.') },
      },
    ],
  },
  {
    path: '/api/my-sessions',
    routePattern: 'api/my-sessions',
    tag: 'Scheduling',
    operations: [
      {
        method: 'get',
        auth: 'user',
        summary: "The caller's upcoming sessions, with previews composed",
        description:
          'Students see their own classes, staff see every class. Capped at 30 items. Compare ' +
          'dates against `serverNow`, never the device clock.',
        params: [
          {
            name: 'days',
            in: 'query',
            description: 'How far ahead to look. Default 7, clamped to 1–14; junk falls back to 7.',
            schema: z.coerce.number().int().min(1).max(14),
          },
        ],
        responses: { 200: ok(c.MySessionsResponse, 'The window, newest first.') },
      },
    ],
  },
];

/* ── Vocabulary ────────────────────────────────────────────────────────────────────────────── */

const vocabulary: PathDoc[] = [
  {
    path: '/api/flashcards/topic/{slug}',
    routePattern: 'api/flashcards/topic/:slug',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'get',
        auth: 'user',
        summary: 'One topic and everything needed to play it offline',
        description:
          'Accepts a slug or an id, so topics predating slugs still resolve. `mastery` is empty ' +
          'for staff: a teacher testing a topic must not pollute student stats.',
        params: [idParam('slug', 'The topic slug, or its id.')],
        responses: {
          200: ok(c.TopicBundle, 'The topic, its words, recent results and the caller’s mastery.'),
          400: err('missing_slug'),
          404: err('not_found'),
        },
      },
    ],
  },
  {
    path: '/api/flashcards/words',
    routePattern: 'api/flashcards/words/:id?',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: "One topic's words",
        params: [{ name: 'topicId', in: 'query', required: true }],
        responses: {
          200: ok(z.array(c.FlashcardWordRow), 'Every word in the topic.'),
          400: err('missing_topic_id'),
        },
      },
      {
        method: 'post',
        auth: 'staff',
        summary: 'Add a word to a topic',
        params: [{ name: 'topicId', in: 'query', required: true }],
        request: { schema: FlashcardWordInput },
        responses: {
          200: ok(z.array(c.FlashcardWordRow), 'The topic’s words after the insert.'),
          400: err('missing_topic_id'),
        },
      },
    ],
  },
  {
    path: '/api/flashcards/words/{id}',
    routePattern: 'api/flashcards/words/:id?',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'patch',
        auth: 'staff',
        summary: 'Edit a word',
        params: [idParam()],
        request: { schema: FlashcardWordInput, patch: true },
        responses: { 200: ok(c.OkAck, 'Saved.'), 400: err('missing_id') },
      },
      {
        method: 'delete',
        auth: 'staff',
        summary: 'Delete a word',
        params: [idParam()],
        responses: { 200: ok(c.IdAck, 'The id that was removed.'), 400: err('missing_id') },
      },
    ],
  },
  {
    path: '/api/flashcards/import',
    routePattern: 'api/flashcards/import',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'post',
        auth: 'staff',
        summary: 'Bulk-add words to a topic',
        params: [{ name: 'topicId', in: 'query', required: true }],
        request: { schema: FlashcardImportInput },
        responses: {
          200: ok(c.FlashcardImportResult, 'How many words were written.'),
          400: err('missing_topic_id'),
        },
      },
    ],
  },
  {
    path: '/api/flashcards/generate-topic',
    routePattern: 'api/flashcards/generate-topic',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'post',
        auth: 'staff',
        summary: 'Create a topic and its words in one call',
        description: 'Not nested under `topics/`: that route’s `:id?` would swallow this segment.',
        request: { schema: FlashcardTopicWithWordsInput },
        responses: { 200: ok(c.TopicInfo, 'The new topic, freshly slugged.') },
      },
    ],
  },
  {
    path: '/api/flashcards/results',
    routePattern: 'api/flashcards/results',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'post',
        auth: 'user',
        summary: 'Record finished rounds',
        description:
          'Takes 1–50 rounds so an offline queue can flush in one call. Send a `clientId` per ' +
          'round and a replayed flush becomes a no-op: an already-seen round is skipped, its ' +
          'plant is not grown twice, and it comes back with `garden: null`. Correlate the reply ' +
          'by `clientId`, NOT by position. Staff plays never touch the garden or mastery.',
        request: { schema: FlashcardResultBatch },
        responses: { 200: ok(c.FlashcardResultsResponse, 'What was written, and what each did.') },
      },
    ],
  },
  {
    path: '/api/flashcards/stats',
    routePattern: 'api/flashcards/stats',
    tag: 'Vocabulary',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'Recent results for a topic, or per-student totals',
        description:
          'With `?topicId=` the reply is that topic’s last 30 rounds; without it, one row per ' +
          'student aggregated across every topic.',
        params: [{ name: 'topicId', in: 'query' }],
        responses: {
          200: ok(
            z.union([z.array(c.FlashcardResultRow), z.array(c.StudentFlashcardStats)]),
            'Rounds, or per-student totals — see the description.',
          ),
        },
      },
    ],
  },
];

/* ── Garden ────────────────────────────────────────────────────────────────────────────────── */

const garden: PathDoc[] = [
  {
    path: '/api/garden/plant',
    routePattern: 'api/garden/plant',
    tag: 'Garden',
    operations: [
      {
        method: 'get',
        auth: 'user',
        summary: "A student's plant, already settled",
        description:
          'Wilt and drops are applied server-side before the reply, so the client never computes ' +
          'them. Measure every date against `today`, which is the server’s ICT day.',
        params: [
          {
            name: 'studentId',
            in: 'query',
            description: 'Staff only. Students always get their own plant.',
          },
        ],
        responses: {
          200: ok(c.GardenPlantResponse, 'The plant, its assignments and the garden settings.'),
          400: err('missing_student', 'a staff caller passed no `?studentId=`'),
          403: err('forbidden', 'a non-staff caller passed `?studentId=`'),
        },
      },
      {
        method: 'patch',
        auth: 'user',
        summary: 'Rename or re-pot your own plant',
        description: 'Students only. An empty `plantName` means "unnamed", not the empty string.',
        request: { schema: PlantPatchInput, patch: true },
        responses: {
          200: ok(c.GardenPlantResponse, 'The plant after the change.'),
          403: err('forbidden', 'the caller is not a student'),
          405: err('method_not_allowed', 'only PATCH is served here'),
        },
      },
    ],
  },
  {
    path: '/api/garden/harvest',
    routePattern: 'api/garden/harvest',
    tag: 'Garden',
    operations: [
      {
        method: 'post',
        auth: 'user',
        summary: 'Harvest a ripe plant',
        description:
          'Students only, and only at the final stage. A double tap collides on the fruit ' +
          'ordinal index and comes back `not_ripe` rather than banking twice.',
        responses: {
          200: ok(c.HarvestResult, 'Harvested; the new lifetime total.'),
          403: err('forbidden', 'the caller is not a student'),
          409: err('not_ripe` / `dead', 'nothing to harvest'),
        },
      },
    ],
  },
  {
    path: '/api/garden/class/{id}',
    routePattern: 'api/garden/class/:id',
    tag: 'Garden',
    operations: [
      {
        method: 'get',
        auth: 'user',
        summary: "One class's shared garden",
        description:
          'Students may only read a class they belong to. Members come ordered by name — never ' +
          're-sort them, this is a garden, not a leaderboard.',
        params: [idParam('id', 'The class id.')],
        responses: {
          200: ok(c.ClassGardenResponse, 'Every plant, plus the tree they grew together.'),
          400: err('missing_id'),
          403: err('forbidden', 'the student is not in this class'),
          404: err('not_found'),
        },
      },
    ],
  },
  {
    path: '/api/garden/water',
    routePattern: 'api/garden/water',
    tag: 'Garden',
    operations: [
      {
        method: 'post',
        auth: 'staff',
        summary: "Water a student's plant",
        description: 'A teacher’s nudge. Exempt from the daily growth cap; the note is audited.',
        request: { schema: WaterInput },
        responses: { 200: ok(c.WaterResult, 'The stage after watering.') },
      },
    ],
  },
  {
    path: '/api/garden/progress/{id}',
    routePattern: 'api/garden/progress/:id',
    tag: 'Garden',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'Who has finished one assignment',
        description: 'Not nested under `assignments/`: that route’s `:id?` would swallow it.',
        params: [idParam('id', 'The assignment id.')],
        responses: {
          200: ok(c.AssignmentProgress, 'The assignment and each student’s count.'),
          400: err('missing_id'),
          404: err('not_found'),
        },
      },
    ],
  },
  {
    path: '/api/garden/month/{id}',
    routePattern: 'api/garden/month/:id',
    tag: 'Garden',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: "One student's garden month, for the report card",
        description:
          'Never 404s: a student with no activity gets the zeroed shape. The cookie-authenticated ' +
          'twin the web report uses is `/garden-month`.',
        params: [
          idParam('id', 'The student id.'),
          { name: 'month', in: 'query', required: true, schema: TuitionMonth },
        ],
        responses: {
          200: ok(c.GardenMonthSummary, 'The month’s tally and the plant as it stands.'),
          400: err('missing_id` / `bad_month'),
        },
      },
    ],
  },
  {
    path: '/api/garden/snapshots',
    routePattern: 'api/garden/snapshots',
    tag: 'Garden',
    operations: [
      {
        method: 'get',
        auth: 'user',
        summary: 'The month-end album: saved months, or one frozen month',
        description:
          'Without `?month=` the reply is the index of saved months, newest first; with it, that ' +
          'month exactly as it was frozen. An empty `month=` counts as absent.',
        params: [
          { name: 'classId', in: 'query', required: true },
          { name: 'month', in: 'query', schema: TuitionMonth },
        ],
        responses: {
          200: ok(
            z.union([c.GardenSnapshotIndex, c.GardenSnapshotResponse]),
            'The index, or one frozen month — see the description.',
          ),
          400: err('missing_class'),
          403: err('forbidden', 'the student is not in this class'),
          404: err('not_found', 'no snapshot for that month'),
        },
      },
    ],
  },
];

/* ── Settings ──────────────────────────────────────────────────────────────────────────────── */

const settings: PathDoc[] = [
  {
    path: '/api/settings/theme',
    routePattern: 'api/settings/theme',
    tag: 'Settings',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'Your calendar theme',
        description: 'Per account. Falls back to the school-wide theme until you change something.',
        responses: { 200: ok(c.ThemeRow, 'Every colour, settled.') },
      },
      {
        method: 'patch',
        auth: 'staff',
        summary: 'Change your calendar theme',
        description:
          'A null field means "leave this one alone"; it is stripped before saving. Saves ' +
          'against the calling account only.',
        request: { schema: ThemeInput, patch: true },
        responses: { 200: ok(c.ThemeRow, 'The merged theme.') },
      },
    ],
  },
  {
    path: '/api/settings/ui-prefs',
    routePattern: 'api/settings/ui-prefs',
    tag: 'Settings',
    operations: [
      {
        method: 'get',
        auth: 'any',
        summary: 'Scrollbar and tab-bar styles',
        description:
          'Readable by everyone — the phone needs it to draw its tab bar. Answers with what ' +
          'the CALLER should apply: their own override if they have one, otherwise the school ' +
          'default.',
        responses: { 200: ok(c.UiPrefs, 'Both styles, settled.') },
      },
      {
        method: 'patch',
        auth: 'admin',
        summary: 'Change the school-wide UI styles',
        description:
          'Sets the default every account sees until it overrides it. Admin-only because the ' +
          'blast radius is the whole school; for a personal override use ' +
          '`/api/settings/ui-prefs/me`.',
        request: { schema: UiPrefsInput, patch: true },
        responses: { 200: ok(c.UiPrefs, 'The merged prefs.') },
      },
    ],
  },
  {
    path: '/api/settings/ui-prefs/me',
    routePattern: 'api/settings/ui-prefs/me',
    tag: 'Settings',
    operations: [
      {
        method: 'patch',
        auth: 'any',
        summary: 'Override the UI styles for yourself',
        description:
          'Stores a personal override that wins over the school default. Open to any signed-in ' +
          'account because the blast radius is one account. Read it back from ' +
          '`GET /api/settings/ui-prefs`, which already resolves the override.',
        request: { schema: UiPrefsInput, patch: true },
        responses: { 200: ok(c.UiPrefs, 'The merged prefs, as they now apply to you.') },
      },
      {
        method: 'delete',
        auth: 'any',
        summary: 'Follow the school default again',
        description:
          'Removes the override rather than copying the current school values into it, so ' +
          'later changes to the school default keep reaching you.',
        responses: { 200: ok(c.UiPrefs, 'The school default, now in force for you.') },
      },
    ],
  },
  {
    path: '/api/settings/notifications',
    routePattern: 'api/settings/notifications',
    tag: 'Settings',
    operations: [
      {
        method: 'get',
        auth: 'any',
        summary: 'What the cron jobs may send',
        responses: { 200: ok(c.NotifPrefs, 'Every switch, settled.') },
      },
      {
        method: 'patch',
        auth: 'any',
        summary: 'Change notification preferences',
        request: { schema: NotifPrefsInput, patch: true },
        responses: { 200: ok(c.NotifPrefs, 'The merged prefs.') },
      },
    ],
  },
  {
    path: '/api/settings/garden',
    routePattern: 'api/settings/garden',
    tag: 'Settings',
    operations: [
      {
        method: 'get',
        auth: 'admin',
        summary: 'Garden tuning',
        responses: { 200: ok(c.GardenSettings, 'The four dials.') },
      },
      {
        method: 'put',
        auth: 'admin',
        summary: 'Replace the garden tuning',
        description:
          'Replaces rather than merges, so send all four fields. POST does the same thing; ' +
          'PATCH and DELETE are 405.',
        request: { schema: GardenSettingsInput },
        responses: {
          200: ok(c.GardenSettings, 'The settings as stored.'),
          405: err('method_not_allowed', 'only PUT and POST save'),
        },
      },
    ],
  },
  {
    path: '/api/settings/parent-portal',
    routePattern: 'api/settings/parent-portal',
    tag: 'Settings',
    operations: [
      {
        method: 'get',
        auth: 'any',
        summary: 'Whether the parent portal is switched on',
        description:
          'Readable by everyone: the phone hides the Children tab on this flag before it ever ' +
          'calls `/api/parent/*`.',
        responses: { 200: ok(c.ParentPortalSettings, 'The school-wide switch.') },
      },
      {
        method: 'patch',
        auth: 'admin',
        summary: 'Switch the parent portal on or off',
        request: { schema: ParentPortalInput, patch: true },
        responses: { 200: ok(c.ParentPortalSettings, 'The switch as stored.') },
      },
    ],
  },
];

/* ── Parent portal ─────────────────────────────────────────────────────────────────────────── */

/**
 * Every one of these is parents-only — staff and students get 403 — and every one first asks
 * whether the portal is switched on and whether the child in the path is actually theirs.
 * Both answers come back as the same bare `forbidden`, on purpose.
 */
const parent: PathDoc[] = [
  {
    path: '/api/parent/home',
    routePattern: 'api/parent/home',
    tag: 'Parent portal',
    operations: [
      {
        method: 'get',
        auth: 'parent',
        summary: 'Every child and their week, in one round trip',
        params: [
          {
            name: 'days',
            in: 'query',
            description: 'Default 7, clamped to 1–14; junk falls back to 7.',
            schema: z.coerce.number().int().min(1).max(14),
          },
        ],
        responses: { 200: ok(c.ParentHomeResponse, 'The children and their upcoming sessions.') },
      },
    ],
  },
  {
    path: '/api/parent/attendance/{studentId}',
    routePattern: 'api/parent/attendance/:studentId',
    tag: 'Parent portal',
    operations: [
      {
        method: 'get',
        auth: 'parent',
        summary: "One child's attendance for a month",
        params: [
          idParam('studentId'),
          {
            name: 'month',
            in: 'query',
            schema: TuitionMonth,
            description: 'Defaults to the current ICT month.',
          },
        ],
        responses: {
          200: ok(c.ParentAttendanceResponse, 'The month, newest first.'),
          400: err('missing_id` / `bad_month'),
        },
      },
    ],
  },
  {
    path: '/api/parent/report/{studentId}/{month}',
    routePattern: 'api/parent/report/:studentId/:month',
    tag: 'Parent portal',
    operations: [
      {
        method: 'get',
        auth: 'parent',
        summary: "One child's monthly report",
        description:
          'The same payload the printable slip renders. `garden` and `homework` degrade to null ' +
          'and `[]` rather than failing the request.',
        params: [idParam('studentId'), idParam('month', 'ICT `YYYY-MM`.')],
        responses: {
          200: ok(c.ParentReportResponse, 'The report card.'),
          400: err('missing_id` / `bad_month'),
          404: err('unknown_student'),
        },
      },
    ],
  },
  {
    path: '/api/parent/tuition/{studentId}/{month}',
    routePattern: 'api/parent/tuition/:studentId/:month',
    tag: 'Parent portal',
    operations: [
      {
        method: 'get',
        auth: 'parent',
        summary: "One child's fee slip",
        description:
          'A month nobody has billed comes back as a zeroed slip, not a 404. `isClosed` means the ' +
          'amounts are frozen.',
        params: [idParam('studentId'), idParam('month', 'ICT `YYYY-MM`.')],
        responses: {
          200: ok(c.ParentTuitionResponse, 'The slip.'),
          400: err('missing_id` / `bad_month'),
          404: err('unknown_student'),
        },
      },
    ],
  },
];

/* ── Push ──────────────────────────────────────────────────────────────────────────────────── */

const push: PathDoc[] = [
  {
    path: '/api/push/register',
    routePattern: 'api/push/register',
    tag: 'Push',
    operations: [
      {
        method: 'post',
        auth: 'any',
        summary: 'Register this device for push',
        request: { schema: PushRegisterInput },
        responses: { 200: ok(c.OkAck, 'Registered.') },
      },
    ],
  },
  {
    path: '/api/push/unregister',
    routePattern: 'api/push/unregister',
    tag: 'Push',
    operations: [
      {
        method: 'post',
        auth: 'any',
        summary: 'Stop pushing to this device',
        description: 'Keyed on the token alone. `platform` is accepted but ignored.',
        request: { schema: PushRegisterInput },
        responses: { 200: ok(c.OkAck, 'Unregistered.') },
      },
    ],
  },
  {
    path: '/api/push/run',
    routePattern: 'api/push/run',
    tag: 'Push',
    operations: [
      {
        method: 'post',
        auth: 'admin',
        summary: 'Run a notification job now',
        description: 'The manual trigger for what the cron schedule does on its own.',
        params: [
          {
            name: 'job',
            in: 'query',
            required: true,
            schema: z.enum(['class', 'digest', 'preview', 'garden']),
          },
        ],
        responses: {
          200: ok(c.PushRunResult, 'How many notifications went out.'),
          400: err('bad_job', 'missing or not one of the four'),
        },
      },
    ],
  },
];

/* ── Zalo ──────────────────────────────────────────────────────────────────────────────────── */

const zalo: PathDoc[] = [
  {
    path: '/api/zalo/webhook',
    routePattern: 'api/zalo/webhook',
    tag: 'Zalo',
    operations: [
      {
        method: 'post',
        auth: 'webhook-secret',
        summary: 'Receive an update from the Zalo bot',
        description:
          'The only unauthenticated write in the API. Gated on `X-Bot-Api-Secret-Token`, compared ' +
          'in constant time; an unset secret rejects everything rather than letting anything ' +
          'through. Always answers `ok` once the secret matches — including for a body it cannot ' +
          'parse — so Zalo does not retry. Handler failures are logged, never surfaced.',
        responses: {
          200: ok(c.OkAck, 'Accepted (or accepted and dropped).'),
          401: err('unauthorized', 'the secret header is missing or wrong'),
          503: err('zalo_webhook_unconfigured', 'no secret is set, so the endpoint fails closed'),
        },
      },
    ],
  },
  {
    path: '/api/zalo/pair',
    routePattern: 'api/zalo/pair',
    tag: 'Zalo',
    operations: [
      {
        method: 'get',
        auth: 'staff',
        summary: 'Linked chats and codes still outstanding',
        responses: { 200: ok(c.ZaloPairList, 'Links and pending codes.') },
      },
      {
        method: 'post',
        auth: 'staff',
        summary: 'Mint a pairing code',
        description:
          'Six characters, no ambiguous glyphs, good for 24 hours. Whoever sends it to the bot ' +
          'gets that chat linked to the target.',
        request: { schema: ZaloPairInput },
        responses: {
          200: ok(c.ZaloPairCode, 'The code and when it expires.'),
          405: err('method_not_allowed', 'only POST and DELETE are served'),
        },
      },
      {
        method: 'delete',
        auth: 'staff',
        summary: 'Unlink a chat',
        params: [{ name: 'id', in: 'query', required: true, description: 'The link id.' }],
        responses: { 200: ok(c.OkAck, 'Unlinked.'), 400: err('missing_id') },
      },
    ],
  },
  {
    path: '/api/zalo/admin',
    routePattern: 'api/zalo/admin',
    tag: 'Zalo',
    operations: [
      {
        method: 'get',
        auth: 'admin',
        summary: 'Inspect the bot: identity, webhook, poller',
        description: 'The GET and POST op sets are disjoint — `?op=me` on POST is a `bad_op`.',
        params: [
          {
            name: 'op',
            in: 'query',
            required: true,
            schema: z.enum(['me', 'webhook-info', 'poll-status']),
          },
        ],
        responses: {
          200: ok(
            z.union([c.ZaloBotResult, c.ZaloPollStatus]),
            'The bot’s answer, or the poller’s counters for `poll-status`.',
          ),
          400: err('bad_op'),
          503: err('zalo_disabled', 'the integration is switched off in this environment'),
        },
      },
      {
        method: 'post',
        auth: 'admin',
        summary: 'Drive the bot: webhook and poller',
        description:
          'Webhook and polling are alternatives, not companions — `poll-start` deletes the ' +
          'webhook first.',
        params: [
          {
            name: 'op',
            in: 'query',
            required: true,
            schema: z.enum(['set-webhook', 'delete-webhook', 'poll-start', 'poll-stop']),
          },
        ],
        responses: {
          200: ok(
            z.union([c.ZaloBotResult, c.ZaloSetWebhookResult, c.ZaloPollStartResult, c.OkAck]),
            'Depends on the op — see the description.',
          ),
          400: err('bad_op'),
          503: err('zalo_disabled` / `missing_webhook_secret'),
        },
      },
    ],
  },
];

/* ── The whole surface ─────────────────────────────────────────────────────────────────────── */

export const registry: PathDoc[] = [
  ...auth,
  ...app,
  ...collections,
  ...materials,
  ...reorders,
  ...scheduling,
  ...vocabulary,
  ...garden,
  ...settings,
  ...parent,
  ...push,
  ...zalo,
];

/** Tag order in the rendered sidebar. Anything unlisted falls to the end, alphabetically. */
export const TAGS: { name: string; description: string }[] = [
  {
    name: 'Auth',
    description:
      'Sessions are per-device and last 90 days, sliding forward on use. Signup is invite-only, ' +
      'and changing a password evicts every other session.',
  },
  {
    name: 'App',
    description: 'The calls a client makes about itself: cold start, dashboard, own profile.',
  },
  { name: 'Events', description: 'The calendar. One row per event, recurrence included.' },
  {
    name: 'People & classes',
    description: 'The roster — students, staff, parents, classes, and the codes that create them.',
  },
  {
    name: 'Scheduling',
    description:
      'What happens at a session: who attended, which materials were used, and the note for ' +
      'the next one. Keyed by (eventId, date), because one event has many occurrences.',
  },
  {
    name: 'Materials',
    description: 'Documents and links, with the only file upload in the API.',
  },
  {
    name: 'Assessments',
    description:
      'Scores, behaviour records and the monthly remark that feeds the printable report card.',
  },
  {
    name: 'Vocabulary',
    description:
      'Topics, words, and the games played on them. Built to work offline: one call fetches ' +
      'everything a topic needs, and finished rounds replay idempotently.',
  },
  {
    name: 'Garden',
    description:
      'Vườn cây từ vựng — the plant a student grows by playing. Wilt and stage drops are settled ' +
      'server-side before every read, so a client never computes them and never uses its own clock.',
  },
  {
    name: 'Parent portal',
    description:
      'Parents only, and only for their own children. Every call also checks the school-wide ' +
      'toggle; both failures look the same from outside.',
  },
  { name: 'Settings', description: 'School-wide preferences. Mostly admin-write, wider-read.' },
  { name: 'Config', description: 'The managed lists other records point at, and their ordering.' },
  { name: 'Push', description: 'Device registration, and the manual trigger for each cron job.' },
  {
    name: 'Zalo',
    description:
      'The bot channel families actually read. The webhook is the only unauthenticated write in ' +
      'the API — it is gated on a shared secret instead.',
  },
];
