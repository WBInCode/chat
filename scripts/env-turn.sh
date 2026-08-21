set -e
PLIK=/opt/wb/chat/.env.chat
SEKRET=$(sudo cat /opt/wb/coturn/secret)

sudo cp -a "$PLIK" "$PLIK.przed-turn"

# Kolejnosc ma znaczenie: przegladarka probuje adresow po kolei, wiec zwykly
# UDP idzie pierwszy (najtanszy), TLS na koncu jako wyjscie awaryjne dla sieci,
# ktore przepuszczaja tylko ruch wygladajacy na HTTPS.
ADRESY='turn:chat.wb-partners.pl:3478?transport=udp,turn:chat.wb-partners.pl:3478?transport=tcp,turns:chat.wb-partners.pl:5349?transport=tcp'

sudo sed -i '/^TURN_URLS=/d;/^TURN_SECRET=/d;/^TURN_TTL_SECONDS=/d' "$PLIK"
printf 'TURN_URLS=%s\nTURN_SECRET=%s\nTURN_TTL_SECONDS=3600\n' "$ADRESY" "$SEKRET" | sudo tee -a "$PLIK" >/dev/null

echo "zapisano; klucze w pliku:"
sudo grep -oE '^TURN_[A-Z_]+' "$PLIK"
