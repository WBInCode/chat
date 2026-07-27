# Audyt systemu chatu (chatv2)

Data: 2026-07-27. Zakres: backend (apps/api), frontend (apps/web), infrastruktura (docker-compose, render.yaml).

AKTUALIZACJA (ten sam dzień): pozycje z sekcji 2, 4, 5 i 7 zostały WDROŻONE. Szczegóły w sekcji 8 na końcu dokumentu. Wymagane przy wdrożeniu: `prisma migrate deploy` (nowa migracja 20260727120000_e2ee_ttl_at_rest_encryption).

---

## 1. Bezpieczeństwo: stan obecny

### Mocne strony (zweryfikowane w kodzie)

| Obszar | Stan | Gdzie |
|---|---|---|
| Tokeny JWT | EdDSA (Ed25519), TTL 10 min, payload minimalny (sub, sid) | apps/api/src/lib/jwt.ts |
| Refresh tokeny | Rotacja + detekcja ponownego użycia, unieważnianie całej rodziny, w bazie tylko hash SHA-256 | apps/api/src/modules/auth/service.ts |
| Cookie refresh | httpOnly, Secure w prod, path ograniczony do /api/v1/auth | apps/api/src/modules/auth/service.ts |
| Hasła | Argon2id (64 MB, t=3, p=4), min. 12 znaków, ochrona przed timing attack | apps/api/src/lib/password.ts |
| 2FA | TOTP (otplib), sekret szyfrowany AES-256-GCM, 10 kodów zapasowych (hashowane) | apps/api/src/lib/field-crypto.ts |
| Autoryzacja | Deny-by-default, matryca uprawnień org (OWNER/ADMIN/HR/MEMBER) + role kanałowe, 404 zamiast 403 (brak wycieku istnienia zasobu) | apps/api/src/lib/authz.ts |
| WebSocket | Token w handshake.auth (nie w query string), weryfikacja sygnatury + rewokacji sesji w Redis, limit bufora 64 KB | apps/api/src/ws/gateway.ts |
| Rate limiting | Globalny 300/min, login 5/15 min (klucz IP:email), rejestracja 10/15 min, limity per zdarzenie WS | apps/api/src/plugins/security.ts |
| Nagłówki | Helmet: CSP bez unsafe-inline, HSTS (prod), frame-ancestors 'none' | apps/api/src/plugins/security.ts |
| Pliki | Presigned URL, weryfikacja MIME z magic bytes (file-type), re-encoding obrazów (sharp, usuwanie EXIF/GPS), skan ClamAV, limit 25 MB | apps/api/src/modules/files/service.ts |
| SSRF | Unfurl linków blokuje sieci prywatne, limit 3 redirectów, 1 MB, 5 s | apps/api/src/workers/link-unfurl.worker.ts |
| Audyt | Hash-chain (tamper-evident), weryfikacja integralności w panelu admina | model AuditLog |
| XSS | Frontend nie używa dangerouslySetInnerHTML; markdown parsowany do elementów React, linki z rel="noopener noreferrer nofollow" | apps/web/src/features/chat/markdown.tsx |
| Walidacja | Zod na każdym wejściu, schematy współdzielone front/back | packages/shared/src/schemas |

### Słabości i zalecenia (priorytet malejący)

1. **Klucze JWT na dysku dewelopera.** Katalog apps/api/keys/ jest w .gitignore (zweryfikowane: git ls-files pusty, check-ignore trafia na regułę apps/api/keys/), więc NIE są w repo. Zalecenie: w produkcji dostarczać przez secrets managera (Render: sync:false już skonfigurowane), rotować przy wdrożeniu i nigdy nie kopiować kluczy dev do prod.
2. **SameSite=None w prod** (układ cross-domain Vercel + Render). Działa tylko z Secure; wymaga świadomej ochrony CSRF. Refresh chroniony scoped path i rotacją, ale przy zmianie architektury na wspólną domenę należy wrócić do SameSite=Strict.
3. **Treść wiadomości w bazie jawnym tekstem** (patrz sekcja 2).
4. **Wspólny globalny limit AI (300/dzień)**: jedna organizacja może wyczerpać pulę innym. Zalecenie: limit per org.
5. **Brak DB constraint na długość wiadomości** (tylko Zod 8000 znaków). Niskie ryzyko, ale warto dodać CHECK.
6. **Webhooki przychodzące**: token hashowany (dobrze), brak dedykowanego rate limitu per webhook.
7. **Brak TURN dla głosu**: rozmowy P2P nie zestawią się za symetrycznym NAT (ograniczenie funkcjonalne, nie bezpieczeństwa).

Słabe defaulty w .env.example (COOKIE_SECRET, S3_SECRET_KEY) dotyczą wyłącznie środowiska dev; render.yaml generuje wartości produkcyjne automatycznie (generateValue: true).

---

## 2. Szyfrowanie wiadomości: stan obecny

| Warstwa | Stan |
|---|---|
| W tranzycie | TLS 1.3 (HTTPS + WSS), poprawne |
| W spoczynku (aplikacyjnie) | Wiadomości: JAWNY TEKST w Postgres. Szyfrowane pole po polu jest tylko User.totpSecret (AES-256-GCM, format v1.iv.tag.ct z wersjonowaniem klucza) |
| W spoczynku (infrastrukturalnie) | Zależne od dysku/wolumenu hostingu |
| End-to-end | BRAK (zaplanowane w PLAN-FAZA2, niezaimplementowane) |

Zalecenie krótkoterminowe (bez E2E): objąć treść wiadomości tym samym mechanizmem field-crypto (AES-256-GCM) z kluczem per instalacja lub per organizacja. Koszt: szyfrowanie/deszyfrowanie przy każdym odczycie oraz konieczność deszyfrowania do indeksu wyszukiwarki. Chroni przed wyciekiem dumpa bazy, nie chroni przed skompromitowanym serwerem aplikacji.

---

## 3. Kanały: już istnieją

System ma pełną obsługę kanałów, nie trzeba ich dodawać:

- Typy: PUBLIC (otwarte w organizacji), PRIVATE (na zaproszenie), DM (1:1).
- Role kanałowe ADMIN/MEMBER, zarządzanie członkami kanałów prywatnych.
- Archiwizacja, opis/temat, wyciszanie, ulubione, własna kolejność (drag and drop), przeglądarka kanałów publicznych.
- Tworzenie: każdy MEMBER (konfigurowalne w matrycy uprawnień).

Braki: grupowe DM (3+ osób) zaplanowane, nieukończone; brak UI uprawnień per kanał (matryca istnieje na backendzie).

---

## 4. Znikające wiadomości: możliwość włączenia

Dziś nie ma tej funkcji per kanał, ale infrastruktura już istnieje: worker retention-purge codziennie usuwa wiadomości starsze niż Organization.messageRetentionDays (wraz z plikami z S3, z wpisem do audytu).

Proponowana implementacja (mały nakład, wykorzystuje istniejący mechanizm):

1. Migracja: pole `messageTtlSeconds Int?` na modelu Channel (null = wyłączone).
2. Endpoint PATCH /channels/:id/settings (tylko channel ADMIN) ustawiający TTL z listy predefiniowanej: 24 h, 7 dni, 30 dni, wyłączone.
3. Rozszerzenie retention-purge.worker o drugi krok: DELETE wiadomości gdzie channel.messageTtlSeconds IS NOT NULL AND createdAt < now() - ttl. Częstotliwość biegu podnieść do np. co 15 min, żeby TTL 24 h był respektowany sensownie.
4. UI: przełącznik w ustawieniach kanału + stały, widoczny znacznik w nagłówku kanału (np. ikona zegara z etykietą "Wiadomości znikają po 7 dniach"), żeby nikt nie był zaskoczony.
5. Wykluczenia do decyzji: wiadomości przypięte i zapisane (rekomendacja: TTL usuwa również je, inaczej funkcja daje fałszywe poczucie zniknięcia).

Uwaga: to znikanie po stronie serwera (jak w komunikatorach firmowych). Nie chroni przed zrzutem ekranu ani eksportem wykonanym przed upływem TTL.

---

## 5. Szyfrowanie end-to-end: wykonalność

Fundament już jest: model User ma pole `publicKey` (klucz tożsamości X25519, przygotowane pod fazę 2), a wiadomość ma contentType, więc można dodać typ zaszyfrowany bez zmiany schematu wiadomości.

Rekomendowany zakres MVP (realistyczny):

1. **Tylko DM 1:1, tryb opcjonalny per rozmowa** (przełącznik "Rozmowa szyfrowana"). Kanały grupowe wymagają protokołu grupowego (Sender Keys / MLS) i są wielokrotnie droższe.
2. Kryptografia: X25519 (ECDH) + XChaCha20-Poly1305 przez libsodium.js, lub gotowy @signalapp/libsignal-client (Double Ratchet, forward secrecy). Rekomendacja: libsignal, nie pisać własnego ratcheta.
3. Klucze prywatne wyłącznie na urządzeniu (IndexedDB, opcjonalnie chronione hasłem przez PBKDF/Argon2 w WASM). Serwer przechowuje tylko klucze publiczne i pre-key bundles.
4. Weryfikacja tożsamości: safety numbers (porównanie odcisków kluczy), ostrzeżenie przy zmianie klucza rozmówcy.

Konsekwencje, które trzeba zakomunikować przed decyzją:

- Wyszukiwanie, podsumowania AI, unfurl linków i skan antywirusowy załączników NIE działają dla treści E2E (serwer ich nie widzi).
- Historia niedostępna na nowym urządzeniu bez mechanizmu backupu kluczy (dodatkowa złożoność).
- Eksport RODO i retencja organizacyjna obejmą tylko szyfrogram.
- Web crypto ma słabszy model zaufania niż aplikacje natywne (serwer teoretycznie może podmienić JS). Dla komunikatora firmowego hostowanego przez własną firmę jest to akceptowalne, ale warto to zapisać w polityce.

Szacunkowa kolejność prac: klucze urządzeń + rejestracja bundle (API), handshake i szyfrowanie DM (klient), UI trybu szyfrowanego i safety numbers, backup kluczy. To największa pozycja z całego audytu.

---

## 6. Design: co zostało zmienione (wykonane w tym audycie)

Kierunek: czysty, korporacyjny komunikator (wzorzec Slack/Teams), spójny z zaakceptowanym w ekosystemie stylem (jasne tło, białe karty, jeden niebieski akcent #3D6DF2). Usunięty poprzedni styl "liquid glass" (aurora, mesh-gradienty, glassmorphism, gradientowe przyciski), który kwalifikował się jako AI slop.

### Tokeny i style (apps/web/src/styles/index.css, glass.ts)
- Tła: jasny kanwas #f2f3f7, powierzchnie solidne #ffffff (dark: #101318 / #171b22; midnight bez zmian, czysta czerń).
- Usunięte: animowane tło aurora (body::before/after), mesh-gradienty, backdrop-filter blur, "prismatic edge", sheen na przyciskach, glow pod aktywnym kanałem.
- Akcent: jeden płaski niebieski (#3d6df2, dark #7c93f5); --accent-grad i .text-brand-gradient spłaszczone do koloru (nazwy klas i zmiennych zachowane, więc żaden komponent się nie wysypał).
- Promień 12 px (było 18), subtelne cienie 1-2 poziomy zamiast trzech warstw z insetem.
- Naprawiony bug: --accent-ring był używany w focus ringach, ale nigdzie niezdefiniowany (ring był niewidoczny). Teraz zdefiniowany w obu motywach.
- Typografia: jeden krój Inter (Sora wycofana z ról nagłówkowych).

### Emotki w UI zastąpione ikonami (lucide-react)
- Sidebar, nagłówek kanału, QuickSwitcher: 🔒/# zastąpione ikonami Lock/Hash; akcje palety komend (➕🔎🔖⚙️🛡️🚪) ikonami Plus/Search/Bookmark/Settings/Shield/LogOut.
- Załączniki: 📎 i ikony typów plików (📄📝📊📽️🗜️) zastąpione Paperclip/FileText/FileSpreadsheet/Presentation/FolderArchive.
- Ankiety: 📊 i ✓ zastąpione BarChart3/Check; wątki: 💬 zastąpione MessageSquare; przypięte: 📌 zastąpione Pin; zapisane: 🔖 zastąpione Bookmark.
- Ustawienia: 🔔🔕 zastąpione Bell/BellOff, ✅⬇️ usunięte, statusy obecności 🟢🟡🔴 zastąpione tekstem (kolorowa kropka pozostała tam, gdzie była elementem, nie znakiem).
- Puste stany: 👋✨ zastąpione ikoną w kółku w kolorze akcentu.
- Wszystkie znaki ✓✕✗★←→⬇↪️ w przyciskach i etykietach zastąpione ikonami lub usunięte.
- ZACHOWANE (treść użytkownika, nie chrome UI): pełny picker reakcji emoji, emoji statusu własnego, reakcje pod wiadomościami.

### Em dashe usunięte z całego widocznego UI
Wszystkie wystąpienia znaku em dash w tekstach interfejsu przepisane na kropki, przecinki, nawiasy lub separator kropka środkowa (login, ustawienia, panel admina, puste stany, toasty, komunikaty błędów). W kodzie pozostały 3 wystąpienia w komentarzach deweloperskich (niewidoczne dla użytkownika).

### AI slop wyczyszczony
- Kopie typu "Witaj na #kanale!" zastąpione rzeczowym "To początek kanału #nazwa".
- Etykiety AI bez emoji (🤵🤡 usunięte z "Korpo-mowa").
- Brak wykrzykników, gradientowych nagłówków i marketingowych fraz w UI.

### Układ i ustawienia
- Ustawienia przebudowane z jednej długiej kolumny (7 sekcji pod sobą) na nawigację sekcyjną: Profil, Wygląd, Powiadomienia, Aplikacja, Bezpieczeństwo (2FA + sesje), Dane i prywatność. Na desktopie pionowe menu z lewej, na mobile poziome chipsy. Jedna sekcja na ekranie, aria-current na aktywnej.
- Układ czatu (3 panele: sidebar, lista wiadomości, kompozytor) pozostał, bo jest zgodny ze standardem komunikatorów firmowych; zmienił się jego wygląd (solidne powierzchnie, spokojne hover-stany, brak przesuwających się elementów nav przy hover).

Weryfikacja: tsc bez błędów, vite build przechodzi.

---

## 7. Priorytety na dalej

| # | Zadanie | Nakład | Status |
|---|---|---|---|
| 1 | Znikające wiadomości per kanał (sekcja 4) | mały | WDROŻONE |
| 2 | Szyfrowanie treści wiadomości at-rest (field-crypto) | mały/średni | WDROŻONE (opt-in per organizacja) |
| 3 | Limit AI per organizacja | mały | WDROŻONE |
| 4 | Grupowe DM | średni | JUŻ ISTNIAŁO (endpoint /group-dm + GroupDmPicker, błędnie oznaczone w planach jako brak) |
| 5 | E2E dla DM (sekcja 5) | duży | WDROŻONE (MVP, opis poniżej) |

---

## 8. Wdrożone zmiany (2026-07-27)

### 8.1 Szyfrowanie end-to-end dla DM 1:1 (opt-in per rozmowa)
- Kryptografia: NaCl box = X25519 (ECDH) + XSalsa20-Poly1305 (tweetnacl). Klucz prywatny per urządzenie w localStorage, nigdy nie opuszcza klienta. Klucz publiczny publikowany automatycznie po zalogowaniu (PUT /me/e2e-key).
- Włączanie: ikona tarczy w nagłówku DM. Serwer wymaga kluczy OBU stron (409 gdy brak). Zdarzenie WS channel:settings-updated aktualizuje obie strony na żywo.
- Wiadomości: contentType "e2e", format e2e.v1.nonce.ciphertext. Serwer traktuje treść jako nieprzezroczystą: brak unfurl, brak AI, brak indeksu wyszukiwania (warunek w SQL), push z treścią "Zaszyfrowana wiadomość". Kanał z e2ee odrzuca plaintext (brak cichego downgrade).
- Deszyfrowanie w MessageRow przy renderze; nadawca odczytuje własne wiadomości dzięki symetrii ECDH. Brak klucza = uczciwy placeholder "Nie można odczytać na tym urządzeniu".
- W rozmowach szyfrowanych wyłączone: załączniki, funkcje AI, wątki, cytowanie, przekazywanie, edycja (wymagałyby ponownego szyfrowania lub wyciekałyby treść).
- Świadome ograniczenia MVP (zakomunikowane w UI): brak forward secrecy (bez ratchetu), brak backupu kluczy (nowe urządzenie nie odczyta historii), brak safety numbers. Kierunek na produkcyjne wzmocnienie: libsignal.

### 8.2 Znikające wiadomości (TTL per kanał)
- Channel.messageTtlSeconds (1h / 24h / 7 dni / 30 dni / wyłączone). PATCH /channels/:id/ttl: admin kanału, w DM każdy uczestnik. Wpis w audycie.
- Odczyt: listMessages filtruje wygasłe wiadomości natychmiast. Worker retention-purge usuwa fizycznie (wraz z plikami S3) i biega teraz CO GODZINĘ (było: raz dziennie).
- UI: menu z ikoną timera w nagłówku kanału + opis "starsze wiadomości są trwale usuwane".

### 8.3 Szyfrowanie at-rest treści wiadomości (opt-in per organizacja)
- Przełącznik w panelu admina (Ustawienia): "Szyfruj treść wiadomości w bazie danych (AES-256)".
- Zapis: AES-256-GCM (istniejący field-crypto, FIELD_ENCRYPTION_KEY) + flaga Message.encrypted. Szyfrowane są też wiadomości bota AI i webhooków. Deszyfrowanie w jednym miejscu odczytu (toDto) oraz w kontekście AI i eksporcie RODO (eksport zawiera dane czytelne).
- Plaintext nadal płynie do powiadomień/unfurl/AI w momencie wysłania, więc funkcje działają; chroniona jest kopia w bazie.
- Udokumentowany kompromis: wiersze zaszyfrowane nie są obejmowane wyszukiwarką FTS (jawny warunek m.encrypted = false w zapytaniu).

### 8.4 Pozostałe wzmocnienia
- Limit AI liczony per organizacja (klucz ai-quota:{orgId}:{data}), jedna organizacja nie wyczerpie puli innym.
- Wyszukiwarka jawnie wyklucza contentType e2e i wiersze zaszyfrowane.
- Endpointy kluczy: PUT/GET /me/e2e-key, GET /channels/:id/e2e-keys (tylko członkowie kanału).
- Zdarzenie WS channel:settings-updated + akcja applyChannelSettings w store.
- Migracja: organizations.encryptAtRest, channels.e2ee, channels.messageTtlSeconds, messages.encrypted.
