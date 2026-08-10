// Test przydzialu na serwerze TURN wykonywany z zewnatrz - ta sama droga,
// ktora przejdzie przegladarka. Sprawdza po kolei: dostepnosc (STUN Binding),
// wymuszanie uwierzytelnienia i przyznanie adresu przekaznika.
//
// Uzycie: node scripts/test-turn.mjs <host> <username> <credential>

import dgram from "node:dgram";
import { createHmac, randomBytes } from "node:crypto";

const [host, username, credential] = process.argv.slice(2);
if (!host || !username || !credential) {
  console.error("uzycie: node test-turn.mjs <host> <username> <credential>");
  process.exit(2);
}

const PORT = 3478;
const COOKIE = 0x2112a442;
const BINDING = 0x0001;
const ALLOCATE = 0x0003;

function naglowek(typ, dlugosc, id) {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(typ, 0);
  b.writeUInt16BE(dlugosc, 2);
  b.writeUInt32BE(COOKIE, 4);
  id.copy(b, 8);
  return b;
}

function atrybut(typ, wartosc) {
  const dopelnienie = (4 - (wartosc.length % 4)) % 4;
  const b = Buffer.alloc(4 + wartosc.length + dopelnienie);
  b.writeUInt16BE(typ, 0);
  b.writeUInt16BE(wartosc.length, 2);
  wartosc.copy(b, 4);
  return b;
}

function czytajAtrybuty(msg) {
  const wynik = {};
  let i = 20;
  while (i + 4 <= msg.length) {
    const typ = msg.readUInt16BE(i);
    const dl = msg.readUInt16BE(i + 2);
    wynik[typ] = msg.subarray(i + 4, i + 4 + dl);
    i += 4 + dl + ((4 - (dl % 4)) % 4);
  }
  return wynik;
}

function xorAdres(buf, id) {
  const rodzina = buf.readUInt8(1);
  const port = buf.readUInt16BE(2) ^ (COOKIE >>> 16);
  if (rodzina === 0x01) {
    const a = buf.subarray(4, 8);
    const k = Buffer.alloc(4);
    k.writeUInt32BE(COOKIE);
    return `${[...a].map((v, j) => v ^ k[j]).join(".")}:${port}`;
  }
  const a = buf.subarray(4, 20);
  const k = Buffer.concat([Buffer.alloc(4), id]);
  k.writeUInt32BE(COOKIE);
  const czesci = [];
  for (let j = 0; j < 16; j += 2) {
    czesci.push((((a[j] ^ k[j]) << 8) | (a[j + 1] ^ k[j + 1])).toString(16));
  }
  return `[${czesci.join(":")}]:${port}`;
}

/** MESSAGE-INTEGRITY liczy sie z naglowka o dlugosci juz uwzgledniajacej ten atrybut. */
function podpisz(typ, id, atrybuty, klucz) {
  const tresc = Buffer.concat(atrybuty);
  const naglowekDoPodpisu = naglowek(typ, tresc.length + 24, id);
  const hmac = createHmac("sha1", klucz)
    .update(Buffer.concat([naglowekDoPodpisu, tresc]))
    .digest();
  return Buffer.concat([naglowekDoPodpisu, tresc, atrybut(0x0008, hmac)]);
}

function wyslij(gniazdo, pakiet) {
  return new Promise((resolve, reject) => {
    const czasomierz = setTimeout(() => reject(new Error("brak odpowiedzi (5 s)")), 5000);
    gniazdo.once("message", (msg) => {
      clearTimeout(czasomierz);
      resolve(msg);
    });
    gniazdo.send(pakiet, PORT, host, (err) => {
      if (err) {
        clearTimeout(czasomierz);
        reject(err);
      }
    });
  });
}

const gniazdo = dgram.createSocket("udp4");
gniazdo.on("error", () => {});
let bledy = 0;

function wynik(ok, opis) {
  console.log(`${ok ? "OK  " : "BLAD"} ${opis}`);
  if (!ok) bledy += 1;
}

try {
  // 1. Dostepnosc z zewnatrz.
  {
    const id = randomBytes(12);
    const odp = await wyslij(gniazdo, naglowek(BINDING, 0, id));
    const adres = czytajAtrybuty(odp)[0x0020];
    wynik(odp.readUInt16BE(0) === 0x0101 && Boolean(adres), `STUN dziala, widziany adres: ${adres ? xorAdres(adres, id) : "-"}`);
  }

  // 2. Przydzial bez danych dostepowych musi zostac odrzucony.
  let realm;
  let nonce;
  {
    const id = randomBytes(12);
    const zadanie = Buffer.concat([
      naglowek(ALLOCATE, 8, id),
      atrybut(0x0019, Buffer.from([17, 0, 0, 0])) // REQUESTED-TRANSPORT = UDP
    ]);
    const odp = await wyslij(gniazdo, zadanie);
    const a = czytajAtrybuty(odp);
    realm = a[0x0014]?.toString();
    nonce = a[0x0015];
    wynik(odp.readUInt16BE(0) === 0x0113 && Boolean(nonce), `przydzial bez uwierzytelnienia odrzucony (realm: ${realm})`);
  }

  // Klucz long-term: MD5(username:realm:password).
  const { createHash } = await import("node:crypto");
  const kluczDla = (uzytkownik, haslo) =>
    createHash("md5").update(`${uzytkownik}:${realm}:${haslo}`).digest();

  const sprobujPrzydzial = async (uzytkownik, haslo) => {
    const id = randomBytes(12);
    const atrybuty = [
      atrybut(0x0019, Buffer.from([17, 0, 0, 0])),
      atrybut(0x0006, Buffer.from(uzytkownik, "utf8")),
      atrybut(0x0014, Buffer.from(realm, "utf8")),
      atrybut(0x0015, nonce)
    ];
    const odp = await wyslij(gniazdo, podpisz(ALLOCATE, id, atrybuty, kluczDla(uzytkownik, haslo)));
    return { odp, id };
  };

  // 3. Poprawne dane -> przyznany adres przekaznika.
  {
    const { odp, id } = await sprobujPrzydzial(username, credential);
    const a = czytajAtrybuty(odp);
    const przekaznik = a[0x0016];
    wynik(
      odp.readUInt16BE(0) === 0x0103 && Boolean(przekaznik),
      `przydzial przyznany, adres przekaznika: ${przekaznik ? xorAdres(przekaznik, id) : "-"}`
    );
  }

  // 4. Bledne haslo -> odmowa. Inaczej przekaznik bylby otwarty dla kazdego.
  {
    const { odp } = await sprobujPrzydzial(username, "zle-haslo");
    const kod = odp.readUInt16BE(0);
    wynik(kod === 0x0113, `przydzial z blednym haslem odrzucony (typ odpowiedzi 0x${kod.toString(16)})`);
  }
} catch (e) {
  wynik(false, `wyjatek: ${e.message}`);
} finally {
  gniazdo.close();
}

process.exit(bledy === 0 ? 0 : 1);
