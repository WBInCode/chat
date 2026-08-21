import type { FastifyInstance } from "fastify";
import { daneDostepoweTurn } from "../../lib/turn.js";

/**
 * Konfiguracja ICE dla rozmów głosowych. Osobna trasa, bo dane dostępowe do
 * TURN są czasowe i muszą powstawać przy każdym dołączeniu do rozmowy —
 * nie da się ich wpisać na stałe w kod klienta.
 */
export default async function voiceRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/voice/ice-servers", async (request) => {
    return { iceServers: daneDostepoweTurn(request.user!.id) };
  });
}
