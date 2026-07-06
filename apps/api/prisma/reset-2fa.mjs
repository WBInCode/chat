// One-off helper: disable 2FA for a test account. Usage:
//   node prisma/reset-2fa.mjs anna@acme.pl
import { PrismaClient } from "@prisma/client";

const email = process.argv[2];
if (!email) {
  console.error("Podaj email: node prisma/reset-2fa.mjs <email>");
  process.exit(1);
}

const prisma = new PrismaClient();
await prisma.user.update({
  where: { email },
  data: { totpEnabled: false, totpSecret: null }
});
await prisma.recoveryCode.deleteMany({ where: { user: { email } } });
console.log(`2FA wyłączone dla ${email}`);
await prisma.$disconnect();
