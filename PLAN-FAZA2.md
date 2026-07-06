# ChatV2 — Faza 2: szczegółowy plan implementacji

> Rozszerzenie [PLAN.md](./PLAN.md). Stan wyjściowy: kroki 1–8 MVP ukończone (auth+2FA, orgi, kanały, DM, realtime, wyszukiwanie, read receipts, testy IDOR — 20 testów zielonych).

Priorytety fazy 2 (wg decyzji produktowej):
1. **Pliki i media** — upload, obrazki/screeny, podgląd dokumentów
2. **Embedowanie linków** (unfurl)
3. **Redesign "liquid glass"** — 2 motywy, animacje, przejścia
4. **Panel HR/Admin** — zarządzanie, logi, ustawienia systemu

---

## Moduł A — Przesyłanie plików i obrazków

### A1. Infrastruktura (backend)
- **MinIO już działa** w docker-compose (port 9010). Dodać do api: klient S3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — działa z MinIO).
- Bucket `chatv2-files`, struktura kluczy: `{orgId}/{channelId}/{fileId}/{sanitizedName}` — izolacja per-org już w ścieżce.
- Inicjalizacja bucketa przy starcie (idempotentna) + polityka: brak publicznego dostępu, wyłącznie presigned URLs.

### A2. Model danych (Prisma)
```prisma
model File {
  id          String   @id @default(uuid())
  orgId       String
  channelId   String
  uploaderId  String
  messageId   String?  // powiązanie po wysłaniu wiadomości
  key         String   @unique // klucz S3
  name        String   // oryginalna nazwa (sanityzowana)
  mimeType    String   // wykryty z magic bytes, NIE z rozszerzenia
  size        Int
  status      FileStatus @default(PENDING) // PENDING | CLEAN | INFECTED | FAILED
  width       Int?     // dla obrazów
  height      Int?
  thumbKey    String?  // miniatura (obrazy)
  createdAt   DateTime @default(now())
  @@index([channelId])
  @@index([messageId])
}
enum FileStatus { PENDING CLEAN INFECTED FAILED }
```
- `Message.contentType` rozszerzyć: `text | file | image | system`.
- Wiadomość z plikiem: `content` = opcjonalny podpis, relacja 1..n do File przez `messageId`.

### A3. Przepływ uploadu (bez przepuszczania plików przez API — presigned PUT)
1. `POST /files/presign` `{channelId, name, size, mimeType}` → walidacja: membership kanału, limit **25 MB**, whitelist typów (obrazy, pdf, docx/xlsx/pptx, txt/csv, zip). Zwraca `{fileId, uploadUrl (presigned PUT, TTL 5 min)}` + rekord File PENDING.
2. Klient robi PUT bezpośrednio do MinIO.
3. `POST /files/:id/complete` → serwer: HEAD obiektu (weryfikacja rozmiaru), pobranie pierwszych 8 KB i **detekcja typu po magic bytes** (`file-type`). Mismatch → usunięcie + FAILED.
4. Job BullMQ (nowy pakiet w api): skan **ClamAV** (kontener `clamav/clamav` w docker-compose) → CLEAN/INFECTED. INFECTED → obiekt usuwany, wiadomość systemowa w kanale.
5. Dla obrazów: job `sharp` → re-enkodowanie (usuwa EXIF/payloady), miniatura max 480px (webp) do `thumbKey`, zapis width/height.
6. `message:send` z `fileIds` → walidacja, że pliki należą do usera+kanału i są CLEAN (obrazy mogą iść od razu z PENDING, doślemy status eventem `file:status`).

### A4. Pobieranie
- `GET /files/:id/url` → weryfikacja membership → **presigned GET (TTL 10 min)**, `response-content-disposition: attachment` dla nie-obrazów.
- Miniatury obrazów: presigned GET do `thumbKey`, w UI lightbox z pełnym rozmiarem.
- **Nigdy** nie serwować z domeny aplikacji; Content-Disposition + osobny origin MinIO = ochrona przed stored-XSS przez pliki HTML/SVG. SVG **poza whitelistą** (wektor XSS) albo tylko jako attachment.

### A5. Wklejanie screenshotów (UX)
- Composer: obsługa `onPaste` (ClipboardEvent → `items[].getAsFile()`) i drag&drop na całe okno kanału (overlay "Upuść, aby wysłać").
- Podgląd przed wysłaniem (miniatura + możliwość usunięcia), wysyłka wielu plików naraz (max 10).
- Progress bar uploadu (XHR/fetch z `onprogress` na presigned PUT).

### A6. Testy
- Presign odrzuca: nie-członka (404), za duży plik, typ spoza whitelisty, mismatch magic bytes.
- Complete: rozmiar niezgodny z deklaracją → FAILED.
- GET url: nie-członek → 404.

---

## Moduł B — Podgląd dokumentów (PDF, DOCX, XLSX)

### B1. Strategia
Dwa poziomy, wdrażane w tej kolejności:
1. **PDF natywnie w przeglądarce** — `pdfjs-dist` (Mozilla), render do canvas w modalu podglądu. Zero konwersji po stronie serwera. Lazy-loaded chunk (import dynamiczny) — nie obciąża głównego bundle.
2. **DOCX/XLSX/PPTX → konwersja do PDF po stronie serwera** — kontener **Gotenberg** (`gotenberg/gotenberg:8`, ma LibreOffice w środku, proste HTTP API) w docker-compose. Job BullMQ po skanie AV: konwersja → zapis `previewKey` (PDF) obok oryginału. UI zawsze podgląda PDF.

### B2. Model
- `File.previewKey String?` + `previewStatus` (NONE | PENDING | READY | FAILED).
- Event WS `file:preview-ready {fileId}` → UI podmienia przycisk "Generowanie podglądu..." na podgląd.

### B3. UI podglądu
- Modal fullscreen (lightbox): obrazy natychmiast, PDF przez pdf.js (paginacja, zoom), dokumenty Office przez wygenerowany PDF.
- Fallback: "Pobierz plik" zawsze dostępny.
- Wiersz załącznika w wiadomości: ikona typu, nazwa, rozmiar, status skanu (spinner → ok), akcje [Podgląd] [Pobierz].

### B4. Bezpieczeństwo podglądu
- pdf.js z wyłączonym JS w PDF (domyślne), render w izolowanym `<canvas>`.
- Gotenberg w sieci wewnętrznej Dockera, bez dostępu z zewnątrz; timeout konwersji 60 s; limit stron/rozmiaru.

---

## Moduł C — Embedowanie linków (unfurl)

### C1. Backend
- Po zapisaniu wiadomości: regex URL-i (max 3 pierwsze), job BullMQ `unfurl`.
- Worker pobiera stronę i parsuje **Open Graph / Twitter Cards / oEmbed** (`metascraper` lub własny parser na `cheerio`): title, description, image, siteName, favicon.
- **Ochrona SSRF (krytyczne!):**
  - Resolve DNS przed fetchem; blokada IP prywatnych/link-local/loopback (10.x, 172.16–31.x, 192.168.x, 127.x, 169.254.x, ::1, fc00::/7) — także po redirectach (max 3).
  - Wyłącznie http/https, port 80/443, timeout 5 s, limit odpowiedzi 1 MB, User-Agent `chatv2-linkbot`.
  - Obrazki OG **proxowane i cache'owane** przez serwer (ściągnięte do MinIO `embeds/`), nigdy hotlinkowane — prywatność (brak wycieku IP userów) i stabilność.
- Model:
```prisma
model LinkEmbed {
  id        String   @id @default(uuid())
  messageId String
  url       String
  title     String?
  description String?
  imageKey  String?  // obraz OG w MinIO
  siteName  String?
  createdAt DateTime @default(now())
  @@index([messageId])
}
```
- Event WS `message:embeds {messageId, embeds[]}` — embed dochodzi asynchronicznie po wiadomości.

### C2. UI
- Karta embedu pod wiadomością: pasek akcentu, favicon+siteName, tytuł (link), opis (2 linie), obrazek (lazy). Możliwość zamknięcia (x) przez autora → usuwa embed.
- Specjalne przypadki (faza 2.1): YouTube (miniatura + odtwarzacz po kliknięciu — iframe z `youtube-nocookie.com`), obrazki bezpośrednie (jpg/png/webp URL → od razu jako obraz).

---

## Moduł D — Redesign "Liquid Glass" (2 motywy + animacje)

### D1. Kierunek wizualny
- Estetyka **glassmorphism/liquid glass**: półprzezroczyste panele `backdrop-filter: blur(20–32px) saturate(160%)`, subtelne obramowania `1px` z gradientem przezroczystości, wewnętrzne podświetlenia (inset highlight top), duże promienie **16–20px**, miękkie wielowarstwowe cienie.
- Tło aplikacji: statyczny **mesh gradient** (2–3 rozmyte plamy koloru akcentu, bardzo niska saturacja w dark), nadaje głębię szkłu. CSS-only (radial-gradients), bez obrazów.
- Kolory (tokens w `styles/index.css`, przełączane klasą `.dark` na `<html>`):

| Token | Light | Dark |
|---|---|---|
| --bg-base | #EEF1F6 (mesh: indigo/cyan 8%) | #0A0D14 (mesh: indigo/violet 12%) |
| --glass | rgba(255,255,255,.55) | rgba(22,27,38,.55) |
| --glass-strong | rgba(255,255,255,.75) | rgba(22,27,38,.78) |
| --glass-border | rgba(255,255,255,.6) | rgba(255,255,255,.08) |
| --text | #16181D | #E9ECF2 |
| --text-dim | #5D6675 | #8A93A5 |
| --accent | #5B7CFF | #6E8BFF |
| --accent-2 | #2EB67D | #34C88A |
| --danger | #E5484D | #FF6369 |

- Typografia: **Inter Variable** (self-host w `public/fonts`, bez Google CDN — prywatność), fluid sizes; liczby tabelaryczne w timestampach.
- Fallback: `@supports not (backdrop-filter: blur())` → solidne tła; `prefers-reduced-motion` → wyłączenie animacji (dostępność).

### D2. System motywów
- Hook `useTheme`: `light | dark | system` (nasłuch `prefers-color-scheme`), zapis w `localStorage("chatv2-theme")` — to nie jest dana wrażliwa.
- Przełącznik w ustawieniach + szybki toggle w sidebarze (ikona słońce/księżyc, animowana rotacja przy zmianie).
- Zmiana motywu: `transition: background-color .3s, color .3s` na tokenach + krótki crossfade; bez FOUC (skrypt inline w index.html ustawia klasę przed hydracją).

### D3. Animacje i przejścia (bez nowych ciężkich zależności — CSS + małe utilsy)
| Element | Animacja |
|---|---|
| Nowa wiadomość | `slide-up + fade` 180ms ease-out (tylko dla nowych, nie przy ładowaniu historii) |
| Wiadomość optimistic | opacity .5 → 1 przy potwierdzeniu (już jest baza) |
| Zmiana kanału | crossfade listy 150ms + subtelny slide nagłówka |
| Sidebar hover | tło 120ms, active: "pill" przesuwający się między pozycjami (`view-transition` lub layout animation) |
| Badge unread | scale-in spring (keyframes `cubic-bezier(.34,1.56,.64,1)`) |
| Typing indicator | 3 kropki bounce (istniejący tekst → komponent z animacją) |
| Modale/lightbox | backdrop fade + panel scale .96→1, 200ms |
| Toasty (nowe) | slide-in z prawej, auto-dismiss z paskiem postępu |
| Presence dot | pulse przy zmianie offline→online |
| Login/registracja | karta glass z delikatnym float-in przy montowaniu |
- Implementacja: klasy utility w CSS + `@keyframes`; dla list `AnimatePresence`-podobne zachowanie własnym hookiem lub (jeśli potrzeba) `motion` (framer-motion następca, ~small) — decyzja przy implementacji, preferencja: **czysty CSS**.

### D4. Komponenty do przebudowy (design system `components/ui/`)
- `GlassPanel`, `GlassButton` (primary/ghost/danger), `Input`, `Modal`, `Toast`, `Tooltip`, `Avatar` (inicjały + kolor deterministyczny z userId), `Badge`, `Skeleton` (shimmer), `DropdownMenu` (Radix + glass styling).
- Refactor: LoginPage, RegisterPage, ChatLayout (sidebar → glass rail), SettingsPage, nowy AdminPanel.
- Wirtualizacja listy wiadomości (`@tanstack/react-virtual`) — wchodzi razem z redesignem MessageList.

---

## Moduł E — Panel HR/Admin i zarządzanie

### E1. Role i uprawnienia (rozszerzenie)
- Nowa rola org: **HR** (między ADMIN a MEMBER): wgląd w audit log członków, zarządzanie członkami (bez zarządzania kanałami/ustawieniami systemu).
- Macierz uprawnień (egzekwowana w `lib/authz.ts`, jedna funkcja `can(actor, action, resource)`):

| Akcja | OWNER | ADMIN | HR | MEMBER |
|---|---|---|---|---|
| Zapraszanie/usuwanie członków | ✓ | ✓ | ✓ | – |
| Zmiana ról (≤ własna) | ✓ | ✓ | – | – |
| Deaktywacja konta | ✓ | ✓ | ✓ | – |
| Audit log | ✓ | ✓ | ✓ (bez logów adminów) | – |
| Usuwanie dowolnych wiadomości | ✓ | ✓ | – | – |
| Ustawienia organizacji | ✓ | ✓ | – | – |
| Retencja/eksport | ✓ | – | – | – |
| Transfer własności | ✓ | – | – | – |

### E2. Zarządzanie członkami (`/admin/members`)
- Lista: avatar, nazwa, email, rola, status (aktywny/deaktywowany/zaproszony), ostatnia aktywność (presence + lastSeenAt), 2FA on/off (tylko wskaźnik).
- Akcje: zmiana roli (dropdown), **deaktywacja** (soft — `Membership.disabledAt`; blokuje login do orga, revokuje sesje przez Redis denylist, socket disconnect), ponowne wysłanie zaproszenia, unieważnienie zaproszenia.
- Wymuszenie 2FA per organizacja (ustawienie `Org.require2fa` → login bez TOTP dostaje wymóg konfiguracji).

### E3. Zarządzanie kanałami (`/admin/channels`)
- Lista wszystkich kanałów orga (także prywatnych — **metadane bez treści**: nazwa, liczba członków, ostatnia aktywność).
- Akcje: archiwizacja (`Channel.archivedAt` — read-only w UI), zmiana nazwy, transfer ownera kanału, usunięcie (z potwierdzeniem "wpisz nazwę").

### E4. Audit log — rozszerzenie (`/admin/audit`)
- Obecny model AuditLog zostaje; **dopisać logowanie do wszystkich akcji**: login (ok/fail/2fa fail), logout, zmiana hasła, włączenie/wyłączenie 2FA, sesja revoked, zmiany ról, deaktywacje, kanały (create/archive/delete), usunięcia wiadomości przez admina, eksporty, zmiany ustawień orga, upload/infected file.
- UI: tabela z filtrami (aktor, typ akcji, zakres dat, IP), paginacja kursorem, eksport CSV.
- Retencja logów: ustawienie orga (90/180/365 dni), job czyszczący (BullMQ cron).
- **Integralność**: hash łańcuchowy (`prevHash` w rekordzie — tamper-evident) — proste, tanie, duża wartość przy audytach.

### E5. Ustawienia organizacji (`/admin/settings`)
- Profil: nazwa, logo (upload → MinIO), domyślny motyw.
- Bezpieczeństwo: wymuszenie 2FA, max czas sesji (nadpisuje TTL refresh), dozwolone domeny email dla zaproszeń (np. tylko `@firma.pl`).
- Wiadomości: retencja (nigdy/90/180/365 dni — job kasujący), max rozmiar pliku (w granicach globalnego 25 MB), włącz/wyłącz embedy linków, whitelist typów plików.
- Eksport danych orga (RODO): job → ZIP (JSON wiadomości + pliki) → presigned link dla OWNERA, ważny 24 h, logowany w audit.

### E6. Dashboard (`/admin`)
- Kafle: liczba członków (aktywni 7d), wiadomości/dzień (wykres 30 dni — prosty SVG sparkline, bez bibliotek chartowych na start), zajętość plików, ostatnie zdarzenia bezpieczeństwa (failed logins, infected files).
- Endpoint agregujący z cache w Redis (TTL 5 min).

---

## Kolejność wdrożenia (sprinty)

| # | Zakres | Kryterium ukończenia |
|---|---|---|
| **F2-1** | Moduł A: presign, upload, magic bytes, obrazy+miniatury (sharp), paste/drag&drop, lightbox | Obrazek wklejony ze schowka wyświetla się u drugiego usera; testy presign/complete/url |
| **F2-2** | ClamAV + BullMQ (worker w api), statusy plików, eventy WS | Plik EICAR → INFECTED, usunięty, komunikat w kanale |
| **F2-3** | Moduł B: pdf.js + Gotenberg, previewKey, modal podglądu | PDF i DOCX otwierają się w podglądzie bez pobierania |
| **F2-4** | Moduł C: unfurl z ochroną SSRF, karty embedów, YouTube | Link OG pokazuje kartę; testy SSRF (localhost/192.168 odrzucone) |
| **F2-5** | Moduł D: tokeny glass, motywy light/dark, przebudowa ui/, animacje, wirtualizacja | Przełącznik motywu działa bez FOUC; reduced-motion respektowane |
| **F2-6** | Moduł E1–E2: rola HR, macierz `can()`, deaktywacje, panel członków | Testy macierzy uprawnień (każda rola × akcja) |
| **F2-7** | Moduł E3–E4: kanały admin, pełny audit log + UI + hash łańcuchowy | Wszystkie akcje w tabeli audytu, filtry działają |
| **F2-8** | Moduł E5–E6: ustawienia orga, retencja, eksport, dashboard | Eksport ZIP działa; retencja kasuje stare wiadomości w teście |

Nowe kontenery docker-compose: `clamav/clamav`, `gotenberg/gotenberg:8`. Nowe zależności api: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `bullmq`, `sharp`, `file-type`, `cheerio`/`metascraper`. Web: `pdfjs-dist`, `@tanstack/react-virtual`.

### Zasady (przypomnienie z PLAN.md §9)
- Autoryzacja przy każdej operacji (nowe zasoby File/LinkEmbed/ustawienia — zawsze przez membership chain), deny-by-default.
- Testy bezpieczeństwa obowiązkowe per sprint (IDOR na plikach, SSRF na unfurl, uprawnienia admin).
- E2EE dla DM pozostaje w backlogu fazy 3 (świadomie po plikach — żeby nie projektować szyfrowania załączników dwa razy).
