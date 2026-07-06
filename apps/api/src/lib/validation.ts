import type { FastifyReply } from "fastify";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";

export class ValidationError extends Error {
  constructor(public issues: ZodError["issues"]) {
    super("Validation failed");
  }
}

export function parseOrThrow<Output, Input = unknown>(
  schema: ZodType<Output, ZodTypeDef, Input>,
  data: unknown
): Output {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }
  return result.data;
}

export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}
