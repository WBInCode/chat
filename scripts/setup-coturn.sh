set -euo pipefail

KAT=/opt/wb/coturn
sudo mkdir -p "$KAT"

# Sekret wspolny z chat-api. Generowany na serwerze - nigdzie indziej nie musi istniec.
if sudo test -f "$KAT/secret"; then
  SEKRET=$(sudo cat "$KAT/secret")
  echo "sekret: istnieje juz, uzywam poprzedniego"
else
  SEKRET=$(openssl rand -hex 32)
  echo "$SEKRET" | sudo tee "$KAT/secret" >/dev/null
  sudo chmod 600 "$KAT/secret"
  echo "sekret: wygenerowany nowy"
fi

sudo tee "$KAT/turnserver.conf" >/dev/null <<EOF
listening-port=3478
fingerprint

# Dane dostepowe wystawia chat-api: nazwa "<termin>:<userId>" + HMAC-SHA1.
# Dzieki temu przegladarka nigdy nie widzi ponizszego sekretu.
use-auth-secret
static-auth-secret=$SEKRET
realm=chat.wb-partners.pl

# Adres publiczny musi byc podany wprost - serwer stoi za NAT-em dostawcy.
external-ip=51.83.202.86

# Nasluch i przekazywanie wylacznie przez adres publiczny. Domyslnie coturn
# wstaje na kazdym interfejsie, w tym na mostkach Dockera (172.x) - a tam
# przekaznik nie ma czego szukac i tylko powieksza powierzchnie ataku.
listening-ip=51.83.202.86
relay-ip=51.83.202.86

# Waski zakres portow przekaznika: tyle wystarczy na kilkanascie rownoleglych
# rozmow, a im mniej otwartych portow, tym mniejsza powierzchnia ataku.
min-port=49160
max-port=49200

# NAJWAZNIEJSZE. Bez tego kazdy, kto dostanie dane dostepowe, moze przez
# przekaznik siegnac do bazy, Redisa i pozostalych kontenerow - TURN
# laczylby sie z nimi z adresu lokalnego, omijajac zapore.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

# Przekaznik ma obslugiwac tylko rozmowy: bez tuneli TCP do dowolnych hostow,
# bez multicastu, bez powielania ruchu przez kolejne przekazniki.
no-tcp-relay
no-multicast-peers

# Limity: jedna osoba nie polozy serwera setka rownoleglych przydzialow.
user-quota=12
total-quota=200
# ~1 MB/s lacznie; rozmowa glosowa to okolo 5 KB/s w kazda strone.
max-bps=1000000

stale-nonce=600
no-cli
no-tlsv1
no-tlsv1_1
simple-log
log-file=stdout
EOF

# Obraz coturna pracuje jako `nobody` (65534:65533) i plik musi byc czytelny
# wlasnie dla niego. Przy root:root 600 kontener NIE znajduje konfiguracji
# i po cichu wstaje na ustawieniach domyslnych - bez sekretu i bez blokad
# adresow wewnetrznych. W logu widac to jako "Cannot find config file".
sudo chown 65534:65533 "$KAT/turnserver.conf"
sudo chmod 640 "$KAT/turnserver.conf"
echo "konfiguracja: zapisana w $KAT/turnserver.conf"

# Kontener czyta konfiguracje tylko przy starcie - i to bez zatrzymania sie,
# gdy jej nie ma. Dlatego po kazdej zmianie sprawdzamy log.
sprawdz_wczytanie() {
  if sudo docker logs wb-coturn 2>&1 | grep -q "Cannot find config file"; then
    echo "BLAD: coturn nie wczytal konfiguracji"
    return 1
  fi
  echo "konfiguracja: wczytana przez kontener"
}

sudo tee "$KAT/docker-compose.yml" >/dev/null <<'EOF'
services:
  coturn:
    image: coturn/coturn:4.6-alpine
    container_name: wb-coturn
    restart: unless-stopped
    # Siec hosta jest tu konieczna: przekaznik musi widziec prawdziwe adresy
    # zrodlowe i wystawiac dziesiatki portow UDP, czego mapowanie portow
    # Dockera nie oblsuzy sensownie.
    network_mode: host
    volumes:
      - /opt/wb/coturn/turnserver.conf:/etc/coturn/turnserver.conf:ro
    command: ["-c", "/etc/coturn/turnserver.conf"]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
EOF
echo "compose: zapisany"

cd "$KAT"
sudo docker compose up -d --force-recreate >/dev/null 2>&1
sleep 5
sprawdz_wczytanie
