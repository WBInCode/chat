# chatv2 — wewnętrzny komunikator firmowy

Część ekosystemu aplikacji firmowych. Pełna specyfikacja: [PLAN.md](./PLAN.md).

## Wymagania

- Node.js ≥ 22, pnpm ≥ 10, Docker Desktop

## Szybki start (dev)

```bash
# 1. Infrastruktura (Postgres :5434, Redis :6382, MinIO :9010/:9011)
docker compose up -d

# 2. Zależności
pnpm install

# 3. Konfiguracja API
cd apps/api
cp .env.example .env
node scripts/generate-jwt-keys.mjs
# W .env ustaw FIELD_ENCRYPTION_KEY (openssl rand -base64 32) i COOKIE_SECRET

# 4. Baza danych
pnpm prisma migrate dev

# 5. Uruchomienie (z katalogu głównego)
cd ../..
pnpm dev            # API :4000 + Web :5273
```

## Komendy

| Komenda | Opis |
|---|---|
| `pnpm dev` | API + frontend w trybie watch |
| `pnpm typecheck` | TypeScript w całym monorepo |
| `pnpm test` | Testy (wymaga działającego docker compose) |
| `pnpm build` | Build produkcyjny |
| `pnpm db:migrate` | Migracje Prisma |
| `pnpm db:studio` | Prisma Studio |

## Struktura

```
apps/api       Fastify + Socket.IO + Prisma (backend)
apps/web       React 19 + Vite + Tailwind 4 (frontend)
packages/shared  Zod schemas, DTO, stałe WS — jedno źródło prawdy
packages/config  Bazowe tsconfig/eslint
```

## Status implementacji (PLAN.md §8)

- [x] Krok 1 — Setup: monorepo, docker-compose, CI, skeleton api+web
- [x] Krok 2 — Auth: Argon2id, JWT EdDSA, refresh rotation + reuse detection, revocation, testy (10)
- [x] Krok 3 — Organizacje + membership + zaproszenia (jednorazowe tokeny hashowane)
- [x] Krok 4 — Kanały (PUBLIC/PRIVATE/DM) + wiadomości REST (paginacja kursorem, soft delete)
- [x] Krok 5 — Realtime: Socket.IO + Redis adapter, typing, presence, optimistic UI
- [x] Krok 6 — UI chatu: sidebar (kanały/DM/zespół), lista wiadomości z grupowaniem, composer
- [x] Krok 7 — Read receipts (badge unread + mark-read) + wyszukiwanie (Postgres FTS, live search)
- [x] Krok 8 — Hardening: testy IDOR/autoryzacji (10), 2FA UI (TOTP + kody zapasowe), single-flight refresh, silent session restore
- [ ] Faza 2 — szczegółowy plan: [PLAN-FAZA2.md](./PLAN-FAZA2.md)
  - [x] F2-1 — Pliki i obrazki: presign/complete/url (MinIO), magic-byte sniffing, miniatury (sharp), paste/drag&drop, lightbox
  - [x] F2-2 — ClamAV + BullMQ: skan antywirusowy asynchroniczny (INSTREAM), usuwanie zainfekowanych plików, live status przez WS (`file:status`)
  - [x] F2-3 — Podgląd dokumentów: PDF przez pdf.js (lazy-loaded), DOCX/XLSX/PPTX→PDF przez Gotenberg (BullMQ worker), modal z nawigacją stron i zoomem
  - [x] F2-4 — Embedy linków: unfurl OG/Twitter Cards z ochroną SSRF (blokada IP prywatnych/link-local/loopback, walidacja każdego przekierowania, tylko porty 80/443), obrazy proxowane przez MinIO
  - [x] F2-5 — Redesign liquid glass: 2 motywy (jasny/ciemny, bez FOUC), mesh gradient, animacje CSS (wiadomości, badge, modale, typing dots), wirtualizacja listy wiadomości (@tanstack/react-virtual)
  - [x] F2-5b — Zarządzanie wiadomościami: wątki (panel boczny, licznik odpowiedzi), edycja inline, cofanie wiadomości, reakcje emoji (10), wzmianki @user z autocomplete i podświetleniem, Ctrl+K, licznik znaków, stylowany scrollbar
  - [x] F2-6 — Panel HR/Admin: rola HR + macierz uprawnień `can()`, zarządzanie członkami (zmiana roli, deaktywacja z natychmiastowym revoke sesji), archiwizacja kanałów, audit log z hash-chain (tamper-evident), ustawienia organizacji (2FA wymuszone, retencja, domeny email), dashboard z histogramem
  - [ ] F2-7, F2-8 — patrz PLAN-FAZA2.md (eksport RODO, retencja automatyczna, dalsze doprecyzowania)
- [ ] Faza 3 — ogólny update platformy: [PLAN-FAZA3.md](./PLAN-FAZA3.md)
  - [x] F3-1 — Zgodność: eksport RODO, retencja automatyczna, usuwanie konta
  - [ ] F3-2 — Powiadomienia: Web Push, preferencje, badge, digest
  - [x] F3-3 — Profil: awatary, status, prezencja away/DND, karta profilu
  - [ ] F3-4 — UX: przypięte/zakładki, szkice, markdown, nawigacja, filtry wyszukiwania
  - [ ] F3-5 — Ekosystem: JWKS, tokeny API, webhooks
  - [ ] F3-6 — Jakość: E2E Playwright, /metrics, bundle
- [ ] Faza 4 — pełnofunkcyjny komunikator (23 nowe funkcje): [PLAN-FAZA4.md](./PLAN-FAZA4.md)
  - [x] F4-A — Wiadomości pro: markdown, przypinanie, zapisane, forward, cytowanie, permalinki
  - [x] F4-B — Kanały pro: opis/temat, zarządzanie członkami, mute, grupowe DM, ulubione
  - [x] F4-C — Powiadomienia: Web Push, preferencje, badge title, podsumowanie
  - [x] F4-D — Wyszukiwanie pro: filtry, Ctrl+P przełącznik, separator nowych
  - [x] F4-E — Codzienna praca: szkice, wyślij później, przypomnienia, ankiety, auto-statusy
- [x] Faza 5 — redesign UI/UX + zarządzanie + AI + głos + jakość: [PLAN-FAZA5.md](./PLAN-FAZA5.md)
  - [x] F5-A — Fundament designu: ikony (lucide), liquid glass v2, przebudowa sidebara, status na dole
  - [x] F5-B — Zarządzanie kanałami: tworzenie/edycja/przeglądanie/archiwizacja z UI
  - [x] F5-C — Role i uprawnienia: custom role z panelu admina
  - [x] F5-D — Asystent AI: Groq + Gemini fallback (100% darmowo), podsumowania, @AI, przeredagowanie, tryb korpo-mowa
  - [x] F5-E — Rozmowy głosowe: WebRTC P2P mesh, sygnalizacja Socket.IO, darmowy STUN (TURN nieskonfigurowany — ograniczenie udokumentowane)
  - [x] F5-F — Jakość: E2E Playwright, /metrics Prometheus, web-vitals, health checks per-zależność
  - [x] F5-G — Dopracowanie: responsywność mobilna (sidebar-drawer), a11y (focus-visible), przegląd bezpieczeństwa AI (prompt injection), .env.example
  - [x] F5-H — Panel super-admina: zarządzanie użytkownikami/organizacjami ponad podziałem na organizacje (`/super-admin`)
- [ ] Faza 6 — skala, głos v2 (SFU), redesign v3, E2EE, PWA, gotowość ekosystemowa: [PLAN-FAZA6.md](./PLAN-FAZA6.md)

## Konta testowe (seed)

```bash
pnpm --filter @chatv2/api seed
```

Organizacja **Acme** (slug `acme`), hasło wspólne: `Haslo!Testowe123`

| Email | Rola | Uwagi |
|---|---|---|
| anna@acme.pl | OWNER | członek prywatnego #zarzad |
| bartek@acme.pl | ADMIN | członek prywatnego #zarzad |
| celina@acme.pl | MEMBER | tylko kanały publiczne |

Kanały: `#general`, `#random` (publiczne), `#zarzad` (prywatny)
