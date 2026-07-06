import type { FastifyInstance } from "fastify";

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  fastify.get("/health/ready", async (_request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      await fastify.redis.ping();
      return reply.send({ status: "ready" });
    } catch (err) {
      fastify.log.error({ err }, "Readiness check failed");
      return reply.status(503).send({ status: "not-ready" });
    }
  });
}
