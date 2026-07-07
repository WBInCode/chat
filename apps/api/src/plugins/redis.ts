import fp from "fastify-plugin";
import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async function redisPlugin(fastify: FastifyInstance) {
  const parsedUrl = new URL(env.REDIS_URL);
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    tls: parsedUrl.protocol === "rediss:" ? {} : undefined
  });

  redis.on("error", (err: Error) => {
    fastify.log.error({ err }, "Redis connection error");
  });

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async (instance) => {
    instance.redis.disconnect();
  });
});
