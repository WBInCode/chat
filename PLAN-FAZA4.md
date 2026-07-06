# FAZA 4 — pełnofunkcyjny komunikator firmowy (20+ nowych funkcji)

Cel: chatv2 ma pokrywać wszystkie funkcje, których zespół oczekuje od nowoczesnego komunikatora (Slack/Teams-class), zachowując dotychczasowe standardy bezpieczeństwa (deny-by-default authz, audit log, portale dla modali, testy po każdym sprincie).

## Sprint F4-A — Wiadomości pro (6 funkcji)
1. **Formatowanie markdown** — bold/italic/strike/`code`/```bloki kodu```/listy/cytaty; bezpieczny render (bez HTML injection), podświetlanie składni w blokach kodu.
2. **Przypinanie wiadomości** — pin/unpin (uprawnienie channel.manage lub autor), lista przypiętych w headerze kanału.
3. **Zakładki osobiste (saved items)** — dowolna wiadomość → "Zapisz"; osobny widok "Zapisane" w sidebarze.
4. **Przekazywanie wiadomości (forward)** — do innego kanału/DM z opcjonalnym komentarzem.
5. **Cytowanie z odpowiedzią (quote-reply)** — wstawienie cytatu do composera z linkiem do oryginału.
6. **Skok do wiadomości** — permalink (klik w timestamp kopiuje link), nawigacja z wyszukiwarki/przypiętych/zapisanych do konkretnej wiadomości z podświetleniem.

## Sprint F4-B — Kanały pro (5 funkcji)
7. **Opis kanału + temat (topic)** — edytowalny w headerze, widoczny dla wszystkich.
8. **Zarządzanie członkami kanału** — dodawanie/usuwanie członków kanałów prywatnych z UI (obecnie tylko przy tworzeniu).
9. **Wyciszanie kanału (mute)** — per użytkownik; wyciszone kanały bez badge unread i bez powiadomień.
10. **Grupowe DM** — rozmowy 3+ osób bez tworzenia kanału.
11. **Ulubione kanały (gwiazdka)** — sekcja "Ulubione" na górze sidebara.

## Sprint F4-C — Powiadomienia (4 funkcje) [dawne F3-2]
12. **Web Push (VAPID + service worker)** — powiadomienia przy wzmiance/DM gdy karta nieaktywna; wyłączone w trybie DND.
13. **Preferencje powiadomień** — all / mentions-only / none, globalnie i per kanał.
14. **Badge w tytule karty** — "(3) chatv2" + licznik nieprzeczytanych.
15. **Podsumowanie po powrocie** — toast "3 nowe wzmianki w 2 kanałach" po zalogowaniu/powrocie.

## Sprint F4-D — Wyszukiwanie i nawigacja pro (3 funkcje)
16. **Filtry wyszukiwania** — `from:@user`, `in:#kanał`, `has:file`, `before:/after:` daty.
17. **Szybki przełącznik (Ctrl+P)** — fuzzy-search po kanałach/osobach, Enter przeskakuje.
18. **Separator "Nowe wiadomości"** — linia od ostatniego odczytu + przycisk "↓ Najnowsze" przy przescrollowaniu w górę.

## Sprint F4-E — Codzienna praca (5 funkcji)
19. **Szkice (drafts)** — autozapis treści composera per kanał; wskaźnik "szkic" w sidebarze.
20. **Planowanie wysyłki** — "wyślij później" (data/godzina); worker BullMQ wysyła o czasie.
21. **Przypomnienia** — "przypomnij mi o tym" na wiadomości (za 1h / jutro / własny czas) → DM od bota-systemu.
22. **Ankiety (polls)** — szybka ankieta w kanale (pytanie + opcje, głosowanie, wyniki live).
23. **Statusy niestandardowe rozszerzone** — auto-czyszczenie statusu po czasie ("Na spotkaniu" → 1h), szybkie presety.

## Kolejność implementacji
F4-A → F4-B → F4-C → F4-D → F4-E (każdy sprint: migracje → backend+testy → frontend → weryfikacja E2E → commit).

## Zasady (bez zmian)
- Deny-by-default authz (assertChannelMember przed każdą operacją), 404 nie 403.
- Audit log przez logAudit() dla akcji administracyjnych (pin, zarządzanie członkami).
- Wszystkie modale/popovery przez createPortal.
- Markdown render: whitelist składni, ZERO surowego HTML z treści użytkownika.
- Po każdym sprincie: typecheck + testy + weryfikacja w przeglądarce + commit na GitHub.
