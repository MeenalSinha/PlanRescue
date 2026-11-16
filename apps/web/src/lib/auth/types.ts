import * as z from 'zod';

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const focusPeriodSchema = z.object({
  id: z.string(),
  title: z.string(),
  startTime: z.string(), // e.g. "09:00"
  endTime: z.string(),   // e.g. "11:00"
  daysOfWeek: z.array(z.string()),
});
export type FocusPeriod = z.infer<typeof focusPeriodSchema>;

export const spatialComfortSchema = z.object({
  viewDistance: z.number().min(0.8).max(3.0).default(1.4),
  handRayEnabled: z.boolean().default(true),
  hapticFeedback: z.boolean().default(true),
});
export type SpatialComfort = z.infer<typeof spatialComfortSchema>;

export const userPreferencesSchema = z.object({
  userId: z.string(),
  timezone: z.string().default('Asia/Kolkata'),
  workingDays: z.array(z.string()).default(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  workingHoursStart: z.string().default('09:00'),
  workingHoursEnd: z.string().default('18:00'),
  preferredStrategy: z.enum(['minimal_disruption', 'buffered_transitions', 'priority_first']).default('minimal_disruption'),
  preferredBufferMinutes: z.number().int().min(0).max(60).default(10),
  focusPeriods: z.array(focusPeriodSchema).default([]),
  spatialComfort: spatialComfortSchema.default({
    viewDistance: 1.4,
    handRayEnabled: true,
    hapticFeedback: true,
  }),
  updatedAt: z.string(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const registerInputSchema = z.object({
  email: z.string().email('Valid email address required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  displayName: z.string().trim().min(1, 'Display name required'),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().email('Valid email address required'),
  password: z.string().min(1, 'Password required'),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const authResponseSchema = z.object({
  user: userSchema,
  sessionToken: z.string(),
  preferences: userPreferencesSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
