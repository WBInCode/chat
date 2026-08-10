set -e
echo "=== przed ==="
sudo ufw status | grep -cE '3478|49160' || true

sudo ufw allow proto udp to any port 3478 comment 'TURN (rozmowy glosowe)'
sudo ufw allow proto tcp to any port 3478 comment 'TURN po TCP (sieci blokujace UDP)'
sudo ufw allow proto tcp to any port 5349 comment 'TURNS - TURN po TLS'
sudo ufw allow proto udp to any port 5349 comment 'TURNS po DTLS'
sudo ufw allow proto udp to any port 49160:49200 comment 'TURN - porty przekaznika'

echo "=== po ==="
sudo ufw status numbered
