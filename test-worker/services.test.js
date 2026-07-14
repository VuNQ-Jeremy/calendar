import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as homeworkSvc from '../server/services/homework';
import * as themeSvc from '../server/services/theme';
import * as feedbackSvc from '../server/services/feedback';

function db() {
  return createDb(env);
}

describe('classes service', () => {
  it('creates and lists a class', async () => {
    const cls = await classesSvc.create(db(), {
      name: 'Math 101',
      color: 'blue',
      schedule: [],
      studentIds: [],
    });
    expect(cls.id).toBeTruthy();
    expect(cls.name).toBe('Math 101');

    const list = await classesSvc.list(db());
    expect(list.some((c) => c.id === cls.id)).toBe(true);
  });

  it('updates a class', async () => {
    const cls = await classesSvc.create(db(), {
      name: 'Science',
      color: 'green',
      schedule: [],
      studentIds: [],
    });
    await classesSvc.update(db(), cls.id, { name: 'Science II' });
    const list = await classesSvc.list(db());
    const updated = list.find((c) => c.id === cls.id);
    expect(updated?.name).toBe('Science II');
  });

  it('removes a class', async () => {
    const cls = await classesSvc.create(db(), {
      name: 'Temp',
      color: 'orange',
      schedule: [],
      studentIds: [],
    });
    await classesSvc.remove(db(), cls.id);
    const list = await classesSvc.list(db());
    expect(list.some((c) => c.id === cls.id)).toBe(false);
  });
});

describe('homework service', () => {
  it('creates and lists homework', async () => {
    const hw = await homeworkSvc.create(db(), { title: 'Chapter 1', done: false });
    expect(hw.id).toBeTruthy();
    expect(hw.title).toBe('Chapter 1');

    const list = await homeworkSvc.list(db());
    expect(list.some((h) => h.id === hw.id)).toBe(true);
  });

  it('marks homework done', async () => {
    const hw = await homeworkSvc.create(db(), { title: 'Essay', done: false });
    await homeworkSvc.update(db(), hw.id, { done: true });
    const list = await homeworkSvc.list(db());
    const updated = list.find((h) => h.id === hw.id);
    expect(updated?.done).toBe(true);
  });
});

describe('theme service', () => {
  it('returns default theme when no settings', async () => {
    const theme = await themeSvc.getTheme(db());
    expect(theme.bg).toBe('#FFFCF8');
    expect(theme.bgOpacity).toBe(0.12);
  });

  it('persists theme patch', async () => {
    await themeSvc.setTheme(db(), { bg: '#123456' });
    const theme = await themeSvc.getTheme(db());
    expect(theme.bg).toBe('#123456');
  });
});

describe('feedback service', () => {
  it('creates and counts new feedback', async () => {
    await feedbackSvc.create(db(), { message: 'Great app!', category: 'praise', status: 'new' });
    const count = await feedbackSvc.countNew(db());
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
