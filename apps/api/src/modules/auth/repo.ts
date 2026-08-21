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

    /**
     * Zwraca identyfikatory unieważnionych sesji, żeby wywołujący mógł je
     * dołożyć do listy odrzuconych w Redisie. Bez tego `authenticate` (który
     * czyta WYŁĄCZNIE Redis) autoryzował unieważnioną rodzinę jeszcze przez
     * cały czas życia access tokenu, czyli do 10 minut po wykryciu nadużycia.
     */
    async revokeSessionFamily(familyId: string) {
      const sessions = await prisma.session.findMany({
        where: { familyId, revokedAt: null },
        select: { id: true }
      });
      await prisma.session.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      return sessions.map((s) => s.id);
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
