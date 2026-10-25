#!/bin/sh
#
# Nimmt Befehle der App entgegen. dienst.sh startet dafür
#   nc -lk -s 127.0.0.1 -p 8737 -e befehl.sh
# Nur vom Kindle selbst erreichbar. Jede Anfrage ist ein HTTP-GET, die Antwort
# ist JSON mit CORS-Kopf, damit die App sie per XHR lesen kann.

VZ=/mnt/us/kindledash
TMP=/tmp/kindledash

read -r anfrage
# restliche Kopfzeilen lesen, sonst bricht die Verbindung vor der Antwort ab
while read -r zeile; do
    zeile=$(echo "$zeile" | tr -d '\r')
    [ -z "$zeile" ] && break
done

pfad=$(echo "$anfrage" | cut -d' ' -f2 | cut -d'?' -f1)

antwort() {
    printf 'HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n\r\n%s\n' "$1"
}

case "$pfad" in
    /pruefen)
        nohup sh $VZ/aktualisieren.sh pruefen > /dev/null 2>&1 &
        antwort '{"ok":true}'
        ;;
    /aktualisieren)
        nohup sh $VZ/aktualisieren.sh installieren > /dev/null 2>&1 &
        antwort '{"ok":true}'
        ;;
    /status)
        antwort "{\"ok\":true,\"version\":\"$(cat $VZ/version.txt 2>/dev/null)\",\"neu\":\"$(cat $TMP/neu.txt 2>/dev/null)\",\"update\":\"$(cat $TMP/update-status.txt 2>/dev/null)\"}"
        ;;
    *)
        antwort '{"ok":false}'
        ;;
esac
