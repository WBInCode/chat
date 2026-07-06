import type { PrismaClient } from "@prisma/client";

export function createAuthRepo(prisma: PrismaClient) {
  return {
    findUserByEmail(email: string) {
      return prisma.user.findUnique({ where: { email } });
    },

    findUserById(id: string) {
      return prisma.user.findUnique({ where: { id } });
    },

    createUser(data: { email: string; passwordHash: string; displayName: string }) {
      return prisma.user.create({ data });
    },

    createSession(data: {
      userId: string;
      refreshHash: string;
      familyId: string;
      userAgent: string | null;
      ip: string | null;
      expiresAt: Date;
    }) {
      return prisma.session.create({ data });
    },

    findSessionByRefreshHash(refreshHash: string) {
      return prisma.session.findUnique({ where: { refreshHash } });
    },

    revokeSession(id: string) {
      return prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
    },

    revokeSessionFamily(familyId: string) {
      return prisma.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    },

    setPendingTotpSecret(userId: string, encryptedSecret: string) {
      return prisma.user.update({
        where: { id: userId },
        data: { totpSecret: encryptedSecret, totpEnabled: false }
      });
    },

    confirmTotpEnabled(userId: string) {
      return prisma.user.update({
        where: { id: userId },
        data: { totpEnabled: true }
      });
    },

    disableTotp(userId: string) {
      return prisma.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpEnabled: false }
      });
    },

    createRecoveryCodes(userId: string, codeHashes: string[]) {
      return prisma.recoveryCode.createMany({
        data: codeHashes.map((codeHash) => ({ userId, codeHash }))
      });
    },

    findUnusedRecoveryCodes(userId: string) {
      return prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });
    },

    markRecoveryCodeUsed(id: string) {
      return prisma.recoveryCode.update({ where: { id }, data: { usedAt: new Date() } });
    }
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
