import closeWithGrace from "close-with-grace";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

async function main() {
  const fastify = await buildApp();

  closeWithGrace({ delay: 5000 }, async ({ err }) => {
    if (err) {
      fastify.log.error({ err }, "Closing server due to error");
    }
    await fastify.close();
  });

  try {
    await fastify.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    fastify.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

void main();
