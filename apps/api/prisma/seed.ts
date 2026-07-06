// Seed danych testowych: firma "Acme", 3 konta, kanały i przykładowe wiadomości.
// Uruchomienie: pnpm --filter @chatv2/api seed
// Konta (hasło wspólne): Haslo!Testowe123
//   anna@acme.pl   (OWNER)
//   bartek@acme.pl (ADMIN)
//   celina@acme.pl (MEMBER)
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const PASSWORD = "Haslo!Testowe123";

const USERS = [
  { email: "anna@acme.pl", displayName: "Anna Kowalska", role: "OWNER" as const },
  { email: "bartek@acme.pl", displayName: "Bartek Nowak", role: "ADMIN" as const },
  { email: "celina@acme.pl", displayName: "Celina Wiśniewska", role: "MEMBER" as const }
];

async function main() {
  const passwordHash = await argon2.hash(PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });

  const org = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: { name: "Acme Sp. z o.o.", slug: "acme" }
  });

  const users = [];
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      // Keep test accounts simple & repeatable: reset password + clear 2FA.
      update: { passwordHash, totpEnabled: false, totpSecret: null },
      create: { email: u.email, displayName: u.displayName, passwordHash }
    });
    await prisma.membership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      update: { role: u.role },
      create: { userId: user.id, orgId: org.id, role: u.role }
    });
    users.push(user);
  }

  const [anna, bartek, celina] = users as [
    (typeof users)[0],
    (typeof users)[0],
    (typeof users)[0]
  ];

  async function ensureChannel(name: string, type: "PUBLIC" | "PRIVATE", memberIds: string[]) {
    let channel = await prisma.channel.findFirst({ where: { orgId: org.id, name, type } });
    if (!channel) {
      channel = await prisma.channel.create({
        data: { orgId: org.id, name, type, createdBy: anna.id }
      });
    }
    for (const [i, uid] of memberIds.entries()) {
      await prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: channel.id, userId: uid } },
        update: {},
        create: { channelId: channel.id, userId: uid, role: i === 0 ? "ADMIN" : "MEMBER" }
      });
    }
    return channel;
  }

  const general = await ensureChannel("general", "PUBLIC", [anna.id, bartek.id, celina.id]);
  await ensureChannel("random", "PUBLIC", [anna.id, bartek.id, celina.id]);
  await ensureChannel("zarzad", "PRIVATE", [anna.id, bartek.id]);

  const existingMessages = await prisma.message.count({ where: { channelId: general.id } });
  if (existingMessages === 0) {
    const now = Date.now();
    const sample = [
      { authorId: anna.id, content: "Cześć wszystkim! Witajcie w naszym nowym komunikatorze 🎉", offsetMin: 60 },
      { authorId: bartek.id, content: "No wreszcie! Koniec z mailami do wszystkiego.", offsetMin: 55 },
      { authorId: celina.id, content: "Wygląda świetnie. Czy działa już wysyłanie plików?", offsetMin: 50 },
      { authorId: anna.id, content: "Pliki będą w fazie 2 — na razie tekst, kanały i DM-y.", offsetMin: 45 },
      { authorId: bartek.id, content: "Przetestujmy DM-y, napiszę do Ciebie Aniu.", offsetMin: 40 }
    ];
    for (const s of sample) {
      await prisma.message.create({
        data: {
          channelId: general.id,
          authorId: s.authorId,
          content: s.content,
          createdAt: new Date(now - s.offsetMin * 60 * 1000)
        }
      });
    }
  }

  console.log("✅ Seed zakończony.");
  console.log("Organizacja: Acme (slug: acme)");
  console.log("Konta testowe (hasło: " + PASSWORD + "):");
  for (const u of USERS) console.log(`  - ${u.email} (${u.role})`);
  console.log("Kanały: #general, #random (publiczne), #zarzad (prywatny: Anna+Bartek)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
