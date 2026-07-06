# FAZA 3 — ogólny update platformy chatv2

Stan wejściowy: MVP + Faza 2 (F2-1…F2-6) ukończone. 53/53 testów API. Deploy-ready (Dockerfile, vercel.json).
Cel fazy: domknięcie zgodności (RODO/retencja), dojrzałość produktowa (powiadomienia, profil, UX codziennego użytku), przygotowanie pod ekosystem (SSO).

## Sprinty

### F3-1 — Zgodność i higiena danych (dokończenie F2-7/F2-8)
- **Eksport RODO**: `GET /orgs/:id/admin/members/:userId/export` (OWNER/ADMIN) + `GET /me/export` (własne dane) — JSON ZIP: profil, członkostwa, wiadomości, pliki (metadane), audit wpisy dotyczące usera. Generowane asynchronicznie (BullMQ), link do pobrania przez presigned URL, wygasa po 24h.
- **Automatyczna retencja**: worker cron (BullMQ repeatable job, raz dziennie) usuwa wiadomości starsze niż `Organization.messageRetentionDays` (jeśli ustawione) + powiązane pliki z S3. Wpis audit `retention.purge` z licznikiem.
- **Usuwanie konta**: `DELETE /me` — anonimizacja (wiadomości zostają jako "Użytkownik usunięty"), pliki prywatne kasowane, sesje rewokowane.

### F3-2 — Powiadomienia
- **Web Push** (VAPID, service worker): powiadomienie przy wzmiance, DM i wiadomości w obserwowanym wątku, gdy karta nieaktywna.
- **Preferencje per użytkownik**: model `NotificationPreference` (all / mentions-only / none, per kanał override, godziny ciszy).
- **Badge w tytule karty** (`(3) chatv2`) + dźwięk (opcjonalny, domyślnie off).
- **Digest nieprzeczytanych**: endpoint `GET /me/unread-summary` używany po zalogowaniu (toast "3 nowe wzmianki").

### F3-3 — Profil użytkownika i prezencja+
- **Awatary**: upload (reuse pipeline plików: sharp → 128px webp, ClamAV), fallback inicjały z deterministycznym kolorem.
- **Profil**: imię/nazwisko, stanowisko, dział, telefon, status tekstowy ("Na urlopie do 12.08") + emoji statusu.
- **Prezencja rozszerzona**: online / away (idle 10 min, wykrywane client-side) / DND (wycisza powiadomienia).
- **Karta profilu** po kliknięciu w nazwisko (popover glass).

### F3-4 — UX codziennego użytku
- **Zakładki/przypięte**: przypinanie wiadomości w kanale (ADMIN/OWNER), lista przypiętych w headerze; osobiste zakładki (bookmark) na dowolnej wiadomości.
- **Szkice**: autozapis treści composera per kanał (localStorage), wskaźnik szkicu w sidebarze.
- **Formatowanie**: markdown subset (bold/italic/code/code-block/listy) — render bezpieczny (bez HTML injection), podgląd na żywo.
- **Nawigacja**: skok do daty, przycisk "↓ najnowsze" przy scrollu w górę, separator "Nowe wiadomości" od ostatniego odczytu.
- **Wyszukiwanie+**: filtry `from:@user`, `in:#kanał`, `has:file`, zakres dat.

### F3-5 — Przygotowanie pod ekosystem (SSO-ready)
- **OIDC provider-ready**: wydzielenie auth do modułu zdolnego do federacji — endpoint `/.well-known/openid-configuration` (draft), klucze JWKS publikowane pod `/api/v1/auth/jwks.json`.
- **API tokens / service accounts**: osobiste tokeny API (hash w DB, scope read-only/full) do integracji z pozostałymi systemami (CRM, dziennik).
- **Webhooks wychodzące**: per kanał, `message.created` → HTTP POST z podpisem HMAC (integracje z CRM).

### F3-6 — Jakość i operacje
- **Rate-limit audit**: przegląd wszystkich endpointów pod kątem limitów.
- **E2E testy Playwright**: login → wysłanie wiadomości → reakcja → wątek (smoke suite w CI).
- **Observability**: endpoint `/metrics` (Prometheus format) — liczba WS połączeń, kolejki BullMQ, latencja DB.
- **Optymalizacja bundle**: analiza vite bundle, code-split admin panelu i pdf.js (już lazy).

## Kolejność wykonania
1. F3-1 (zgodność — domyka Fazę 2, mała)
2. F3-3 (awatary/profil — fundament wizualny dla reszty)
3. F3-2 (powiadomienia — największa wartość dla użytkowników)
4. F3-4 (UX)
5. F3-5 (ekosystem)
6. F3-6 (jakość — częściowo równolegle przez całą fazę)

## Zasady (bez zmian)
- Deny-by-default authz, 404 nie 403, audit przez logAudit() (nigdy raw create).
- Każdy sprint: typecheck + testy + weryfikacja E2E w przeglądarce przed odhaczeniem.
- Fixed-position modale zawsze przez createPortal.
