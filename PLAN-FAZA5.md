# FAZA 5 — Wielki redesign UI/UX + zarządzanie + AI + głos + jakość

> Dokument planistyczny (Opus 4.8). Wykonanie: Sonnet. Każdy sprint = migracje → backend + testy → frontend → weryfikacja E2E w przeglądarce → commit na `main` (github.com/WBInCode/chat).
>
> **Kontekst produkcyjny:** frontend Vercel · Postgres Neon · Redis Upstash. Wymóg krytyczny dla AI i głosu: **100% darmowo, zero generowanych kosztów.**

---

## Cele nadrzędne
1. **Redesign UI/UX** — nowocześniejszy, mniej zatłoczony wygląd; migracja emotek-chrome na ikony graficzne; przebudowa sidebara; przeniesienie kontroli statusu na dół obok nazwy użytkownika.
2. **Zarządzanie kanałami** — tworzenie, edycja, przeglądanie, archiwizacja kanałów z UI (obecnie brak).
3. **Role i uprawnienia** — tworzenie i zarządzanie własnymi rolami z panelu admina (obecnie tylko 4 sztywne role).
4. **Asystent AI** — darmowe LLM (Groq + Gemini fallback), konkretne przypadki użycia.
5. **Rozmowy głosowe** — WebRTC P2P, sygnalizacja przez istniejący Socket.IO, darmowy STUN/TURN.
6. **Jakość** — pełny pakiet E2E (Playwright w CI) + metryki/observability.

---

## Sprint F5-A — Fundament designu + ikony + przebudowa sidebara
Największy wizualnie sprint. Cel: podnieść cały wygląd o poziom i usunąć „zatłoczenie".

### F5-A.1 — Biblioteka ikon
- Dodać **`lucide-react`** (MIT, tree-shakeable, spójny stroke, zero kosztu runtime).
- **Zasada:** ikony graficzne dla *chrome UI* (przyciski, nawigacja, akcje), emoji zostają dla *treści użytkownika* (reakcje, statusy emoji, ankiety).
- Migracja emotek-chrome → lucide:
  - 📎 → `Paperclip`, 📊 → `BarChart3`, 🕐 → `Clock`, 🔍 → `Search`, 🔖 → `Bookmark`, 📌 → `Pin`, ❮ → `Quote`, ↪️ → `Forward`/`CornerUpRight`, 🔗 → `Link2`, ⏰ → `AlarmClock`, ✏️ → `Pencil`, 🗑️ → `Trash2`, 👥 → `Users`, ★/☆ → `Star`, 🔔/🔕 → `Bell`/`BellOff`, ✕ → `X`, ☀️/🌙 → `Sun`/`Moon`, 🙂(reaction picker trigger) → `SmilePlus`, 💬 → `MessageSquare`.
- Zostawić jako emoji: reakcje (ALLOWED_REACTIONS), status emoji użytkownika, emoji w ankietach, wynik AI.
- Utworzyć `apps/web/src/components/Icon.tsx` — cienki wrapper (rozmiar/stroke/aria-label spójne), żeby nie rozsypać importów lucide po całym kodzie.

### F5-A.2 — Odświeżenie systemu designu (liquid glass v2)
- `styles/index.css`: przegląd tokenów — spójna skala odstępów, promieni (radius), cieni; zredukować „glass noise" (za dużo obramowań/blurów naraz). Wprowadzić 2-3 poziomy elevacji zamiast wielu ad-hoc.
- Typografia: skala rozmiarów (text-xs→2xl) + wyraźniejsza hierarchia nagłówek/treść/dim.
- Spójne stany hover/active/focus-visible dla wszystkich interaktywnych elementów (dostępność klawiaturowa).
- Gęstość: tryb „comfortable/compact" (opcjonalnie, później) — teraz ustandaryzować paddingi list.

### F5-A.3 — Przebudowa sidebara (rozwiązanie „zatłoczenia")
Nowa struktura pionowa sidebara:
1. **Górny pasek workspace** — nazwa organizacji + przełącznik org (jeśli >1) + menu (`MoreHorizontal`) zamiast trzech przycisków w rogu. `ThemeToggle` i „Wyloguj" przenieść do menu/stopki, NIE trzymać na górze.
2. **Pasek szybkich akcji** — Szukaj (otwiera Ctrl+K), Zapisane, (opcjonalnie) Wątki — jako rząd ikon, nie pełne przyciski.
3. **Sekcje kanałów** — nagłówki z możliwością zwijania (collapse): ⭐ Ulubione / Kanały / Wiadomości bezpośrednie / Zespół. Każda sekcja z przyciskiem „+" (dodaj kanał / nowa grupa DM).
4. **Stopka użytkownika (NOWOŚĆ, dół sidebara)** — awatar + nazwa + **kółko statusu**; **kliknięcie kółka statusu otwiera popover wyboru obecności** (Dostępny/Zaraz wracam/Nie przeszkadzać + niestandardowy status). To realizuje wprost prośbę użytkownika: **usunąć `PresenceToggle` z góry**, kontrola statusu ląduje na dole obok nazwy.

### F5-A.4 — `UserStatusControl.tsx` (nowy komponent)
- Renderowany w stopce sidebara: `<Avatar>` + displayName + kropka statusu (kolor wg presence).
- Klik → popover (portal) z opcjami trybu (reużywa logikę z `stores/presenceMode.ts` + `PresenceToggle`) oraz skrótem „Ustaw status" (emoji + tekst + auto-wygaśnięcie, reużywa pola z F4-E).
- `PresenceToggle` w obecnym miejscu (nagłówek) — usunąć.

**Weryfikacja F5-A:** wizualne screenshoty przed/po (dark+light), klik kółka statusu otwiera popover na dole, ikony renderują się zamiast emotek w chrome, sidebar wyraźnie mniej zatłoczony.

---

## Sprint F5-B — Zarządzanie kanałami (UI tworzenia/edycji/przeglądania)
Backend `POST /orgs/:orgId/channels` istnieje, ale **brak UI**. Dobudować pełny cykl.

### Backend (dopełnienie)
- `PATCH /channels/:channelId` — zmiana nazwy (channel-ADMIN), walidacja unikalności nazwy w org.
- `POST /channels/:channelId/archive` / `unarchive` — jeśli brak, dodać (Channel.archivedAt już w schemacie).
- `GET /orgs/:orgId/channels/browse` — lista WSZYSTKICH publicznych kanałów org (także tych, do których user nie należy) + flaga `isMember`, żeby móc dołączyć.
- `POST /channels/:channelId/join` — samodzielne dołączenie do kanału PUBLIC.
- Audit dla wszystkich akcji przez `logAudit()`.
- Testy: uprawnienia, unikalność nazw, join tylko PUBLIC, archiwizacja.

### Frontend
- **`CreateChannelModal.tsx`** (portal) — nazwa (walidacja `^[a-z0-9-]+$`), typ PUBLIC/PRIVATE, opcjonalny temat, przy PRIVATE multi-select członków. Przycisk „+" przy nagłówku „Kanały".
- **`BrowseChannelsModal.tsx`** — przeglądaj publiczne kanały org, dołącz jednym klikiem (`Hash`/`Lock` ikony, licznik członków).
- Edycja kanału: w istniejącym `ChannelMembersPanel` dodać zakładkę/sekcję „Ustawienia" (nazwa, temat, archiwizuj) dla channel-ADMIN.
- Zarchiwizowane kanały: filtr w sidebarze + sekcja „Zarchiwizowane" (zwinięta).

**Weryfikacja F5-B:** utworzenie kanału PUBLIC i PRIVATE z UI, dołączenie do publicznego przez Browse, zmiana nazwy, archiwizacja/przywrócenie.

---

## Sprint F5-C — Role i uprawnienia (custom roles)
Obecnie `OrgRole` to sztywny enum (OWNER/ADMIN/HR/MEMBER) + `PERMISSION_MATRIX`. Użytkownik chce **tworzyć i zarządzać rolami**.

### Model docelowy (zachowując bezpieczeństwo deny-by-default)
- Nowy model `Role`: `id, orgId, name, color, isSystem (bool), permissions (String[] / Json)`.
- **Role systemowe** (OWNER/ADMIN/HR/MEMBER) — seedowane jako `isSystem=true`, nieusuwalne, ale ich zestaw uprawnień może być punktem odniesienia.
- `Membership.roleId` → FK do `Role` (migracja: zmapować istniejący enum na role systemowe, zachować wsteczną zgodność — trzymać też `role` enum przez okres przejściowy lub zmapować w locie).
- Uprawnienia = istniejące `OrgAction` (member.invite, channel.manage, org.settings, org.auditLog, …) rozszerzone o nowe (channel.create, role.manage, ai.use, voice.use).
- `can(role, action)` → sprawdza `role.permissions.includes(action)` zamiast statycznej macierzy. `assertOrgPermission` bez zmian sygnatury.
- **Bezpiecznik:** tylko OWNER może zarządzać rolami z uprawnieniem `role.manage`; nie można podnieść własnych uprawnień ponad swoje; nie można edytować/usunąć roli OWNER; ostatni OWNER nie może stracić roli.

### Backend
- CRUD `/orgs/:orgId/roles` (GET list, POST create, PATCH update permissions/name/color, DELETE — tylko custom, tylko gdy brak przypisanych członków lub z reassignmentem).
- Przypisanie roli członkowi: rozszerzyć istniejący `/admin/members/:userId/role` o `roleId`.
- Audit każdej zmiany uprawnień (wrażliwe!). Testy: eskalacja uprawnień zablokowana, usunięcie roli systemowej zablokowane, ostatni OWNER chroniony.

### Frontend
- **Zakładka „Role" w AdminPanel** — lista ról (kolor + nazwa + liczba członków), edytor uprawnień (checkboxy pogrupowane: Członkowie / Kanały / Organizacja / AI / Głos), tworzenie roli, usuwanie custom roli.
- W zakładce „Członkowie" — dropdown ról zasilany z listy ról (nie hardcode).

**Weryfikacja F5-C:** utworzenie roli „Moderator" z wybranymi uprawnieniami, przypisanie członkowi, sprawdzenie że uprawnienie działa (np. może archiwizować kanał), próba eskalacji odrzucona (403).

---

## Sprint F5-D — Asystent AI (100% darmowy)
Wymóg: zero kosztów. **Rekomendacja providerów** (z free-llm-api-resources):
- **Primary: Groq** — OpenAI-compatible, bardzo szybki. Llama 3.3 70B (1000 req/dzień, 12k tok/min) do rozmów; Llama 3.1 8B (14 400 req/dzień) do lekkich zadań; **Whisper Large v3 (2000 req/dzień) do transkrypcji głosu** — kluczowe dla synergii z F5-E.
- **Fallback: Google AI Studio (Gemini 2.5 Flash / Gemma 3)** — 14 400 req/dzień (Gemma), duży kontekst; użyć gdy Groq zwróci 429.
- Klucze API **wyłącznie po stronie serwera** (Fastify), nigdy w kliencie. Rate-limit per user + globalny licznik dzienny w Redis (Upstash) żeby nie przekroczyć darmowych limitów.

### Architektura
- `lib/ai.ts` — abstrakcja providera: `chatCompletion(messages, opts)` z automatycznym fallbackiem Groq→Gemini, retry na 429, twardy budżet dzienny (licznik Redis `ai-quota:{YYYY-MM-DD}`, po przekroczeniu grzeczny komunikat „limit dzienny").
- `env.ts`: `GROQ_API_KEY?`, `GEMINI_API_KEY?`, `AI_DAILY_LIMIT` — wszystkie opcjonalne; brak kluczy = funkcje AI wyłączone (feature flag), nie crash.
- Nowy moduł `modules/ai/routes.ts`.

### Przypadki użycia (od najtańszych/najpewniejszych)
1. **Podsumowanie kanału/wątku** — „Podsumuj co przegapiłem" — bierze N ostatnich nieprzeczytanych, zwraca 3-5 punktów. Świetne UX, rzadkie wywołania.
2. **Asystent-bot w rozmowie** — wzmianka `@AI` w wiadomości → bot-użytkownik (systemowy) odpowiada w kanale/wątku (streaming przez WS). Kontekst = ostatnie wiadomości kanału.
3. **Inteligentne odpowiedzi (suggested replies)** — 3 krótkie propozycje odpowiedzi na ostatnią wiadomość (jednorazowy przycisk, opcjonalnie).
4. **Poprawa/przeredagowanie tekstu** w composerze — „Popraw ton / skróć / przetłumacz" na aktualnym drafcie.
5. **Transkrypcja notatek głosowych** (Whisper na Groq) — spina się z F5-E: nagranie głosowe → tekst.
- Wszystko za feature-flagą uprawnienia `ai.use` (integracja z F5-C).

### Frontend
- Bot systemowy „Asystent AI" jako pseudo-użytkownik (stały UUID, awatar `Sparkles`).
- Przycisk „✨ Podsumuj" w headerze kanału; `@AI` mention; menu „✨ AI" w composerze (przeredaguj/przetłumacz); wskaźnik „AI pisze…".
- Jasne oznaczenie treści AI (badge) + disclaimer o darmowym modelu.

**Weryfikacja F5-D:** `@AI` odpowiada w kanale, podsumowanie zwraca sensowne punkty, przekroczenie limitu daje grzeczny komunikat (bez kosztów), brak klucza = funkcja ukryta.

---

## Sprint F5-E — Rozmowy głosowe (WebRTC, darmowo)
Ograniczenie kosztowe determinuje architekturę.
- **Sygnalizacja:** istniejący Socket.IO (offer/answer/ICE candidates) — zero dodatkowego kosztu.
- **STUN:** publiczne darmowe (Google `stun:stun.l.google.com:19302`) — wystarcza dla większości NAT.
- **TURN (gdy P2P zawiedzie za symetrycznym NAT):** darmowy tier **Metered** (50 GB/mies.) lub **Cloudflare Calls** (darmowy tier) — opcjonalnie, przez env; bez klucza działa tylko STUN (P2P) z jasnym komunikatem o ograniczeniu.
- **Topologia:** **P2P mesh dla małych rozmów (2–4 osoby)** — brak SFU = brak kosztów serwera mediów. Powyżej 4 osób: komunikat „rozmowa do 4 osób" (SFU byłby płatny — świadomie poza zakresem darmowym).

### Backend
- Rozszerzyć `ws/gateway.ts` o eventy sygnalizacji: `voice:join`, `voice:leave`, `voice:offer`, `voice:answer`, `voice:ice`, `voice:participants`. Pokój głosowy = `voice:{channelId}`.
- Stan uczestników rozmowy w Redis (Upstash), TTL + heartbeat (jak presence).
- Uprawnienie `voice.use` (F5-C).

### Frontend
- `lib/webrtc.ts` — zarządzanie `RTCPeerConnection` per-peer (mesh), `getUserMedia` (audio), mute/unmute, wykrywanie mówienia (Web Audio API — podświetlenie mówiącego).
- `VoiceRoom.tsx` — panel aktywnej rozmowy (uczestnicy + awatary + wskaźnik mówienia + mute + rozłącz).
- Przycisk „🎙 Dołącz do rozmowy" (ikona `Mic`) w headerze kanału; wskaźnik aktywnej rozmowy w sidebarze.
- (Opcjonalnie, jeśli czas) **notatki głosowe** — nagranie krótkiego audio, upload (istniejący pipeline plików), transkrypcja przez Whisper/Groq (spięcie z F5-D).

**Weryfikacja F5-E:** dwie karty przeglądarki (2 konta) łączą się głosowo przez STUN, mute działa, wskaźnik mówiącego reaguje, rozłączenie czyści stan. (TURN trudny do zweryfikowania lokalnie — udokumentować.)

---

## Sprint F5-F — Jakość: E2E + metryki/observability
### E2E (Playwright)
- Skonfigurować `@playwright/test` w `apps/web` (osobny projekt, nie mylić z vitest).
- Smoke-suite krytycznych ścieżek: login → wysłanie wiadomości → reakcja → wątek → utworzenie kanału → ankieta → wylogowanie.
- Uruchamiać w CI (`.github/workflows/ci.yml`) headless; artefakty (screenshoty/trace) na porażce.
- Uwaga z pamięci: w tym środowisku dev klik/hover bywa niestabilny — testy E2E na produkcyjnym buildzie (`vite preview`) są stabilniejsze niż na dev z HMR.

### Metryki / Observability (darmowo)
- **`/metrics`** (Prometheus format, `prom-client`): liczba połączeń WS, długości kolejek BullMQ, latencja zapytań DB, licznik żądań/errorów per route, zużycie darmowego limitu AI.
- **Web Vitals** (frontend): LCP/INP/CLS logowane do backendu (endpoint `/api/v1/rum`) lub konsoli — bez płatnego RUM.
- **Structured error tracking:** rozszerzyć pino (już jest) o korelację requestId; opcjonalnie Sentry free tier (5k events/mies.) za env-flagą.
- **Health/readiness:** rozbudować `/health` o status DB/Redis/S3/kolejek (dla monitoringu uptime, np. darmowy UptimeRobot).

**Weryfikacja F5-F:** `pnpm --filter @chatv2/web e2e` przechodzi lokalnie i w CI, `/metrics` zwraca poprawny format, web-vitals się logują.

---

## Sprint F5-G — Dopracowanie i rollout
- Przegląd dostępności (a11y): focus-visible, aria-label na ikonach (już w `Icon.tsx`), kontrast, nawigacja klawiaturą, `prefers-reduced-motion`.
- Responsywność: sidebar zwijany na wąskich ekranach (drawer), paski akcji adaptacyjne.
- Aktualizacja README (nowe funkcje, zmienne env: GROQ/GEMINI/TURN), `.env.example`.
- Przegląd bezpieczeństwa nowych powierzchni: AI (prompt injection z treści użytkownika — sanityzacja/ograniczenie kontekstu, klucze tylko serwer), voice (autoryzacja pokoju = membership kanału), roles (eskalacja).
- Finalna pełna walidacja: `turbo run build typecheck test` + E2E + ręczny przegląd wizualny dark/light.

---

## Kolejność wykonania i zależności
1. **F5-A** (design/ikony/sidebar/status) — najpierw, bo dotyka wszystkiego wizualnie.
2. **F5-B** (kanały) — samodzielny, szybki, wysoka wartość.
3. **F5-C** (role) — fundament pod uprawnienia `ai.use`/`voice.use`, więc PRZED F5-D/E.
4. **F5-D** (AI) — po rolach.
5. **F5-E** (głos) — po rolach; Whisper spina się z AI.
6. **F5-F** (jakość) — częściowo równolegle, finalizacja na końcu.
7. **F5-G** — domknięcie.

## Zasady (bez zmian względem poprzednich faz)
- Deny-by-default authz, 404 nie 403, audit przez `logAudit()`.
- Wszystkie modale/popovery przez `createPortal`.
- Klucze AI/TURN tylko po stronie serwera; brak klucza = feature-flag off, nie crash.
- Twarde limity darmowych API (licznik Redis) — nigdy nie generować kosztów.
- Po każdym sprincie: typecheck + testy + weryfikacja E2E w przeglądarce + commit.
- `<input type="datetime-local">`: formatowanie lokalne, nigdy `toISOString()` (patrz pamięć).
