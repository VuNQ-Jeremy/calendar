import { describe, it, expect } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../worker/index.js';

const BASE = 'http://localhost';

async function workerFetch(path, method = 'GET', body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const req = new Request(BASE + path, init);
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function json(path, method = 'GET', body) {
  const res = await workerFetch(path, method, body);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/state', () => {
  it('returns 200 with all collection keys and theme', async () => {
    const { status, body } = await json('/api/state');
    expect(status).toBe(200);
    const keys = [
      'classes',
      'students',
      'users',
      'parents',
      'events',
      'homework',
      'materials',
      'invites',
      'feedback',
      'theme',
    ];
    for (const k of keys) {
      expect(body).toHaveProperty(k);
    }
  });

  it('returns empty arrays for all collections in an empty DB', async () => {
    const { body } = await json('/api/state');
    const collections = [
      'classes',
      'students',
      'users',
      'parents',
      'events',
      'homework',
      'materials',
      'invites',
      'feedback',
    ];
    for (const k of collections) {
      // admin seed adds one staff row; everything else should be empty
      if (k !== 'users') expect(body[k]).toHaveLength(0);
    }
  });
});

describe('POST /api/classes', () => {
  it('creates a class and returns 201 with server-assigned id', async () => {
    const { status, body } = await json('/api/classes', 'POST', {
      name: 'Biology 9A',
      subject: 'Science',
      color: 'green',
      room: 'Room 101',
      schedule: [{ day: 1, start: '09:00', end: '10:00' }],
      studentIds: [],
    });
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Biology 9A');
    expect(body.schedule).toHaveLength(1);
    expect(body.schedule[0]).toMatchObject({ day: 1, start: '09:00', end: '10:00' });
    expect(body.studentIds).toEqual([]);
  });
});

describe('PATCH /api/classes/:id', () => {
  it('replaces schedule and studentIds fully (not appended)', async () => {
    const { body: created } = await json('/api/classes', 'POST', {
      name: 'Math 10',
      subject: 'Math',
      color: 'blue',
      room: '',
      schedule: [{ day: 1, start: '08:00', end: '09:00' }],
      studentIds: [],
    });
    const id = created.id;

    const { body: updated } = await json(`/api/classes/${id}`, 'PATCH', {
      schedule: [
        { day: 2, start: '10:00', end: '11:00' },
        { day: 4, start: '10:00', end: '11:00' },
      ],
      studentIds: [],
    });

    expect(updated.schedule).toHaveLength(2);
    expect(updated.schedule.some((s) => s.day === 1)).toBe(false);
    expect(updated.schedule.some((s) => s.day === 2)).toBe(true);
  });
});

describe('Relations', () => {
  it('links a student to a class and state reflects both sides', async () => {
    const { body: cls } = await json('/api/classes', 'POST', {
      name: 'Art 7',
      subject: 'Art',
      color: 'violet',
      room: '',
      schedule: [],
      studentIds: [],
    });
    const { body: student } = await json('/api/students', 'POST', {
      name: 'Alice',
      grade: '7',
      guardian: '',
      email: '',
      color: 'orange',
      classIds: [],
      parentIds: [],
    });

    await json(`/api/students/${student.id}`, 'PATCH', { classIds: [cls.id] });

    const { body: state } = await json('/api/state');
    const stateClass = state.classes.find((c) => c.id === cls.id);
    const stateStudent = state.students.find((s) => s.id === student.id);

    expect(stateClass.studentIds).toContain(student.id);
    expect(stateStudent.classIds).toContain(cls.id);
  });
});

describe('DELETE /api/classes/:id', () => {
  it('removes the class and clears student classIds and event classId', async () => {
    const { body: cls } = await json('/api/classes', 'POST', {
      name: 'PE 8',
      subject: 'PE',
      color: 'green',
      room: 'Gym',
      schedule: [],
      studentIds: [],
    });
    const { body: student } = await json('/api/students', 'POST', {
      name: 'Bob',
      grade: '8',
      guardian: '',
      email: '',
      color: 'blue',
      classIds: [cls.id],
      parentIds: [],
    });
    const { body: event } = await json('/api/events', 'POST', {
      title: 'PE class',
      date: '2026-07-07',
      start: '08:00',
      end: '09:00',
      color: 'green',
      classId: cls.id,
      location: '',
      recurrence: 'none',
    });

    await json(`/api/classes/${cls.id}`, 'DELETE');

    const { body: state } = await json('/api/state');

    expect(state.classes.find((c) => c.id === cls.id)).toBeUndefined();

    const stateStudent = state.students.find((s) => s.id === student.id);
    expect(stateStudent.classIds).not.toContain(cls.id);

    const stateEvent = state.events.find((e) => e.id === event.id);
    expect(stateEvent).toBeDefined();
    expect(stateEvent.classId).toBeNull();
  });
});

describe('Theme', () => {
  it('GET /api/theme returns default theme', async () => {
    const { status, body } = await json('/api/theme');
    expect(status).toBe(200);
    expect(body.bg).toBeTruthy();
    expect(body.gridLine).toBeTruthy();
  });

  it('PUT /api/theme merges and preserves other keys', async () => {
    const { body: before } = await json('/api/theme');
    const originalGridLine = before.gridLine;

    await json('/api/theme', 'PUT', { bg: '#000000' });

    const { body: after } = await json('/api/theme');
    expect(after.bg).toBe('#000000');
    expect(after.gridLine).toBe(originalGridLine);
  });
});

describe('Error cases', () => {
  it('POST /api/nonsense returns 404', async () => {
    const { status } = await json('/api/nonsense', 'POST', { foo: 'bar' });
    expect(status).toBe(404);
  });

  it('PATCH /api/classes without id returns 400', async () => {
    const { status } = await json('/api/classes', 'PATCH', { name: 'x' });
    expect(status).toBe(400);
  });
});
