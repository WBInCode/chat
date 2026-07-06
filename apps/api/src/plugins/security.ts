import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import type { FastifyInstance } from "fastify";
import { env, isProd } from "../config/env.js";

export default fp(async function securityPlugin(fastify: FastifyInstance) {
  await fastify.register(sensible);

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true, preload: true } : false,
    crossOriginResourcePolicy: { policy: "same-site" }
  });

  await fastify.register(cors, {
    origin: env.CORS_ORIGIN.split(","),
    credentials: true
  });

  await fastify.register(cookie, {
    secret: env.COOKIE_SECRET,
    hook: "onRequest"
  });

  // Global baseline rate limit; per-route limits (e.g. login) are stricter
  // and configured on the individual route. Disabled under NODE_ENV=test so
  // integration tests don't trip the limiter.
  if (env.NODE_ENV !== "test") {
    await fastify.register(rateLimit, {
      max: 300,
      timeWindow: "1 minute",
      redis: fastify.redis,
      // preHandler runs after body parsing, so per-route keyGenerators
      // (e.g. login per IP+email) can incorporate request body fields.
      hook: "preHandler",
      allowList: []
    });
  }
});
