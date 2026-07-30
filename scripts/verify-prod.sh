#!/usr/bin/env bash
# Przeglad stanu produkcji czatu. Tylko odczyt.
#   scp scripts/verify-prod.sh debian@SERWER:/tmp/v.sh
#   ssh debian@SERWER "sed -i 's/\r\$//' /tmp/v.sh && bash /tmp/v.sh"
set -uo pipefail
SRC=/opt/wb/chat/src

echo "== wersja i kontenery =="
printf '  znacznik: %s\n' "$(cat /opt/wb/chat/COMMIT)"
printf '  ChatLayout.tsx blob: %s\n' "$(git hash-object "$SRC/apps/web/src/features/chat/ChatLayout.tsx" 2>/dev/null)"
docker ps --filter name=wb-chat --format '  {{.Names}} {{.Status}}'

echo
echo "== zdrowie =="
# Uwaga: zdrowie siedzi pod /api/v1 — samo /health zwraca 404.
printf '  gotowosc -> %s\n' "$(docker exec wb-chat-web wget -qO- http://wb-chat-api:4000/api/v1/health/ready 2>/dev/null)"
printf '  HTTPS    -> %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --resolve chat.wb-partners.pl:443:127.0.0.1 https://chat.wb-partners.pl/ --max-time 15)"

echo
echo "== paczka frontendu =="
plik=$(docker exec wb-chat-web sh -c 'ls /usr/share/nginx/html/assets/*.css 2>/dev/null | head -1')
printf '  CSS: %s\n' "$plik"
printf '  regul dotykowych (pointer:coarse): %s\n' \
  "$(docker exec wb-chat-web sh -c "grep -c 'pointer:coarse' '$plik'" 2>/dev/null || echo 0)"

echo
echo "== bledy krytyczne w ostatniej dobie =="
# grep -c wypisuje 0 i konczy sie kodem 1 — bez || true skrypt falszywie zglasza blad.
docker logs --since 24h wb-chat-api 2>&1 | grep -c '"level":50' | sed 's/^/  /' || true

echo
echo "== miejsce zajete przez stare kopie zrodel =="
du -sh /opt/wb/chat/src-before-* 2>/dev/null | awk '{s+=$1} END {print "  katalogow: " NR}'
du -csh /opt/wb/chat/src-before-* 2>/dev/null | tail -1 | sed 's/^/  lacznie: /'
