# PLAN FAZA 6 — chatv2: wyniesienie komunikatora na kolejny poziom

> Kontekst: Fazy 1–5 ukończone (MVP, pliki+bezpieczeństwo, RODO/profile, 23 funkcje pro,
> redesign+role+AI+głos+jakość). Produkcja działa: Vercel (web) + Render (api) + Neon (PG)
> + Upstash (Redis) + Cloudflare R2 (pliki). 123 testy API zielone.
>
> **Kontekst ekosystemu:** równolegle w `../wb-platform` powstaje Hub (SSO/OIDC, EdDSA+JWKS,
> entitlements, webhooks). chatv2 będzie jego **klientem** — dlatego w tej fazie
> **NIE DOTYKAMY systemu logowania** (rejestracja/login/refresh/2FA zostają bez zmian,
> lokalny login pozostanie na zawsze jako fallback). Przygotowujemy jedynie punkty
> zaczepienia po stronie chatv2 (sprint F6-G), zgodnie z sekcją 7.1 PLANu wb-platform.
>
> Zasada nadrzędna bez zmian: **zero kosztów** — darmowe tiery, self-host, twarde limity.

---

## Mapa sprintów (kolejność wykonania)

| # | Sprint | Obszar | Zależy od |
|---|--------|--------|-----------|
| 1 | F6-A | Redesign v3: gęstość, grupowanie, motywy, onboarding | — |
| 2 | F6-B | Głos v2: SFU (więcej uczestników), udostępnianie ekranu, notatki głosowe | — |
| 3 | F6-C | Wiadomości v2: pełny emoji picker, edytor rich-text, potwierdzenia odczytu | F6-A |
| 4 | F6-D | Pliki i media v2: galeria, podgląd wideo/audio, porządki w R2 | — |
| 5 | F6-E | Bezpieczeństwo v2: sesje-UI, CSP, E2EE DM (fundament), skan zależności | — |
| 6 | F6-F | Skala i wydajność: paginacja niesk., archiwizacja, cache, indeksy | — |
| 7 | F6-G | Gotowość ekosystemowa (wb-platform): entitlements, webhooks, punkty SSO | uzgodnienia z Hubem |
| 8 | F6-H | PWA / mobile: instalowalna aplikacja, offline, long-press | F6-A |
| 9 | F6-I | Admin analytics + retencja + eksporty zbiorcze | — |

Sprinty F6-A/B/D/E/F są od siebie niezależne — można przeplatać wg priorytetów.

---

## Sprint F6-A — Redesign v3 (dopracowanie designu)

Obecny liquid-glass jest dobrym fundamentem, ale wymaga dopracowania spójności
i "gęstości informacji" (feedback: za dużo powietrza na desktopie, za mało hierarchii).

### A.1 Gęstość i typografia
- Tryb **Komfortowy / Kompaktowy** (przełącznik w Ustawieniach, localStorage):
  kompaktowy zmniejsza paddingi wierszy wiadomości, wysokość elementów sidebara.
- Skala typograficzna: nazwy autorów / treść / metadane — wyraźniejsza hierarchia
  (nazwa 600, treść 400, metadane `--text-dim` 12px zamiast obecnej mieszanki).
- Wiadomości tego samego autora w ciągu 5 min już się grupują — dodać
  **hover-timestamp** przy zgrupowanych wierszach (teraz w ogóle nie widać godziny).

### A.2 Kolory / motywy
- Trzeci motyw **"Midnight"** (czysta czerń OLED, bez mesh-gradientu — oszczędza baterię
  na mobile i preferowany przez część użytkowników).
- Akcent do wyboru (paleta 6 kolorów, zapis w profilu użytkownika, nie localStorage —
  ma iść za kontem między urządzeniami).
- Audyt kontrastu WCAG AA obu istniejących motywów (szczególnie `--text-dim` na glass).

### A.3 Puste stany i onboarding
- Ekran "pustego kanału" z podpowiedziami (obecnie sucha pustka).
- Pierwszy login → 3-krokowy spotlight (sidebar → composer → wyszukiwanie),
  odrzucalny, zapisywany per-user.
- Stany błędów sieci: baner "łączenie ponownie…" przy zerwanym WS (obecnie cisza).

### A.4 Mikrointerakcje
- Skeleton loading dla listy wiadomości przy przełączaniu kanałów (zamiast pustki).
- Animacja wysyłki wiadomości (subtelny fade z dołu, już częściowo jest).
- Potwierdzenie wizualne akcji: toast po "Skopiowano link", "Przypięto" itd.
  (część akcji dziś nie daje żadnego feedbacku).

**Weryfikacja:** przegląd wizualny dark/light/midnight, tryb kompaktowy działa,
onboarding pojawia się tylko raz, E2E smoke nadal zielony.

---

## Sprint F6-B — Głos v2: więcej uczestników + ekran + notatki głosowe

### B.1 Diagnoza ograniczenia
Obecny P2P mesh (F5-E) ma twardy limit 4 osób: przy N uczestnikach każdy wysyła
N-1 strumieni (upload rośnie liniowo, CPU na enkodowanie również). Realny sufit
mesh audio to ~4–6 osób.

### B.2 Rozwiązanie: self-hosted SFU (nadal zero kosztów licencyjnych)
**Rekomendacja: LiveKit OSS (self-hosted)** — najbardziej dojrzały darmowy SFU:
- Serwer: pojedynczy binarek Go, ~100–200 MB RAM na małe pokoje — do udźwignięcia
  na darmowym/najtańszym VPS (np. Oracle Cloud Free Tier ARM — 4 vCPU/24 GB za darmo,
  albo kontener na Render).
- SDK klienta `livekit-client` (TS) + tokeny dostępu podpisywane przez nasz backend
  (API key/secret self-hosted instancji — zero kosztów zewnętrznych).
- **Architektura hybrydowa:** rozmowy ≤4 osób zostają na obecnym P2P mesh (zero
  obciążenia serwera); >4 osób → automatyczne przełączenie na pokój LiveKit.
  Env `LIVEKIT_URL/KEY/SECRET` opcjonalne — brak = tylko mesh (jak dziś), feature-flag.
- Docelowy limit z SFU: **25–50 uczestników audio** (konfigurowalny).

Plan awaryjny (gdyby VPS odpadł): mediasoup wbudowany w proces API — trudniejszy
w utrzymaniu, ale bez osobnej maszyny; decyzja po teście obciążeniowym LiveKit.

### B.3 Udostępnianie ekranu
- `getDisplayMedia()` + drugi track w istniejącym peer connection (mesh) / LiveKit track (SFU).
- UI: przycisk "Udostępnij ekran" w VoiceRoom, podgląd strumienia w panelu
  (klik = powiększenie), wskaźnik "X udostępnia ekran".

### B.4 Notatki głosowe + transkrypcja (synergia z F5-D)
- Przycisk mikrofonu w composerze → nagranie (MediaRecorder, opus/webm, max 3 min)
  → upload istniejącym pipeline plików → odtwarzacz inline w wiadomości.
- Transkrypcja przez **Whisper Large v3 na Groq** (2000 req/dzień w darmowym tierze,
  klucz już skonfigurowany) — tekst pod odtwarzaczem + indeksowany w wyszukiwarce FTS.

### B.5 Jakość rozmów
- Wybór urządzenia wejściowego (mikrofonu), wskaźnik poziomu przed dołączeniem ("test mikrofonu").
- Redukcja szumu: `noiseSuppression/echoCancellation/autoGainControl` constraints (darmowe, wbudowane).
- Push-to-talk (spacja) jako opcja.

**Weryfikacja:** rozmowa 2-osobowa mesh bez regresji; pokój SFU z ≥5 uczestnikami
(test wielokartowy); nagranie notatki głosowej → transkrypcja pojawia się pod odtwarzaczem;
udostępnienie ekranu widoczne u drugiego uczestnika.

---

## Sprint F6-C — Wiadomości v2

### C.1 Pełny emoji picker
- Zastąpić 10-emoji hardcode ([`ALLOWED_REACTIONS`]) pełnym pickerem:
  `emoji-mart` (darmowy, popularny) z wyszukiwarką i kategoriami — dla reakcji ORAZ
  wstawiania emoji do treści (przycisk 🙂 w composerze).
- Backend: zdjąć enum z zod (walidacja: pojedynczy grafem emoji, max długość) —
  migracja bez zmian danych.
- **Custom emoji organizacji**: upload PNG (istniejący pipeline plików + sharp resize 64px),
  składnia `:nazwa:`, zarządzanie w panelu Admin (nowa zakładka), render w treści i reakcjach.

### C.2 Potwierdzenia odczytu (read receipts)
- Już mamy `lastReadAt` per członek — wystarczy UI: mini-awatary "przeczytali do tego
  miejsca" na dole widocznych wiadomości (jak Messenger) + tooltip z listą.
- Wyłączalne per-organizacja w ustawieniach admina (prywatność).

### C.3 Composer v2 (lekki rich-text)
- Zamiana `<input>` na `<textarea>` auto-rosnącą (Shift+Enter = nowa linia — DZIŚ NIE DZIAŁA,
  wiadomości wielolinijkowe można tworzyć tylko wklejając).
- Pasek formatowania (B/I/S/code/link) wstawiający składnię markdown + podgląd na żywo (toggle).
- Wklejanie linku na zaznaczonym tekście → `[tekst](url)` + render linków markdown
  w `markdown.tsx` (dziś tylko gołe URL-e).

### C.4 Drobne, często wnioskowane
- Edycja ostatniej wiadomości strzałką ↑ (pusty composer).
- "Oznacz jako nieprzeczytane" od wiadomości X.
- Podgląd wiadomości przy powiadomieniu push (treść skrócona — opt-in, domyślnie tytuł).

**Weryfikacja:** reakcja dowolnym emoji z pickera, custom emoji `:firmowe:` renderuje się,
wielolinijkowa wiadomość przez Shift+Enter, read receipts widoczne u drugiego użytkownika.

---

## Sprint F6-D — Pliki i media v2

- **Galeria kanału**: zakładka w panelu członków — siatka miniatur wszystkich
  obrazów/plików kanału (paginowana, reużycie istniejących thumbów).
- **Odtwarzacze inline**: wideo (mp4/webm — `<video>` z presigned URL), audio (mp3/ogg).
  Limit rozmiaru bez zmian (25 MB); bez transkodowania (koszt) — tylko natywne formaty.
- **Wiele plików naraz**: drag&drop wielu → jeden komunikat z siatką załączników (dziś działa,
  ale UI listy pending jest surowe — poprawić na siatkę z miniaturami).
- **Porządki R2**: lifecycle rules (dokumentacja: exporty RODO auto-usuwane po 24h już są,
  dodać orphan-cleanup worker — pliki bez `messageId` starsze niż 24h = porzucone uploady).
- **Kompresja obrazów po stronie klienta** przed uploadem (canvas, max 2048px, jakość 0.85,
  opt-out checkbox "wyślij oryginał") — oszczędza R2 i transfer użytkowników mobile.

**Weryfikacja:** galeria pokazuje historię obrazów, wideo odtwarza się inline,
upload 5 plików naraz wygląda porządnie, worker czyści porzucone uploady.

---

## Sprint F6-E — Bezpieczeństwo v2

> System logowania NIETYKANY (wb-platform). Poniższe wzmacnia wszystko wokół.

### E.1 Zarządzanie sesjami (widoczność dla użytkownika)
- Ustawienia → "Aktywne sesje": lista (urządzenie/UA, IP, ostatnia aktywność,
  bieżąca sesja oznaczona) + "Wyloguj tę sesję" / "Wyloguj wszystkie inne".
  (Backend ma wszystko: tabela `Session` + `revokeSession` — brakuje tylko API listy + UI.)

### E.2 Nagłówki i polityki
- **CSP** (Content-Security-Policy) przez `@fastify/helmet` na API i meta/header na Vercel:
  `default-src 'self'`, jawne wyjątki na R2 presigned, websocket, Groq nie potrzebny (server-side).
- HSTS, X-Content-Type-Options, Referrer-Policy (część jest w `@fastify/helmet` — audyt czego brakuje).
- `Permissions-Policy` ograniczająca mikrofon/kamerę do własnego originu.

### E.3 E2EE dla DM — fundament (etap 1 z 2)
- Zgodnie z PLAN.md faza 2: libsodium (X25519 + XChaCha20-Poly1305).
- Etap 1 (ta faza): generacja pary kluczy na urządzeniu, publikacja klucza publicznego
  (`User.publicKey` już istnieje w schemacie!), wymiana i szyfrowanie **nowych** DM 1:1
  za feature-flagą (opt-in per rozmowa, oznaczenie 🔒 E2EE).
- Świadome ograniczenia etapu 1 (udokumentować): brak multi-device sync kluczy,
  brak szyfrowania historii, wyszukiwarka nie widzi treści E2EE (by design).
- Etap 2 (przyszła faza): backup kluczy hasłem, grupowe DM.

### E.4 Higiena łańcucha dostaw
- CI: `pnpm audit --audit-level high` już jest jako continue-on-error → zmienić na
  **blokujące** + dodać `dependabot.yml` (tygodniowe PR-y aktualizacji).
- Skan sekretów: `gitleaks` jako job CI (historia repo + każdy PR).
- Backup bazy: dokumentacja procedury Neon point-in-time-restore + tygodniowy
  `pg_dump` do R2 (worker BullMQ, szyfrowany kluczem z env).

### E.5 Rate-limity i anty-abuse (audyt i uzupełnienie)
- Audyt wszystkich mutujących endpointów pod kątem limitów (dziś: login, register, WS eventy).
- Dodać limity na: tworzenie kanałów, zaproszenia, upload (per-user/dzień), AI (już jest globalny — dodać per-user).

**Weryfikacja:** lista sesji działa i rewokacja natychmiastowa, securityheaders.com
ocena A, dwie karty wymieniają E2EE DM (podgląd w DB = szyfrogram), CI blokuje
podatność high, gitleaks przechodzi na czystym repo.

---

## Sprint F6-F — Skala i wydajność

- **Nieskończona paginacja w górę**: dziś ładujemy ostatnie 50 wiadomości i tyle —
  dodać doładowywanie starszych przy scrollu do góry (`listMessages` ma już cursor!).
- **Licznik nieprzeczytanych bez skanu**: obecne `take: 200` na kanał przy liście kanałów
  nie skaluje się — zamienić na zapytanie agregujące `COUNT(*) WHERE createdAt > lastReadAt`
  (jedno grupowane zapytanie dla wszystkich kanałów usera).
- **Indeksy**: audyt EXPLAIN na najczęstszych zapytaniach (messages by channel+createdAt
  jest; sprawdzić reactions, files, audit_logs pod realnym wolumenem).
- **Cache Redis**: lista członków organizacji (TTL 60 s, inwalidacja przy zmianach) —
  najczęstsze zapytanie przy każdym renderze wiadomości.
- **Lazy loading frontendu**: route-splitting (Admin, SuperAdmin, Settings jako osobne
  chunki — dziś wszystko w jednym bundle), `React.lazy` dla PdfViewer (już jest) i emoji-mart.
- **Web-vitals budżet**: LCP < 2.5 s na produkcji (mamy /rum — dodać alert w README/metrics).

**Weryfikacja:** scroll w górę doładowuje historię, czas listy kanałów przy 50+ kanałach
< 300 ms, bundle main zmniejszony (raport `vite build` przed/po).

---

## Sprint F6-G — Gotowość ekosystemowa (wb-platform)

> Zakres UZGODNIONY z sekcją 7.1 PLAN.md wb-platform. **Nie ruszamy lokalnego auth.**
> Wszystko za feature-flagami `HUB_*` env — bez konfiguracji chat działa jak dziś.

- **Konsument webhooka `entitlements.updated`**: endpoint `POST /api/v1/hub/webhooks`
  (weryfikacja podpisu HMAC z env `HUB_WEBHOOK_SECRET`), na start obsługa jednego
  eventu: aktywny/nieaktywny chat dla organizacji → flaga `Organization.suspendedAt`
  (zawieszona organizacja: logowanie działa, ale UI pokazuje "produkt nieaktywny").
- **Punkt zaczepienia SSO** (implementacja PO stronie Huba, my tylko przygotowujemy):
  endpoint `GET /api/v1/hub/sso/callback` — szkielet: weryfikacja tokenu przez JWKS Huba
  (`jose.createRemoteJWKSet` — biblioteka już jest), JIT provisioning
  (user po `email` claim; organizacja po `org_id` claim → mapowanie do istniejącej
  `Organization.slug`), utworzenie NORMALNEJ lokalnej sesji (reużycie `issueSession`).
  Za flagą `HUB_JWKS_URL` — bez env endpoint zwraca 404.
- **Mapowanie ról Hub→chat**: `OWNER→OWNER, ADMIN→ADMIN, MEMBER→MEMBER` (funkcja czysta + test).
- **Health-check dla Huba**: istniejący `/health/ready` wystarczy — udokumentować kontrakt.
- Koordynacja: przed implementacją SSO callback zsynchronizować nazwy claims z agentem
  wb-platform (dokument `INTEGRACJA-HUB.md` w repo chatv2 jako kontrakt).

**Weryfikacja:** webhook z poprawnym podpisem zawiesza org (UI banner), z błędnym → 401;
callback bez `HUB_JWKS_URL` → 404; testy mapowania ról.

---

## Sprint F6-H — PWA / mobile natywność

- **Manifest + service worker v2**: instalowalna PWA (ikony, splash, `display: standalone`) —
  SW już istnieje dla push; rozszerzyć o precache shellu aplikacji (Workbox przez `vite-plugin-pwa`).
- **Offline**: szkice zapisują się lokalnie (już są w localStorage), dodać kolejkę
  "wyślij po odzyskaniu połączenia" + read-only cache ostatnio otwartego kanału.
- **Long-press na mobile**: przytrzymanie wiadomości → akcje (dziś przycisk "⋯" —
  zostaje, long-press jako dodatkowy naturalny gest); przytrzymanie kanału → reorder na dotyk
  (uzupełnienie F5-I, który działa tylko myszką).
- **Bezpieczne strefy**: `env(safe-area-inset-*)` dla notchy/home indicatora.
- **Haptyka**: `navigator.vibrate(10)` na akcjach (wysłanie, reakcja) — progressive enhancement.

**Weryfikacja:** Lighthouse PWA installable, offline pokazuje ostatni kanał,
long-press otwiera akcje na emulacji touch.

---

## Sprint F6-I — Admin analytics + retencja

- **Dashboard v2** (rozbudowa istniejącego): aktywni dzienni/tygodniowi (DAU/WAU),
  wiadomości per kanał (top 10), wykorzystanie storage per organizacja (suma z tabeli files),
  wykorzystanie dziennego limitu AI (odczyt z istniejącego licznika Redis).
- **Retencja per kanał** (nadpisuje org-level `messageRetentionDays` w dół) — worker już
  istnieje, rozszerzyć o poziom kanału.
- **Eksport zbiorczy organizacji** (OWNER): całe archiwum wiadomości org jako ZIP
  (reużycie data-export workera z F3-1, wariant org-wide).
- **Dziennik zdarzeń administracyjnych** — filtry audit logu po typie akcji (UI dropdown,
  backend już wspiera `action` filter).

**Weryfikacja:** dashboard pokazuje realne DAU, retencja kanału usuwa starsze wiadomości
w teście, eksport org-wide generuje kompletny ZIP.

---

## Zasady wykonania (kontynuacja dotychczasowych)

- Po każdym sprincie: typecheck + testy + weryfikacja E2E w przeglądarce + commit + push.
- Deny-by-default authz, 404 nie 403 (IDOR), audit przez `logAudit()`, modale przez portale.
- Klucze/sekrety tylko server-side; brak env = feature off, nie crash.
- Twarde limity darmowych API (Redis) — zero kosztów bez wyjątków.
- `git pull` przed pushem (drugi deweloper + agent wb-platform mogą commitować równolegle).
- **Nie dotykamy:** `modules/auth/**` (poza dodaniem pól do odpowiedzi), rejestracji, refresh flow.
- Prisma migracje: produkcja dostaje je automatycznie przez `render.yaml` buildCommand.

## Proponowana kolejność startu

1. **F6-C.3 composer multiline** (Shift+Enter) — najbardziej odczuwalny brak, 1 dzień.
2. **F6-A** (redesign v3) — fundament wizualny pod resztę.
3. **F6-B** (głos v2 SFU) — największa nowa wartość; wymaga decyzji o VPS (Oracle Free/Render).
4. **F6-E** (bezpieczeństwo) — sesje-UI i CSP szybkie; E2EE etap 1 największy kawałek.
5. Dalej wg potrzeb biznesowych.
