#!/bin/sh
# Spielt kindle/ per SSH auf den Kindle nach /mnt/us/kindledash und startet neu.
# Aufruf: sh werkzeuge/aufspielen.sh [IP]   (Vorgabe 192.168.0.159, Port 2223)

IP=${1:-192.168.0.159}
K="ssh -o BatchMode=yes -o ConnectTimeout=8 -i $HOME/.ssh/kindle_ed25519 -p 2223 root@$IP"
QUELLE=$(cd "$(dirname "$0")/../kindle" && pwd)

$K 'mkdir -p /mnt/us/kindledash/web' || exit 1
for f in dienst.sh installieren.sh kindledash.conf kindledash-starten.sh ssh-zugang.sh; do
    $K "cat > /mnt/us/kindledash/$f" < "$QUELLE/$f" || exit 1
done
for f in config.xml index.html app.css app.js plz.js; do
    $K "cat > /mnt/us/kindledash/web/$f" < "$QUELLE/web/$f" || exit 1
done
$K 'lipc-set-prop com.lab126.appmgrd stop app://de.kindledash.app; sleep 2; sh /mnt/us/kindledash/installieren.sh'
