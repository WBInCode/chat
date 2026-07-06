import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

// OWASP-sane password policy: min 12 chars. Strength (zxcvbn) is checked
// application-side (front + back), not via a single fragile regex here.
export const passwordSchema = z.string().min(12).max(128);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2).max(60)
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  totpCode: z.string().length(6).regex(/^\d+$/).optional()
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional()
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const totpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d+$/)
});
export type TotpVerifyInput = z.infer<typeof totpVerifySchema>;
