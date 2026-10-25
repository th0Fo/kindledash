#!/bin/sh
# Spielt kindle/ per SSH auf den Kindle nach /mnt/us/kindledash und startet neu.
# Aufruf: sh werkzeuge/aufspielen.sh [IP]   (Vorgabe 192.168.0.159, Port 2223)

IP=${1:-192.168.0.159}
K="ssh -o BatchMode=yes -o ConnectTimeout=8 -i $HOME/.ssh/kindle_ed25519 -p 2223 root@$IP"
QUELLE=$(cd "$(dirname "$0")/../kindle" && pwd)

$K 'mkdir -p /mnt/us/kindledash/web' || exit 1
for f in dienst.sh installieren.sh kindledash.conf kindledash-starten.sh ssh-zugang.sh \
         aktualisieren.sh kindledash-zuruecksetzen.sh; do
    # Windows-Zeilenenden aus der Arbeitskopie unterwegs entfernen
    tr -d '\r' < "$QUELLE/$f" | $K "cat > /mnt/us/kindledash/$f" || exit 1
done
for f in config.xml index.html app.css app.js plz.js; do
    tr -d '\r' < "$QUELLE/web/$f" | $K "cat > /mnt/us/kindledash/web/$f" || exit 1
done
# Entwicklungsstand kennzeichnen, damit der Update-Knopf das nächste Release anbietet
echo "entwicklung-$(git -C "$QUELLE/.." rev-parse --short HEAD)" | $K "cat > /mnt/us/kindledash/version.txt"
# laufenden Dienst beenden, damit er mit den neuen Dateien startet
$K 'for p in dienst befehl; do [ -f /tmp/kindledash/$p.pid ] && kill $(cat /tmp/kindledash/$p.pid) 2>/dev/null; rm -f /tmp/kindledash/$p.pid; done; lipc-set-prop com.lab126.appmgrd stop app://de.kindledash.app; sleep 2; sh /mnt/us/kindledash/installieren.sh'
