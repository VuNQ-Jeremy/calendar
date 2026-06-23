// Mochi API Worker
//
// Serves the built SPA (Workers Static Assets, via the ASSETS binding) and a
// JSON API backed by D1 (the DB binding). The API mirrors the client store's
// shape so src/store.js can later swap its localStorage calls for fetch():
//
//   GET    /api/state            → full denormalized snapshot (all collections + theme)
//   POST   /api/:collection      → create an item, returns it (server assigns id)
//   PATCH  /api/:collection/:id  → patch an item, returns it
//   DELETE /api/:collection/:id  → delete an item
//   GET    /api/theme            → calendar theme
//   PUT    /api/theme            → merge-patch the calendar theme
//
// Collections: classes, students, users (staff), parents, events, homework,
// materials, invites.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const fail = (message, status = 400) => json({ error: message }, status);
const newId = () => crypto.randomUUID();

const DEFAULT_THEME = {
  bg: '#FFFCF8', gridLine: '#ECE0CF', today: '#FFE7D1', header: '#FDF6EC', bgImage: '', bgOpacity: 0.12,
};

// Per-collection mapping: table + scalar [field, column] pairs + boolean fields.
const COLLECTIONS = {
  classes:   { table: 'classes',  scal: [['name', 'name'], ['subject', 'subject'], ['color', 'color'], ['room', 'room']] },
  students:  { table: 'students', scal: [['name', 'name'], ['grade', 'grade'], ['guardian', 'guardian'], ['email', 'email'], ['color', 'color']] },
  users:     { table: 'staff',    scal: [['name', 'name'], ['email', 'email'], ['role', 'role'], ['color', 'color'], ['phone', 'phone']] },
  parents:   { table: 'parents',  scal: [['name', 'name'], ['email', 'email'], ['phone', 'phone'], ['color', 'color'], ['relation', 'relation']] },
  events:    { table: 'events',   scal: [['title', 'title'], ['date', 'date'], ['start', 'start_time'], ['end', 'end_time'], ['color', 'color'], ['classId', 'class_id'], ['location', 'location'], ['recurrence', 'recurrence']] },
  homework:  { table: 'homework', scal: [['title', 'title'], ['classId', 'class_id'], ['due', 'due'], ['points', 'points'], ['notes', 'notes'], ['color', 'color'], ['done', 'done']], bools: ['done'] },
  materials: { table: 'materials', scal: [['title', 'title'], ['type', 'type'], ['classId', 'class_id'], ['url', 'url'], ['fileName', 'file_name'], ['favorite', 'favorite'], ['addedAt', 'added_at']], bools: ['favorite'] },
  invites:   { table: 'invites',  scal: [['code', 'code'], ['role', 'role'], ['name', 'name'], ['classId', 'class_id'], ['createdAt', 'created_at'], ['used', 'used']], bools: ['used'] },
  feedback:  { table: 'feedback', scal: [['message', 'message'], ['category', 'category'], ['author', 'author'], ['status', 'status'], ['createdAt', 'created_at']] },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return fail(String((e && e.message) || e), 500);
      }
    }
    // Everything else → static SPA assets (with single-page-app fallback).
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', collection, id?]
  const collection = parts[1];
  const id = parts[2];
  const method = request.method;

  if (collection === 'state' && method === 'GET') return json(await getState(env));

  if (collection === 'theme') {
    if (method === 'GET') return json(await getTheme(env));
    if (method === 'PUT') return json(await setTheme(env, await request.json()));
    return fail('Method not allowed', 405);
  }

  const cfg = COLLECTIONS[collection];
  if (!cfg) return fail(`Unknown collection: ${collection}`, 404);

  if (method === 'POST') return json(await createItem(env, collection, cfg, await request.json()), 201);
  if (method === 'PATCH') {
    if (!id) return fail('Missing id');
    return json(await updateItem(env, collection, cfg, id, await request.json()));
  }
  if (method === 'DELETE') {
    if (!id) return fail('Missing id');
    await deleteItem(env, collection, cfg, id);
    return json({ ok: true });
  }
  return fail('Method not allowed', 405);
}

// ---- value coercion ---------------------------------------------------------

function toDb(field, value, cfg) {
  if (value === undefined) return null;
  if (cfg.bools && cfg.bools.includes(field)) return value ? 1 : 0;
  return value === '' && (field === 'classId') ? null : value;
}

const rows = async (env, sql, ...binds) =>
  ((await env.DB.prepare(sql).bind(...binds).all()).results) || [];
const one = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
const run = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).run();

// ---- reads ------------------------------------------------------------------

async function getState(env) {
  const [
    classRows, scheduleRows, classStudentRows, studentRows, staffRows,
    parentRows, parentStudentRows, eventRows, homeworkRows, materialRows, inviteRows, feedbackRows,
  ] = await Promise.all([
    rows(env, 'SELECT * FROM classes'),
    rows(env, 'SELECT * FROM class_schedule ORDER BY id'),
    rows(env, 'SELECT * FROM class_students'),
    rows(env, 'SELECT * FROM students'),
    rows(env, 'SELECT * FROM staff'),
    rows(env, 'SELECT * FROM parents'),
    rows(env, 'SELECT * FROM parent_students'),
    rows(env, 'SELECT * FROM events'),
    rows(env, 'SELECT * FROM homework'),
    rows(env, 'SELECT * FROM materials'),
    rows(env, 'SELECT * FROM invites'),
    rows(env, 'SELECT * FROM feedback ORDER BY created_at DESC'),
  ]);

  const group = (list, keyField, valField) => {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r[keyField])) m.set(r[keyField], []);
      m.get(r[keyField]).push(r[valField]);
    }
    return m;
  };
  const studentsByClass = group(classStudentRows, 'class_id', 'student_id');
  const classesByStudent = group(classStudentRows, 'student_id', 'class_id');
  const studentsByParent = group(parentStudentRows, 'parent_id', 'student_id');
  const scheduleByClass = new Map();
  for (const s of scheduleRows) {
    if (!scheduleByClass.has(s.class_id)) scheduleByClass.set(s.class_id, []);
    scheduleByClass.get(s.class_id).push({ day: s.day, start: s.start_time, end: s.end_time });
  }

  return {
    classes: classRows.map((c) => ({
      id: c.id, name: c.name, subject: c.subject, color: c.color, room: c.room,
      schedule: scheduleByClass.get(c.id) || [], studentIds: studentsByClass.get(c.id) || [],
    })),
    students: studentRows.map((s) => ({
      id: s.id, name: s.name, grade: s.grade, guardian: s.guardian, email: s.email, color: s.color,
      classIds: classesByStudent.get(s.id) || [],
    })),
    users: staffRows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, phone: u.phone })),
    parents: parentRows.map((p) => ({
      id: p.id, name: p.name, email: p.email, phone: p.phone, color: p.color, relation: p.relation,
      studentIds: studentsByParent.get(p.id) || [],
    })),
    events: eventRows.map(mapEvent),
    homework: homeworkRows.map(mapHomework),
    materials: materialRows.map(mapMaterial),
    invites: inviteRows.map(mapInvite),
    feedback: feedbackRows.map(mapFeedback),
    theme: await getTheme(env),
  };
}

const mapEvent = (e) => ({ id: e.id, title: e.title, date: e.date, start: e.start_time, end: e.end_time, color: e.color, classId: e.class_id, location: e.location, recurrence: e.recurrence });
const mapHomework = (h) => ({ id: h.id, title: h.title, classId: h.class_id, due: h.due, points: h.points, notes: h.notes, color: h.color, done: !!h.done });
const mapMaterial = (m) => ({ id: m.id, title: m.title, type: m.type, classId: m.class_id, url: m.url, fileName: m.file_name, favorite: !!m.favorite, addedAt: m.added_at });
const mapInvite = (i) => ({ id: i.id, code: i.code, role: i.role, name: i.name, classId: i.class_id, createdAt: i.created_at, used: !!i.used });
const mapFeedback = (f) => ({ id: f.id, message: f.message, category: f.category, author: f.author, status: f.status, createdAt: f.created_at });

async function readItem(env, collection, cfg, id) {
  const row = await one(env, `SELECT * FROM ${cfg.table} WHERE id = ?`, id);
  if (!row) return null;
  if (collection === 'classes') {
    const sched = await rows(env, 'SELECT * FROM class_schedule WHERE class_id = ? ORDER BY id', id);
    const studs = await rows(env, 'SELECT student_id FROM class_students WHERE class_id = ?', id);
    return { id: row.id, name: row.name, subject: row.subject, color: row.color, room: row.room,
      schedule: sched.map((s) => ({ day: s.day, start: s.start_time, end: s.end_time })),
      studentIds: studs.map((s) => s.student_id) };
  }
  if (collection === 'students') {
    const cls = await rows(env, 'SELECT class_id FROM class_students WHERE student_id = ?', id);
    return { id: row.id, name: row.name, grade: row.grade, guardian: row.guardian, email: row.email, color: row.color, classIds: cls.map((c) => c.class_id) };
  }
  if (collection === 'parents') {
    const studs = await rows(env, 'SELECT student_id FROM parent_students WHERE parent_id = ?', id);
    return { id: row.id, name: row.name, email: row.email, phone: row.phone, color: row.color, relation: row.relation, studentIds: studs.map((s) => s.student_id) };
  }
  if (collection === 'users') return { id: row.id, name: row.name, email: row.email, role: row.role, color: row.color, phone: row.phone };
  if (collection === 'events') return mapEvent(row);
  if (collection === 'homework') return mapHomework(row);
  if (collection === 'materials') return mapMaterial(row);
  if (collection === 'invites') return mapInvite(row);
  if (collection === 'feedback') return mapFeedback(row);
  return row;
}

// ---- writes -----------------------------------------------------------------

async function createItem(env, collection, cfg, item) {
  const id = item.id || newId();
  const cols = ['id'];
  const vals = [id];
  for (const [field, col] of cfg.scal) { cols.push(col); vals.push(toDb(field, item[field], cfg)); }
  const placeholders = cols.map(() => '?').join(', ');
  await run(env, `INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${placeholders})`, ...vals);
  await writeRelations(env, collection, id, item);
  return readItem(env, collection, cfg, id);
}

async function updateItem(env, collection, cfg, id, patch) {
  const sets = [];
  const vals = [];
  for (const [field, col] of cfg.scal) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) { sets.push(`${col} = ?`); vals.push(toDb(field, patch[field], cfg)); }
  }
  if (sets.length) await run(env, `UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
  await writeRelations(env, collection, id, patch);
  return readItem(env, collection, cfg, id);
}

// Replace join-table rows when the relevant array is present on the payload.
async function writeRelations(env, collection, id, data) {
  if (collection === 'classes') {
    if (Array.isArray(data.schedule)) {
      await run(env, 'DELETE FROM class_schedule WHERE class_id = ?', id);
      for (const s of data.schedule) {
        await run(env, 'INSERT INTO class_schedule (class_id, day, start_time, end_time) VALUES (?, ?, ?, ?)', id, s.day, s.start, s.end);
      }
    }
    if (Array.isArray(data.studentIds)) {
      await run(env, 'DELETE FROM class_students WHERE class_id = ?', id);
      for (const sid of data.studentIds) await run(env, 'INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)', id, sid);
    }
  } else if (collection === 'students') {
    if (Array.isArray(data.classIds)) {
      await run(env, 'DELETE FROM class_students WHERE student_id = ?', id);
      for (const cid of data.classIds) await run(env, 'INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)', cid, id);
    }
  } else if (collection === 'parents') {
    if (Array.isArray(data.studentIds)) {
      await run(env, 'DELETE FROM parent_students WHERE parent_id = ?', id);
      for (const sid of data.studentIds) await run(env, 'INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?, ?)', id, sid);
    }
  }
}

async function deleteItem(env, collection, cfg, id) {
  // Clean up relations / dangling references explicitly (FK enforcement is not
  // assumed to be on in D1).
  if (collection === 'classes') {
    await run(env, 'DELETE FROM class_schedule WHERE class_id = ?', id);
    await run(env, 'DELETE FROM class_students WHERE class_id = ?', id);
    for (const t of ['events', 'homework', 'materials', 'invites']) {
      await run(env, `UPDATE ${t} SET class_id = NULL WHERE class_id = ?`, id);
    }
  } else if (collection === 'students') {
    await run(env, 'DELETE FROM class_students WHERE student_id = ?', id);
    await run(env, 'DELETE FROM parent_students WHERE student_id = ?', id);
  } else if (collection === 'parents') {
    await run(env, 'DELETE FROM parent_students WHERE parent_id = ?', id);
  }
  await run(env, `DELETE FROM ${cfg.table} WHERE id = ?`, id);
}

// ---- theme ------------------------------------------------------------------

async function getTheme(env) {
  const row = await one(env, "SELECT value FROM settings WHERE key = 'theme'");
  if (!row) return { ...DEFAULT_THEME };
  try { return { ...DEFAULT_THEME, ...JSON.parse(row.value) }; } catch (e) { return { ...DEFAULT_THEME }; }
}

async function setTheme(env, patch) {
  const next = { ...(await getTheme(env)), ...patch };
  await run(env, "INSERT INTO settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(next));
  return next;
}
