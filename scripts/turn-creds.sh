SEKRET=$(sudo cat /opt/wb/coturn/secret)
UZYTKOWNIK="$(( $(date +%s) + 600 )):test-zewnetrzny"
HASLO=$(printf '%s' "$UZYTKOWNIK" | openssl dgst -sha1 -hmac "$SEKRET" -binary | base64)
echo "$UZYTKOWNIK"
echo "$HASLO"
