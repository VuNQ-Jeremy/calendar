import { z } from 'zod';

export const ColorId = z.enum(['violet', 'green', 'blue', 'orange', 'cocoa', 'rose']);

export const EventInput = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  end: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  color: ColorId.nullish(),
  classId: z.string().nullish(),
  location: z.string().max(200).nullish(),
  recurrence: z.enum(['none', 'daily', 'weekly']).default('none'),
});
export type EventInput = z.infer<typeof EventInput>;

export const ScheduleItem = z.object({
  day: z.coerce.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});
export type ScheduleItem = z.infer<typeof ScheduleItem>;

export const ClassInput = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().max(200).nullish(),
  color: ColorId.default('green'),
  room: z.string().max(200).nullish(),
  schedule: z.array(ScheduleItem).default([]),
  studentIds: z.array(z.string()).default([]),
});
export type ClassInput = z.infer<typeof ClassInput>;

export const StudentInput = z.object({
  name: z.string().trim().min(1).max(200),
  grade: z.string().max(20).nullish(),
  guardian: z.string().max(200).nullish(),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  color: ColorId.default('blue'),
  classIds: z.array(z.string()).default([]),
});
export type StudentInput = z.infer<typeof StudentInput>;

export const StaffInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  role: z.enum(['Teacher', 'Admin', 'Assistant']).default('Teacher'),
  color: ColorId.default('orange'),
  phone: z.string().max(50).nullish(),
});
export type StaffInput = z.infer<typeof StaffInput>;

export const ParentInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .email()
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z.string().max(50).nullish(),
  color: ColorId.default('green'),
  relation: z.string().max(50).nullish(),
  studentIds: z.array(z.string()).default([]),
});
export type ParentInput = z.infer<typeof ParentInput>;

export const HomeworkInput = z.object({
  title: z.string().trim().min(1).max(200),
  classId: z.string().nullish(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  points: z.coerce.number().int().min(0).nullish(),
  notes: z.string().max(2000).nullish(),
  color: ColorId.nullish(),
  done: z.coerce.boolean().default(false),
});
export type HomeworkInput = z.infer<typeof HomeworkInput>;

export const MaterialInput = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(['notes', 'worksheet', 'video', 'link']).default('notes'),
  classId: z.string().nullish(),
  url: z.string().max(2000).nullish(),
  fileName: z.string().max(500).nullish(),
  favorite: z.coerce.boolean().default(false),
  addedAt: z.string().nullish(),
});
export type MaterialInput = z.infer<typeof MaterialInput>;

export const InviteInput = z.object({
  code: z.string().min(7).max(7),
  role: z.enum(['Student', 'Staff', 'Parent']),
  name: z.string().max(200).nullish(),
  classId: z.string().nullish(),
  createdAt: z.string().nullish(),
  used: z.coerce.boolean().default(false),
});
export type InviteInput = z.infer<typeof InviteInput>;

export const FeedbackInput = z.object({
  message: z.string().trim().min(1).max(5000),
  category: z.enum(['idea', 'bug', 'praise', 'other']).default('idea'),
  author: z.string().max(200).nullish(),
  status: z.enum(['new', 'reviewed', 'done']).default('new'),
  createdAt: z.string().nullish(),
});
export type FeedbackInput = z.infer<typeof FeedbackInput>;

export const ThemeInput = z.object({
  bg: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  gridLine: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  today: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  header: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullish(),
  bgImage: z.string().nullish(),
  bgOpacity: z.coerce.number().min(0).max(1).nullish(),
});
export type ThemeInput = z.infer<typeof ThemeInput>;
