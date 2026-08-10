#!/bin/bash
# Wyciaga certyfikat dla chat.wb-partners.pl ze skladu ACME Traefika i podklada
# go coturnowi pod TURNS (TLS na 5349).
#
# Traefik odnawia certyfikaty sam, ale nie ma pojecia o coturnie - dlatego ten
# skrypt chodzi z crona i po kazdej zmianie przeladowuje przekaznik. Bez tego
# TURNS przestalby dzialac przy pierwszym odnowieniu, cicho i dopiero po
# ~3 miesiacach od wdrozenia.
set -euo pipefail

SKLAD=/var/lib/docker/volumes/wb-proxy_letsencrypt/_data/acme.json
DOMENA=chat.wb-partners.pl
KAT=/opt/wb/coturn/certs
TYMCZASOWY=$(mktemp -d)
trap 'rm -rf "$TYMCZASOWY"' EXIT

mkdir -p "$KAT"

python3 - "$SKLAD" "$DOMENA" "$TYMCZASOWY" <<'PYTHON'
import base64, json, sys

sklad, domena, katalog = sys.argv[1], sys.argv[2], sys.argv[3]

with open(sklad, encoding="utf-8") as f:
    dane = json.load(f)

# Traefik grupuje certyfikaty po nazwie resolvera, ktora moze sie zmienic -
# dlatego przechodzimy wszystkie, zamiast zakladac konkretna.
for resolver in dane.values():
    for wpis in resolver.get("Certificates") or []:
        if wpis.get("domain", {}).get("main") != domena:
            continue
        with open(f"{katalog}/cert.pem", "wb") as f:
            f.write(base64.b64decode(wpis["certificate"]))
        with open(f"{katalog}/key.pem", "wb") as f:
            f.write(base64.b64decode(wpis["key"]))
        sys.exit(0)

print(f"nie znaleziono certyfikatu dla {domena}", file=sys.stderr)
sys.exit(1)
PYTHON

if cmp -s "$TYMCZASOWY/cert.pem" "$KAT/cert.pem" && cmp -s "$TYMCZASOWY/key.pem" "$KAT/key.pem"; then
  echo "certyfikat: bez zmian"
  exit 0
fi

install -o 65534 -g 65533 -m 640 "$TYMCZASOWY/cert.pem" "$KAT/cert.pem"
install -o 65534 -g 65533 -m 640 "$TYMCZASOWY/key.pem" "$KAT/key.pem"
echo "certyfikat: zaktualizowany ($(openssl x509 -in "$KAT/cert.pem" -noout -enddate))"

if docker ps --format '{{.Names}}' | grep -qx wb-coturn; then
  docker restart wb-coturn >/dev/null
  echo "coturn: przeladowany"
fi
