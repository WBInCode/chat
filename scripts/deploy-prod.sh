#!/usr/bin/env bash
# Wdrozenie czatu na produkcje z automatycznym wycofaniem.
# Uzycie: bash deploy.sh <skrot-commita>
# Zmiany tylko we frontendzie — brak migracji bazy, ale kopia i tak powstaje.
set -euo pipefail

NEW_COMMIT=${1:?podaj skrot commita}
BASE=/opt/wb/chat
TS=$(date +%Y%m%d-%H%M%S)
BACKUP=$BASE/backups/pre-mobile-$TS

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "1/6 kopia bazy, zrodel i obrazow"
# Katalog kopii nalezy do roota, ale reszta wdrozenia ma zostac na koncie debian,
# zeby nie zmienic wlasciciela zrodel.
sudo install -d -o "$(id -un)" -g "$(id -gn)" "$BACKUP"
docker exec wb-postgres pg_dump -U wbadmin -Fc -d chat > "$BACKUP/chat.dump"
cp -a "$BASE/src" "$BACKUP/src"
cp "$BASE/COMMIT" "$BACKUP/COMMIT" 2>/dev/null || true
# Obrazy tagujemy, zeby wycofanie nie wymagalo przebudowy.
docker tag wb-chat-api:local "wb-chat-api:backup-$TS"
docker tag wb-chat-web:local "wb-chat-web:backup-$TS"
ls -lh "$BACKUP/chat.dump"

log "2/6 rozpakowanie nowych zrodel"
rm -rf /tmp/chat-new && mkdir -p /tmp/chat-new
tar xzf /tmp/chat-src.tar.gz -C /tmp/chat-new
# Sprawdzamy obecnosc zmian, zanim usuniemy dzialajaca wersje.
grep -q 'custom-variant touch' /tmp/chat-new/apps/web/src/styles/index.css
grep -q 'touch:opacity-100' /tmp/chat-new/apps/web/src/features/chat/ChannelTree.tsx
rm -rf "$BASE/src" && mv /tmp/chat-new "$BASE/src"

restore() {
  log "!! wycofywanie"
  rm -rf "$BASE/src"
  cp -a "$BACKUP/src" "$BASE/src"
  docker tag "wb-chat-api:backup-$TS" wb-chat-api:local
  docker tag "wb-chat-web:backup-$TS" wb-chat-web:local
  cd "$BASE" && docker compose up -d || true
  log "!! przywrocono poprzednia wersje (kopia: $BACKUP)"
  exit 1
}

log "3/6 budowanie"
cd "$BASE"
docker compose build chat-api chat-web || { log "!! build nieudany"; restore; }

log "4/6 restart"
docker compose up -d chat-api chat-web

log "5/6 czekam na gotowosc"
ok=0
for _ in $(seq 1 48); do
  sa=$(docker inspect -f '{{.State.Status}}' wb-chat-api 2>/dev/null || echo brak)
  sw=$(docker inspect -f '{{.State.Status}}' wb-chat-web 2>/dev/null || echo brak)
  if [ "$sa" = running ] && [ "$sw" = running ]; then
    # Zdrowie siedzi pod prefiksem /api/v1 — samo /health zwraca 404
    # i skrypt niepotrzebnie wycofalby dzialajace wdrozenie.
    gotowe=$(docker exec wb-chat-web wget -qO- http://wb-chat-api:4000/api/v1/health/ready 2>/dev/null)
    case "$gotowe" in *'"status":"ready"'*) ok=1; break;; esac
  fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  log "!! uslugi nie wstaly (api=$sa web=$sw)"
  docker logs --tail 40 wb-chat-api || true
  restore
fi

log "6/6 weryfikacja"
log "    /api/v1/health/ready -> $(docker exec wb-chat-web wget -qO- http://wb-chat-api:4000/api/v1/health/ready 2>/dev/null)"
log "    HTTPS                -> $(curl -s -o /dev/null -w '%{http_code}' --resolve chat.wb-partners.pl:443:127.0.0.1 https://chat.wb-partners.pl/ --max-time 15)"
BLEDY=$(docker logs --since 3m wb-chat-api 2>&1 | grep -c '"level":50' || true)
log "    bledy krytyczne w logach: $BLEDY"

# Plik znacznika nalezy do roota, wiec zapis wymaga sudo. Bez tego skrypt
# konczyl sie bledem juz PO udanym wdrozeniu i wygladalo to na awarie.
echo "$NEW_COMMIT" | sudo tee "$BASE/COMMIT" > /dev/null
log "GOTOWE. commit $NEW_COMMIT, kopia w $BACKUP"
