import type { FastifyInstance } from "fastify";
import { createRoleSchema, updateRoleSchema, type OrgPermission } from "@chatv2/shared";
import { parseOrThrow, sendError } from "../../lib/validation.js";
import { assertOrgPermission, forbidden, notFound, HttpError } from "../../lib/authz.js";
import { logAudit } from "../../lib/audit.js";

export default async function rolesRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return sendError(reply, error.status, error.code, error.message);
    }
    throw error;
  });

  fastify.get("/orgs/:orgId/roles", async (request) => {
    const { orgId } = request.params as { orgId: string };
    await assertOrgPermission(fastify, request.user!.id, orgId, "role.manage");

    const roles = await fastify.prisma.role.findMany({
      where: { orgId },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: "asc" }
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      permissions: r.permissions as OrgPermission[],
      memberCount: r._count.memberships,
      createdAt: r.createdAt.toISOString()
    }));
  });

  fastify.post("/orgs/:orgId/roles", async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "role.manage");
    const input = parseOrThrow(createRoleSchema, request.body);

    const existing = await fastify.prisma.role.findFirst({ where: { orgId, name: input.name } });
    if (existing) {
      return sendError(reply, 409, "ROLE_NAME_TAKEN", "Rola o tej nazwie już istnieje");
    }

    const role = await fastify.prisma.role.create({
      data: {
        orgId,
        name: input.name,
        color: input.color,
        permissions: input.permissions
      }
    });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "role.created",
      meta: { roleId: role.id, name: role.name, permissions: role.permissions },
      ip: request.ip
    });

    return reply.status(201).send({
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: role.permissions as OrgPermission[],
      memberCount: 0,
      createdAt: role.createdAt.toISOString()
    });
  });

  fastify.patch("/orgs/:orgId/roles/:roleId", async (request, reply) => {
    const { orgId, roleId } = request.params as { orgId: string; roleId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "role.manage");
    const input = parseOrThrow(updateRoleSchema, request.body);

    const role = await fastify.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.orgId !== orgId) notFound("Rola nie istnieje");

    if (input.name) {
      const nameTaken = await fastify.prisma.role.findFirst({
        where: { orgId, name: input.name, NOT: { id: roleId } }
      });
      if (nameTaken) {
        return sendError(reply, 409, "ROLE_NAME_TAKEN", "Rola o tej nazwie już istnieje");
      }
    }

    const updated = await fastify.prisma.role.update({
      where: { id: roleId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {})
      },
      include: { _count: { select: { memberships: true } } }
    });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "role.updated",
      meta: { roleId, changes: input },
      ip: request.ip
    });

    return reply.send({
      id: updated.id,
      name: updated.name,
      color: updated.color,
      permissions: updated.permissions as OrgPermission[],
      memberCount: updated._count.memberships,
      createdAt: updated.createdAt.toISOString()
    });
  });

  fastify.delete("/orgs/:orgId/roles/:roleId", async (request, reply) => {
    const { orgId, roleId } = request.params as { orgId: string; roleId: string };
    const actor = await assertOrgPermission(fastify, request.user!.id, orgId, "role.manage");

    const role = await fastify.prisma.role.findUnique({
      where: { id: roleId },
      include: { _count: { select: { memberships: true } } }
    });
    if (!role || role.orgId !== orgId) notFound("Rola nie istnieje");
    if (role._count.memberships > 0) {
      forbidden("Nie można usunąć roli przypisanej do członków — najpierw odepnij ją od wszystkich");
    }

    await fastify.prisma.role.delete({ where: { id: roleId } });

    await logAudit(fastify, {
      orgId,
      actorId: actor.userId,
      action: "role.deleted",
      meta: { roleId, name: role.name },
      ip: request.ip
    });

    return reply.status(204).send();
  });
}
