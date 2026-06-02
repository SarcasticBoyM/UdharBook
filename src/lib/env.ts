import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(24),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  HIGH_BALANCE_THRESHOLD: z.coerce.number().positive().default(50000),
  ADMIN_EMAIL: z.string().email().default("admin@udharbook.local"),
  ADMIN_PASSWORD: z.string().min(8).optional(),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL || undefined,
  SESSION_SECRET: process.env.SESSION_SECRET,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
  HIGH_BALANCE_THRESHOLD: process.env.HIGH_BALANCE_THRESHOLD,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
});
