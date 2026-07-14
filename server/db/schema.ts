import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const staff = sqliteTable('staff', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role').notNull().default('Teacher'),
  color: text('color').notNull().default('orange'),
  phone: text('phone'),
});

export const students = sqliteTable('students', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  grade: text('grade'),
  guardian: text('guardian'),
  email: text('email'),
  color: text('color').notNull().default('blue'),
});

export const parents = sqliteTable('parents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  color: text('color').notNull().default('green'),
  relation: text('relation'),
});

export const classes = sqliteTable('classes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  subject: text('subject'),
  color: text('color').notNull().default('green'),
  room: text('room'),
});

export const classSchedule = sqliteTable(
  'class_schedule',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
  },
  (t) => [index('idx_class_schedule_class').on(t.classId)],
);

export const classStudents = sqliteTable(
  'class_students',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.studentId] }),
    index('idx_class_students_student').on(t.studentId),
  ],
);

export const parentStudents = sqliteTable(
  'parent_students',
  {
    parentId: text('parent_id')
      .notNull()
      .references(() => parents.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.parentId, t.studentId] }),
    index('idx_parent_students_student').on(t.studentId),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    date: text('date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    color: text('color'),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    location: text('location'),
    recurrence: text('recurrence').notNull().default('none'),
  },
  (t) => [index('idx_events_date').on(t.date)],
);

export const homework = sqliteTable('homework', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
  due: text('due'),
  points: integer('points'),
  notes: text('notes'),
  color: text('color'),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
});

export const materials = sqliteTable('materials', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type').notNull().default('notes'),
  classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
  url: text('url'),
  fileName: text('file_name'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  addedAt: text('added_at'),
});

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  role: text('role').notNull(),
  name: text('name'),
  classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
  createdAt: text('created_at'),
  used: integer('used', { mode: 'boolean' }).notNull().default(false),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  createdAt: text('created_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('idx_sessions_account').on(t.accountId)],
);

export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    message: text('message').notNull(),
    category: text('category').notNull().default('idea'),
    author: text('author'),
    status: text('status').notNull().default('new'),
    createdAt: text('created_at'),
  },
  (t) => [index('idx_feedback_status').on(t.status)],
);
