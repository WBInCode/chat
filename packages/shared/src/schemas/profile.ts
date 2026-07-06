import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  statusText: z.string().trim().max(120).nullable().optional(),
  statusEmoji: z.string().trim().max(8).nullable().optional()
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const avatarPresignSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024, "Plik jest za duży (limit 8 MB)")
});
export type AvatarPresignInput = z.infer<typeof avatarPresignSchema>;

export const avatarCompleteSchema = z.object({
  key: z.string().min(1)
});
export type AvatarCompleteInput = z.infer<typeof avatarCompleteSchema>;

export interface ProfileDto {
  id: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  statusText: string | null;
  statusEmoji: string | null;
  avatarUrl: string | null;
  createdAt: string;
}
