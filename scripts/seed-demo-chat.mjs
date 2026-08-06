/**
 * Dane pokazowe czatu dla organizacji demonstracyjnej: użytkownicy, kanały,
 * rozmowy, ankieta i reakcje.
 *
 * Uruchomienie na produkcji:
 *   docker cp seed-demo-chat.mjs wb-chat-api:/repo/seed-demo-chat.mjs
 *   docker exec wb-chat-api node /repo/seed-demo-chat.mjs
 *
 * Idempotentny: kanały rozpoznaje po nazwie w organizacji, wiadomości dopisuje
 * tylko do kanałów, które są jeszcze puste.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const SLUG = "demo-nowak";
const DOMENA = "demo.wb-partners.pl";

/** Załoga: nazwisko → [imię, stanowisko, dział, rola w organizacji]. */
const ZALOGA = [
  ["Marek", "Nowak", "Prezes Zarządu", "ZARZ", "OWNER"],
  ["Anna", "Zielińska", "Dyrektor Operacyjny", "ZARZ", "ADMIN"],
  ["Joanna", "Wieczorek", "Kierownik Działu HR", "HR", "ADMIN"],
  ["Magdalena", "Krawczyk", "Specjalista ds. HR", "HR", "MEMBER"],
  ["Ewa", "Adamczyk", "Specjalista ds. Kadr i Płac", "HR", "MEMBER"],
  ["Tomasz", "Wójcik", "Kierownik Produkcji", "PROD", "MEMBER"],
  ["Grzegorz", "Mazur", "Brygadzista", "PROD", "MEMBER"],
  ["Rafał", "Sikora", "Operator CNC", "PROD", "MEMBER"],
  ["Damian", "Baran", "Operator CNC", "PROD", "MEMBER"],
  ["Sebastian", "Górski", "Operator maszyn", "PROD", "MEMBER"],
  ["Łukasz", "Pawlak", "Operator maszyn", "PROD", "MEMBER"],
  ["Krzysztof", "Duda", "Ślusarz", "PROD", "MEMBER"],
  ["Marcin", "Sobczak", "Kontroler jakości", "PROD", "MEMBER"],
  ["Paweł", "Michalak", "Technolog", "PROD", "MEMBER"],
  ["Katarzyna", "Lewandowska", "Kierownik Sprzedaży", "SPRZ", "MEMBER"],
  ["Bartosz", "Kowalczyk", "Przedstawiciel Handlowy", "SPRZ", "MEMBER"],
  ["Natalia", "Wróbel", "Przedstawiciel Handlowy", "SPRZ", "MEMBER"],
  ["Kamil", "Jankowski", "Przedstawiciel Handlowy", "SPRZ", "MEMBER"],
  ["Aleksandra", "Piotrowska", "Specjalista ds. Obsługi Klienta", "SPRZ", "MEMBER"],
  ["Dominika", "Nowicka", "Specjalista ds. Obsługi Klienta", "SPRZ", "MEMBER"],
  ["Jakub", "Zawadzki", "Specjalista ds. Ofertowania", "SPRZ", "MEMBER"],
  ["Piotr", "Kamiński", "Kierownik Magazynu", "MAG", "MEMBER"],
  ["Adrian", "Szewczyk", "Magazynier", "MAG", "MEMBER"],
  ["Mateusz", "Olszewski", "Magazynier", "MAG", "MEMBER"],
  ["Karol", "Stępień", "Operator wózka widłowego", "MAG", "MEMBER"],
  ["Wojciech", "Malinowski", "Specjalista ds. Logistyki", "MAG", "MEMBER"],
  ["Sylwia", "Bąk", "Specjalista ds. Zaopatrzenia", "MAG", "MEMBER"],
  ["Michał", "Dąbrowski", "Kierownik Działu IT", "IT", "ADMIN"],
  ["Przemysław", "Ostrowski", "Administrator Systemów", "IT", "MEMBER"],
  ["Karolina", "Sadowska", "Specjalista ds. Wsparcia IT", "IT", "MEMBER"],
  ["Filip", "Wysocki", "Specjalista ds. Wsparcia IT", "IT", "MEMBER"],
  ["Agnieszka", "Szymańska", "Główna Księgowa", "KSIE", "MEMBER"],
  ["Beata", "Rutkowska", "Księgowa", "KSIE", "MEMBER"],
  ["Monika", "Głowacka", "Księgowa", "KSIE", "MEMBER"],
  ["Tomasz", "Sokołowski", "Analityk Finansowy", "KSIE", "MEMBER"],
];

const DZIALY = {
  ZARZ: "Zarząd", HR: "Kadry i Płace", PROD: "Produkcja", SPRZ: "Sprzedaż",
  MAG: "Magazyn i Logistyka", IT: "IT", KSIE: "Księgowość",
};

function adres(imie, nazwisko) {
  const bez = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u0142/g, "l").replace(/[^a-z]/g, "");
  return `${bez(imie)}.${bez(nazwisko)}@${DOMENA}`;
}

/** Kanały: nazwa, temat, kto należy (kod działu lub "*" = wszyscy). */
const KANALY = [
  { nazwa: "ogolny", temat: "Sprawy całej firmy", dzialy: ["*"], rodzaj: "TEXT" },
  { nazwa: "ogloszenia", temat: "Komunikaty zarządu — tylko do odczytu", dzialy: ["*"], rodzaj: "ANNOUNCEMENT" },
  { nazwa: "produkcja", temat: "Hala, maszyny, zmiany", dzialy: ["PROD", "ZARZ"], rodzaj: "TEXT" },
  { nazwa: "sprzedaz", temat: "Oferty, klienci, zamówienia", dzialy: ["SPRZ", "ZARZ"], rodzaj: "TEXT" },
  { nazwa: "magazyn", temat: "Przyjęcia, wydania, inwentaryzacje", dzialy: ["MAG", "PROD"], rodzaj: "TEXT" },
  { nazwa: "it-wsparcie", temat: "Zgłoszenia do działu IT", dzialy: ["*"], rodzaj: "TEXT" },
  { nazwa: "kadry", temat: "Urlopy, szkolenia, sprawy pracownicze", dzialy: ["HR", "ZARZ"], rodzaj: "TEXT" },
];

/** Rozmowy: kanał → lista [autor po nazwisku, treść]. */
const ROZMOWY = {
  ogolny: [
    ["Nowak", "Dzień dobry wszystkim. Od dziś przechodzimy na nowy system, wszystkie sprawy firmowe załatwiamy tutaj zamiast mailem."],
    ["Wieczorek", "Potwierdzam. Wnioski urlopowe składacie w WorkBase, nie na papierze."],
    ["Dąbrowski", "Gdyby ktoś miał problem z logowaniem, piszcie na kanał it-wsparcie."],
    ["Zielińska", "Przypominam o zebraniu kierowników w czwartek o 9:00."],
    ["Kamiński", "Będę, ale mogę się spóźnić 10 minut, mam dostawę o 8:30."],
  ],
  ogloszenia: [
    ["Nowak", "Wyniki za pierwsze półrocze przekroczyły plan o 8 procent. Dziękuję wszystkim za pracę."],
    ["Wieczorek", "Badania okresowe dla działu produkcji odbędą się 18 sierpnia. Lista osób u kierowników."],
    ["Zielińska", "Od września zmiana godzin pracy magazynu na 6:00-14:00."],
  ],
  produkcja: [
    ["Wójcik", "Zlecenie 2026/412 gotowe do kontroli jakości."],
    ["Sobczak", "Sprawdzone, dwie sztuki odrzucone, reszta przechodzi. Opis w zadaniu."],
    ["Wójcik", "Dzięki. Grzegorz, dopilnuj poprawek na drugiej zmianie."],
    ["Mazur", "Robi się. Potrzebuję jeszcze materiału na serię 400-Z, magazyn ma tylko połowę."],
    ["Kamiński", "Dostawa jutro rano, odłożę dla was od razu."],
    ["Michalak", "Zaktualizowałem kartę technologiczną, parametry obróbki są w załączniku do zadania."],
  ],
  sprzedaz: [
    ["Lewandowska", "Metalpol prosi o ofertę na 1200 sztuk korpusów. Kto bierze?"],
    ["Kowalczyk", "Ja mogę, mam z nimi kontakt od zeszłego roku."],
    ["Zawadzki", "Przygotuję kalkulację do jutra, potrzebuję tylko potwierdzenia terminu z produkcji."],
    ["Wójcik", "Przy obecnym obłożeniu realny termin to 3 tygodnie od zamówienia."],
    ["Lewandowska", "Dobrze, wpisujemy 3 tygodnie z zapasem. Bartosz, dzwoń do klienta."],
    ["Wróbel", "Przy okazji: Stalbud pytał o ten sam asortyment, może warto zrobić wspólną serię."],
  ],
  magazyn: [
    ["Kamiński", "W poniedziałek inwentaryzacja strefy A. Adrian i Mateusz, zaczynamy o 7:00."],
    ["Szewczyk", "Jasne. Regały A1-A6 biorę na siebie."],
    ["Olszewski", "To ja biorę A7-A12."],
    ["Malinowski", "Przypominam, że dostawa od Stalexport miała braki ilościowe, reklamacja poszła wczoraj."],
    ["Bąk", "Potwierdzone, dostawca odpowiedział, uzupełnią w przyszłym tygodniu."],
  ],
  "it-wsparcie": [
    ["Rutkowska", "Drukarka w księgowości nie odpowiada."],
    ["Sadowska", "Już patrzę. Restartowałaś ją po wymianie tonera?"],
    ["Rutkowska", "Nie, spróbuję."],
    ["Rutkowska", "Działa, dzięki."],
    ["Wysocki", "Przypominam wszystkim o zmianie hasła do końca miesiąca."],
    ["Ostrowski", "Kopie zapasowe przeszły test odtworzenia, raport wysłałem do Michała."],
  ],
  kadry: [
    ["Wieczorek", "Ruszamy z naborem na operatora CNC. Ogłoszenie idzie dziś."],
    ["Krawczyk", "Mam już trzy zgłoszenia z poprzedniej rekrutacji, mogę je odświeżyć."],
    ["Adamczyk", "Przypominam o rozliczeniu delegacji do 10 dnia miesiąca."],
    ["Wieczorek", "Oceny okresowe produkcji planujemy na wrzesień, rozmowy umówię indywidualnie."],
  ],
};

const ANKIETA = {
  kanal: "ogolny",
  autor: "Wieczorek",
  pytanie: "Kiedy zrobimy firmowe spotkanie integracyjne?",
  opcje: ["Wrzesień, piknik", "Październik, kręgle", "Grudzień, wigilia firmowa"],
};

const REAKCJE = ["👍", "🎉", "✅", "👀"];

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: SLUG } });
  if (!org) throw new Error(`Brak organizacji ${SLUG} — najpierw zaloguj się do czatu przez SSO.`);

  // Konta zakładamy tak samo jak logowanie SSO (wyszukanie po adresie, potem utworzenie),
  // więc późniejsze wejście przez Hub odnajdzie je i tylko odświeży rolę.
  let nowych = 0;
  for (const [imie, nazwisko, stanowisko, dzial, rola] of ZALOGA) {
    const email = adres(imie, nazwisko);
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          displayName: `${imie} ${nazwisko}`,
          // Konta wchodzą wyłącznie przez SSO; ten skrót nie pasuje do żadnego hasła.
          passwordHash: `sso-only:${randomBytes(24).toString("hex")}`,
          jobTitle: stanowisko,
          department: DZIALY[dzial],
        },
      });
      nowych++;
    } else if (!user.jobTitle) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { jobTitle: stanowisko, department: DZIALY[dzial] },
      });
    }

    await prisma.membership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      update: { role: rola },
      create: { userId: user.id, orgId: org.id, role: rola },
    });
  }

  const czlonkowie = await prisma.membership.findMany({
    where: { orgId: org.id },
    include: { user: true },
  });
  console.log(`Organizacja: ${org.name}, kont w czacie: ${czlonkowie.length} (nowych: ${nowych})`);
  if (czlonkowie.length === 0) throw new Error("Brak użytkowników — zaloguj ludzi przez SSO.");

  const poNazwisku = new Map();
  for (const cz of czlonkowie) {
    const nazwisko = cz.user.displayName.split(" ").slice(-1)[0];
    poNazwisku.set(nazwisko, cz.user);
  }
  const dzialPoNazwisku = new Map(ZALOGA.map(([, nazwisko, , dzial]) => [nazwisko, dzial]));

  const wlasciciel = czlonkowie.find((c) => c.role === "OWNER")?.user ?? czlonkowie[0].user;

  let kanalow = 0;
  let wiadomosci = 0;

  for (const def of KANALY) {
    let kanal = await prisma.channel.findFirst({
      where: { orgId: org.id, name: def.nazwa, type: "PUBLIC" },
    });

    if (!kanal) {
      kanal = await prisma.channel.create({
        data: {
          orgId: org.id,
          type: "PUBLIC",
          kind: def.rodzaj,
          name: def.nazwa,
          topic: def.temat,
          createdBy: wlasciciel.id,
          readOnly: false,
          position: kanalow,
        },
      });
      kanalow++;
    }

    // Członkostwo: kanały ogólne dostają wszystkich, pozostałe tylko właściwe działy.
    const wszyscy = def.dzialy.includes("*");
    for (const cz of czlonkowie) {
      const nazwisko = cz.user.displayName.split(" ").slice(-1)[0];
      const dzial = dzialPoNazwisku.get(nazwisko);
      if (!wszyscy && !def.dzialy.includes(dzial)) continue;
      await prisma.channelMember.upsert({
        where: { channelId_userId: { channelId: kanal.id, userId: cz.user.id } },
        update: {},
        create: {
          channelId: kanal.id,
          userId: cz.user.id,
          role: cz.role === "OWNER" || cz.role === "ADMIN" ? "ADMIN" : "MEMBER",
        },
      });
    }

    const juzMa = await prisma.message.count({ where: { channelId: kanal.id } });
    if (juzMa > 0) continue;

    const rozmowa = ROZMOWY[def.nazwa] ?? [];
    let kiedy = Date.now() - rozmowa.length * 3600_000 - 86_400_000;
    for (const [nazwisko, tresc] of rozmowa) {
      const autor = poNazwisku.get(nazwisko);
      if (!autor) continue;
      kiedy += 1800_000 + Math.floor(Math.random() * 2400_000);
      const wiadomosc = await prisma.message.create({
        data: {
          channelId: kanal.id,
          authorId: autor.id,
          content: tresc,
          createdAt: new Date(kiedy),
        },
      });
      wiadomosci++;

      // Reakcje na co trzeciej wiadomości, od losowej osoby z kanału.
      if (wiadomosci % 3 === 0) {
        const reagujacy = czlonkowie[Math.floor(Math.random() * czlonkowie.length)].user;
        if (reagujacy.id !== autor.id) {
          await prisma.reaction.create({
            data: {
              messageId: wiadomosc.id,
              userId: reagujacy.id,
              emoji: REAKCJE[Math.floor(Math.random() * REAKCJE.length)],
            },
          }).catch(() => {});
        }
      }
    }
  }

  // Ankieta w kanale ogólnym.
  const kanalAnkiety = await prisma.channel.findFirst({
    where: { orgId: org.id, name: ANKIETA.kanal },
  });
  const autorAnkiety = poNazwisku.get(ANKIETA.autor);
  if (kanalAnkiety && autorAnkiety) {
    const juz = await prisma.poll.findFirst({
      where: { question: ANKIETA.pytanie, message: { channelId: kanalAnkiety.id } },
    });
    if (!juz) {
      const wiadomosc = await prisma.message.create({
        data: { channelId: kanalAnkiety.id, authorId: autorAnkiety.id, content: ANKIETA.pytanie },
      });
      const ankieta = await prisma.poll.create({
        data: {
          messageId: wiadomosc.id,
          question: ANKIETA.pytanie,
          options: { create: ANKIETA.opcje.map((text, position) => ({ text, position })) },
        },
        include: { options: true },
      });
      for (const cz of czlonkowie.slice(0, 12)) {
        const opcja = ankieta.options[Math.floor(Math.random() * ankieta.options.length)];
        await prisma.pollVote.create({
          data: { pollOptionId: opcja.id, userId: cz.user.id },
        }).catch(() => {});
      }
      wiadomosci++;
    }
  }

  const podsum = await prisma.channel.count({ where: { orgId: org.id } });
  const wiad = await prisma.message.count({ where: { channel: { orgId: org.id } } });
  console.log(`  kanałów: ${podsum} (nowych: ${kanalow})`);
  console.log(`  wiadomości w organizacji: ${wiad} (dodanych: ${wiadomosci})`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
