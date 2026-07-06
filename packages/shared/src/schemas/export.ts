import { z } from "zod";

export const exportStatusSchema = z.enum(["PENDING", "READY", "FAILED"]);
export type ExportStatusDto = z.infer<typeof exportStatusSchema>;

export interface DataExportDto {
  id: string;
  status: ExportStatusDto;
  createdAt: string;
  expiresAt: string;
  downloadUrl: string | null;
  error: string | null;
}

export const deleteAccountSchema = z.object({
  confirm: z.literal(true)
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
