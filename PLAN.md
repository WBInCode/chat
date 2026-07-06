# ChatV2 — Wewnętrzny komunikator firmowy (ekosystem)

> Dokument przygotowawczy / specyfikacja techniczna. Cel: pełna rozpiska architektury, stacku, bezpieczeństwa, designu i planu implementacji dla kolejnego modelu (Sonnet 5), który będzie realizował kod.

---

## 1. Kontekst ekosystemu

Budujemy ekosystem aplikacji (analogia: Google Workspace):
- Istnieją już: CRM dla firm, dziennik sportowy, CRM handlowy.
- Docelowo: centralny punkt logowania (SSO / "proxy") spinający wszystkie aplikacje.
- **Ten projekt**: wewnętrzny chat firmowy (wzór: Google Chat / Slack) z naciskiem na bezpieczeństwo i szyfrowanie.

**Kluczowa decyzja architektoniczna:** chat od początku projektujemy pod przyszłe SSO. Auth wydzielamy do osobnego modułu (`auth-service` lub przynajmniej osobnej warstwy w kodzie), tak by później podpiąć centralny Identity Provider (IdP) bez przepisywania aplikacji.

---

## 2. Zakres funkcjonalny (MVP → v2)

### MVP (faza 1)
1. Rejestracja/logowanie (email + hasło, 2FA TOTP opcjonalne).
2. Organizacje (multi-tenant): użytkownik należy do firmy; izolacja danych między firmami.
3. Wiadomości bezpośrednie (DM) 1:1.
4. Kanały/pokoje (publiczne w ramach firmy + prywatne na zaproszenie).
5. Wiadomości tekstowe w czasie rzeczywistym (WebSocket), historia, paginacja.
6. Statusy obecności (online/away/offline), wskaźnik "pisze...".
7. Potwierdzenia odczytu (read receipts) na poziomie kanału.
8. Edycja/usuwanie własnych wiadomości (z flagą "edytowano").
9. Wyszukiwanie wiadomości (w ramach uprawnień).
10. Role: owner / admin / member (per organizacja) + admin/member per kanał.

### Faza 2
> Szczegółowy, zaktualizowany plan fazy 2: **[PLAN-FAZA2.md](./PLAN-FAZA2.md)** (pliki+media, podglądy dokumentów, embedy linków, redesign liquid glass, panel HR/Admin).

11. Załączniki (obrazy, pliki) — upload do S3-kompatybilnego storage, skan antywirusowy.
12. Wątki (threads) pod wiadomościami.
13. Reakcje emoji.
14. Wzmianki @user, @channel + powiadomienia.
15. Powiadomienia push (Web Push) + email digest.
16. Szyfrowanie E2EE dla DM (opcjonalny tryb — szczegóły w §6).

### Faza 3
17. Rozmowy audio/video (WebRTC + SFU np. LiveKit self-hosted).
18. Integracje z pozostałymi aplikacjami ekosystemu (boty, webhooki).
19. Eksport / retencja danych, panel compliance dla admina firmy.

---

## 3. Stack technologiczny

### Backend
| Element | Wybór | Uzasadnienie |
|---|---|---|
| Runtime | **Node.js 22 LTS + TypeScript 5** | spójność z frontem, ekosystem, łatwy handoff |
| Framework HTTP | **Fastify 5** | szybki, schema-validation wbudowana (JSON Schema / TypeBox) |
| Realtime | **Socket.IO 4** (na Fastify) | rooms, reconnection, fallbacki; prostsze niż surowy ws |
| ORM | **Prisma** | typowany, migracje, szybki development |
| Baza danych | **PostgreSQL 16** | relacyjna, RLS (Row Level Security) dla multi-tenancy |
| Cache / pub-sub | **Redis 7** | presence, socket adapter (skalowanie poziome), rate-limiting, sesje |
| Kolejka | **BullMQ** (Redis) | powiadomienia, maile, skan plików |
| Storage plików | **MinIO** (S3 API, self-hosted) | pliki poza bazą, presigned URLs |
| Wyszukiwarka | Postgres FTS (`tsvector`) w MVP; Meilisearch w fazie 2 | bez przekombinowania na start |
| Walidacja | **Zod** (współdzielone schematy front/back w pakiecie `shared`) | jedno źródło prawdy |

### Frontend
| Element | Wybór |
|---|---|
| Framework | **React 19 + Vite + TypeScript** (SPA — chat nie potrzebuje SSR/SEO) |
| Routing | React Router 7 |
| State/server-cache | **TanStack Query 5** (REST) + własny store na socket events (**Zustand**) |
| Styling | **Tailwind CSS 4** + własny design system (tokens — patrz §7) |
| Komponenty | Radix UI primitives (dostępność) + własne stylowanie |
| Formularze | react-hook-form + zod resolver |
| Ikony | Lucide |
| Krypto (E2EE) | WebCrypto API + `libsodium-wrappers` (faza 2) |

### Infrastruktura / DevOps
- **Monorepo: pnpm workspaces + Turborepo**
- **Docker Compose** (dev): postgres, redis, minio, api, web.
- Produkcja: Docker na VPS + **Caddy** (auto-TLS) lub Nginx; docelowo przygotowane pod Kubernetes.
- CI: GitHub Actions — lint, typecheck, testy, build, skan zależności (`pnpm audit`, Trivy dla obrazów).
- Testy: **Vitest** (unit), **Supertest** (API), **Playwright** (E2E krytyczne ścieżki).
- Logi: **pino** (structured JSON), bez danych wrażliwych; Sentry na błędy.

### Struktura monorepo
```
chatv2/
├── apps/
│   ├── api/                # Fastify + Socket.IO
│   │   ├── src/
│   │   │   ├── modules/    # auth, orgs, channels, messages, files, presence
│   │   │   │   └── <mod>/  # routes.ts, service.ts, repo.ts, schemas.ts
│   │   │   ├── ws/         # gateway socket.io, handlery eventów
│   │   │   ├── plugins/    # auth guard, rate-limit, cors, helmet
│   │   │   ├── lib/        # crypto, redis, s3, mailer
│   │   │   └── server.ts
│   │   └── prisma/schema.prisma
│   └── web/                # React SPA
│       └── src/
│           ├── features/   # auth, chat, channels, settings, admin
│           ├── components/ # design system (ui/), layouty
│           ├── lib/        # api client, socket client, crypto (E2EE)
│           └── stores/
├── packages/
│   ├── shared/             # typy, zod schemas, stałe eventów WS
│   └── config/             # eslint, tsconfig bazowe
├── docker-compose.yml
├── turbo.json
└── PLAN.md
```

---

## 4. Model danych (Prisma — szkic)

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  members   Membership[]
  channels  Channel[]
}

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String              // argon2id
  displayName   String
  avatarUrl     String?
  totpSecret    String?             // zaszyfrowane at-rest (AES-256-GCM, klucz z ENV/KMS)
  totpEnabled   Boolean  @default(false)
  publicKey     String?             // X25519 identity key (E2EE, faza 2)
  createdAt     DateTime @default(now())
  memberships   Membership[]
  sessions      Session[]
}

model Membership {
  id     String  @id @default(uuid())
  userId String
  orgId  String
  role   OrgRole @default(MEMBER)   // OWNER | ADMIN | MEMBER
  @@unique([userId, orgId])
}

model Channel {
  id        String      @id @default(uuid())
  orgId     String
  type      ChannelType // PUBLIC | PRIVATE | DM
  name      String?     // null dla DM
  createdBy String
  createdAt DateTime    @default(now())
  members   ChannelMember[]
  messages  Message[]
  @@index([orgId])
}

model ChannelMember {
  id         String      @id @default(uuid())
  channelId  String
  userId     String
  role       ChannelRole @default(MEMBER)
  lastReadAt DateTime?   // read receipts / unread count
  @@unique([channelId, userId])
}

model Message {
  id        String    @id @default(uuid())
  channelId String
  authorId  String
  content   String    // plaintext (server-side encryption at rest) LUB ciphertext (E2EE DM)
  contentType String  @default("text") // text | file | system
  parentId  String?   // wątki (faza 2)
  editedAt  DateTime?
  deletedAt DateTime? // soft delete
  createdAt DateTime  @default(now())
  @@index([channelId, createdAt])
}

model Session {
  id            String   @id @default(uuid())
  userId        String
  refreshHash   String   // sha256 refresh tokena — nigdy plaintext
  userAgent     String?
  ip            String?
  expiresAt     DateTime
  revokedAt     DateTime?
}

model AuditLog {
  id        String   @id @default(uuid())
  orgId     String
  actorId   String?
  action    String   // np. "channel.create", "member.remove", "login.failed"
  meta      Json
  ip        String?
  createdAt DateTime @default(now())
  @@index([orgId, createdAt])
}
```

**Multi-tenancy:** każde zapytanie filtrowane po `orgId`; dodatkowo Postgres **RLS** jako druga linia obrony (polityki na tabelach z `orgId`, sesja DB ustawia `app.current_org_id`).

---

## 5. API i protokół realtime

### REST (prefiks `/api/v1`)
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/2fa/setup`, `POST /auth/2fa/verify`
- `GET/POST /orgs`, `POST /orgs/:id/invites`, `POST /invites/:token/accept`
- `GET/POST /orgs/:orgId/channels`, `PATCH/DELETE /channels/:id`, `POST /channels/:id/members`
- `GET /channels/:id/messages?cursor=&limit=50` (cursor-based pagination, od najnowszych)
- `POST /channels/:id/messages` (fallback HTTP; podstawowo przez WS)
- `PATCH/DELETE /messages/:id`
- `POST /files/presign` → presigned PUT do MinIO (po walidacji typu/rozmiaru)
- `GET /search?q=` (scope: kanały użytkownika)

Wszystkie wejścia walidowane Zod/TypeBox; odpowiedzi błędów w formacie `{ error: { code, message } }`, bez stack trace.

### WebSocket (Socket.IO namespaces `/ws`)
Autoryzacja przy handshake (access token JWT w `auth` payload — nie w query stringu). Po połączeniu serwer sam dołącza socket do rooms = kanały użytkownika.

Eventy (stałe w `packages/shared/src/ws-events.ts`):
```
client → server: message:send {channelId, tempId, content}
                 message:edit / message:delete
                 typing:start / typing:stop {channelId}
                 read:mark {channelId, messageId}
server → client: message:new {message}          (z tempId dla ack optymistycznego UI)
                 message:updated / message:deleted
                 typing:update {channelId, userId}
                 presence:update {userId, status}
                 channel:created / channel:member-joined ...
```
- **Optimistic UI**: klient renderuje od razu z `tempId`, serwer odsyła kanoniczne `id`.
- Skalowanie: `@socket.io/redis-adapter` (pub/sub między instancjami API).
- Presence: klucze w Redis z TTL (heartbeat co 25 s), `SETEX presence:{userId}`.

---

## 6. Bezpieczeństwo — pełna specyfikacja

### 6.1 Uwierzytelnianie
- **Hasła: Argon2id** (memoryCost 64 MB, timeCost 3, parallelism 4). Nigdy bcrypt < 12 / md5 / sha.
- Polityka haseł: min. 12 znaków, sprawdzanie względem listy wycieków (zxcvbn score ≥ 3), bez wymuszania rotacji.
- **Tokeny:**
  - Access token: JWT (**EdDSA/Ed25519**, nie HS256), TTL **10 min**, w pamięci klienta (nie localStorage).
  - Refresh token: losowy 256-bit, **httpOnly + Secure + SameSite=Strict cookie**, TTL 14 dni, **rotacja przy każdym użyciu** + detekcja reuse (reuse → unieważnienie całej rodziny sesji).
  - W DB tylko hash refresh tokena (SHA-256).
- **2FA: TOTP** (RFC 6238) + kody zapasowe (10 × 8 znaków, hashowane). Sekret TOTP szyfrowany at-rest AES-256-GCM.
- Rate limiting logowania: 5 prób / 15 min per konto + per IP (Redis sliding window). Po przekroczeniu — opóźnienie wykładnicze, nie CAPTCHA-hell.
- Brak enumeracji użytkowników: identyczne odpowiedzi/timing dla "złe hasło" i "brak konta".
- Sesje widoczne w ustawieniach użytkownika (lista urządzeń + revoke).
- **Przygotowanie pod SSO:** interfejs `AuthProvider` w kodzie; później dołożenie OIDC (ekosystemowy IdP — rekomendacja: własny serwer na bazie **ory/hydra** lub **Keycloak** jako centralne logowanie dla wszystkich appek).

### 6.2 Autoryzacja
- RBAC dwupoziomowy: rola w organizacji + rola w kanale.
- Autoryzacja **na serwerze przy każdej operacji** (guard w service layer, nie tylko w route), zasada deny-by-default.
- IDOR-proof: każdy dostęp do zasobu weryfikuje membership (`user ∈ channel ∈ org`).
- RLS w Postgres jako defence-in-depth (§4).

### 6.3 Szyfrowanie
**Warstwa 1 — transport:** TLS 1.3 wszędzie (Caddy auto-cert), HSTS z preload, WSS dla socketów.

**Warstwa 2 — at-rest (serwerowe, MVP):**
- Dyski/DB: szyfrowanie wolumenów + `pgcrypto`/aplikacyjne AES-256-GCM dla pól wrażliwych (totpSecret, tokeny integracji).
- Klucze: w MVP z ENV (min. 32 bajty, generowane `openssl rand`), docelowo KMS/Vault. Wersjonowanie kluczy (`keyId` przy zaszyfrowanych polach) → możliwa rotacja.
- Pliki w MinIO: SSE (server-side encryption) włączone.

**Warstwa 3 — E2EE dla DM (faza 2, opcjonalny tryb per-konwersacja):**
- Protokół wzorowany na Signal (uproszczony, bez pełnego X3DH na start):
  - Każdy user generuje w przeglądarce parę **X25519** (identity) + prekeys; klucz prywatny **nigdy nie opuszcza urządzenia** (IndexedDB, opcjonalnie zaszyfrowany hasłem-PIN przez PBKDF/Argon2 w WASM).
  - Sesja DM: ECDH → HKDF → klucz symetryczny; wiadomości szyfrowane **XChaCha20-Poly1305** (libsodium) lub AES-256-GCM (WebCrypto).
  - Serwer przechowuje wyłącznie ciphertext; wyszukiwanie i podgląd admina niedostępne dla E2EE (komunikować to w UI).
  - Weryfikacja kluczy: safety numbers / QR (jak Signal) — faza 3.
- Kanały grupowe E2EE (sender keys / MLS) — świadomie **poza zakresem** do fazy 3+; nie robić naiwnie.
- **Ważne dla implementującego:** nie pisać własnej kryptografii — wyłącznie libsodium/WebCrypto, testy wektorami.

### 6.4 Ochrona aplikacyjna (OWASP Top 10)
- **XSS:** treści wiadomości renderowane jako tekst (React escapuje domyślnie); markdown przez `marked` + **DOMPurify**; CSP: `default-src 'self'`, bez `unsafe-inline` (style przez Tailwind build), `connect-src` tylko API/WS.
- **CSRF:** API bearer-token (access w headerze) → odporny; endpoint refresh (cookie) chroniony SameSite=Strict + nagłówek `Origin` check + custom header.
- **SQLi:** wyłącznie Prisma (parametryzacja); zakaz `$queryRawUnsafe`.
- **SSRF/upload:** walidacja MIME po magic bytes (nie rozszerzeniu), limit 25 MB, obrazy re-enkodowane (sharp), pliki serwowane z osobnej domeny/`Content-Disposition: attachment`, skan ClamAV w kolejce.
- Nagłówki: `@fastify/helmet` (CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none').
- Rate limiting globalny per-IP i per-user (Redis), osobne limity na WS eventy (np. 10 msg/s).
- Walidacja rozmiaru wiadomości (np. 8000 znaków), sanityzacja nazw kanałów/plików.
- Zależności: Renovate/Dependabot + `pnpm audit` w CI; lockfile committed.
- Sekrety: nigdy w repo; `.env` + `.env.example`; skan gitleaks w CI.

### 6.5 Audyt i prywatność
- `AuditLog` dla akcji administracyjnych i bezpieczeństwa (logowania, zmiany ról, usunięcia).
- Logi bez treści wiadomości i haseł; IP przechowywane z retencją 90 dni.
- RODO: eksport danych użytkownika, usunięcie konta (anonimizacja autora wiadomości), DPA-ready.

---

## 7. Design / UX

### Kierunek wizualny
- Charakter: **narzędzie pracy — czyste, gęste informacyjnie, spokojne**; bliżej Linear/Slack niż kolorowego konsumenckiego chatu.
- Layout (desktop): 3 kolumny — [sidebar: org switcher + lista kanałów/DM] | [wątek wiadomości] | [opcjonalny panel: szczegóły/wątek/członkowie]. Mobile: stack z nawigacją wstecz.
- Tryb jasny + ciemny od startu (CSS variables, `prefers-color-scheme` + toggle).

### Design tokens (Tailwind theme)
```
--bg:        #0E1116 (dark) / #FAFAF8 (light)
--surface:   #161B22 / #FFFFFF
--border:    #262D37 / #E6E4DF
--text:      #E8EAED / #1A1D21
--text-dim:  #8B939E / #6B7280
--accent:    #4F7CFF   (primary actions, mentions)
--accent-2:  #2EB67D   (online/success)
--danger:    #E5484D
--warning:   #F5A623
radius: 8px (surfaces), 6px (inputs), full (avatary)
font: Inter (UI), JetBrains Mono (kod w wiadomościach)
skala: 13px baza w liście wiadomości, 14px inputy, gęsty leading
```

### Kluczowe komponenty
- `MessageList` — wirtualizacja (`@tanstack/react-virtual`), grupowanie wiadomości tego samego autora w 5 min, separatory dat, kotwica "nowe wiadomości".
- `Composer` — textarea autogrow, Enter=wyślij / Shift+Enter=nowa linia, markdown preview, @mention autocomplete (faza 2).
- `ChannelSidebar` — sekcje (kanały/DM), badge unread, status dot obecności.
- Stany: skeletony przy ładowaniu, empty states z CTA, offline banner + kolejka wiadomości do ponowienia.
- Dostępność: pełna nawigacja klawiaturą, focus ring, aria-live dla nowych wiadomości, kontrast AA.

---

## 8. Plan implementacji (kolejność dla następnego modelu)

1. **Setup** — monorepo (pnpm+turbo), docker-compose (pg/redis/minio), skeleton api+web, CI lint/typecheck. ✅ kryterium: `docker compose up` + `pnpm dev` działa.
2. **Auth** — rejestracja, login, Argon2id, JWT+refresh rotation, middleware guard, testy. ✅: pełny cykl auth z testami Supertest.
3. **Orgs + membership** — tworzenie org, zaproszenia (tokeny jednorazowe), role, RLS.
4. **Channels + Messages (REST)** — CRUD, paginacja kursorem, uprawnienia, soft delete.
5. **Realtime** — Socket.IO gateway, redis adapter, message:send/new, typing, presence, optimistic UI.
6. **Frontend chat UI** — layout 3-kolumnowy, MessageList z wirtualizacją, Composer, unread.
7. **Read receipts + search (Postgres FTS) + ustawienia sesji/urządzeń.**
8. **Hardening** — helmet/CSP, rate limits, audit log, 2FA TOTP, testy bezpieczeństwa (przypadki IDOR, reuse refresh tokena).
9. **Faza 2** — pliki (presign+ClamAV), wątki, reakcje, mentions, web push, E2EE DM.

Każdy etap: migracje Prisma + testy + aktualizacja `packages/shared`.

## 9. Zasady dla implementującego modelu
- TypeScript `strict: true` wszędzie; zero `any` w warstwie domenowej.
- Schematy Zod w `packages/shared` — jedyne źródło typów DTO dla frontu i backu.
- Każdy endpoint: walidacja wejścia → autoryzacja → logika → typowana odpowiedź.
- Nie implementować własnych prymitywów kryptograficznych; tylko argon2, jose (EdDSA), libsodium, WebCrypto.
- Commity per feature; testy dla auth i uprawnień obowiązkowe zanim przejdzie się dalej.
- Wszystkie stringi UI po polsku (docelowo i18n — teksty w plikach `pl.ts` od początku).
