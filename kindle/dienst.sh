#!/bin/sh
#
# KindleDash-Dienst. Läuft im Hintergrund, solange der Kindle an ist:
#  - hält den Bildschirm wach
#  - startet auf Wunsch den SSH-Zugang (Datei /mnt/us/kindledash/ssh-an)
#  - sucht den GX im WLAN und holt alle 30 Sekunden die Anlagenwerte von
#    Node-RED (https://GX:1881/kindledash/werte). Die App liest sie aus
#    /tmp/kindledash/werte.js, also aus dem Arbeitsspeicher.
#  - frischt den Bildschirm einmal pro Stunde komplett auf (Geisterbilder)
#
# Aufruf: dienst.sh            startet den Dienst, falls er nicht läuft
#         dienst.sh --boot     wie oben, startet danach auch die App
#
# Abschalten des Autostarts: leere Datei /mnt/us/kindledash/KEIN_AUTOSTART

VZ=/mnt/us/kindledash
TMP=/tmp/kindledash
PID=$TMP/dienst.pid
WERTE=$TMP/werte.js
GX_FEST=$VZ/gx.txt
GX_GEFUNDEN=$VZ/gx-gefunden.txt
PFAD=/kindledash/werte
APP=app://de.kindledash.app

mkdir -p $TMP

if [ -f $PID ] && kill -0 "$(cat $PID)" 2>/dev/null; then
    [ "$1" = "--boot" ] || [ "$1" = "--app" ] && lipc-set-prop com.lab126.appmgrd start $APP
    exit 0
fi
echo $$ > $PID

log() { echo "$(date '+%d.%m. %H:%M:%S') $*" >> $TMP/dienst.log; }

schreiben() {
    # $1 ok (true/false), $2 GX, $3 Daten-JSON oder Fehlertext
    jetzt=$(date +%s)
    v=$(cat $VZ/version.txt 2>/dev/null); n=$(cat $TMP/neu.txt 2>/dev/null); u=$(cat $TMP/update-status.txt 2>/dev/null)
    stand="\"version\":\"$v\",\"neu\":\"$n\",\"update\":\"$u\""
    if [ "$1" = "true" ]; then
        printf 'kindledashWerte({"ok":true,"geholt":%s,"gx":"%s",%s,"daten":%s});\n' "$jetzt" "$2" "$stand" "$3" > $WERTE.neu
    else
        printf 'kindledashWerte({"ok":false,"geholt":%s,"gx":"%s",%s,"fehler":"%s"});\n' "$jetzt" "$2" "$stand" "$3" > $WERTE.neu
    fi
    mv $WERTE.neu $WERTE
}

# Befehle der App. Der Kindle-Browser sperrt Anfragen an den Kindle selbst, darf aber
# Dateien lesen. Die App lädt deshalb /tmp/kindledash/befehl/<befehl>.js als Skript.
# Die Dateien stehen auf einer Zugriffszeit von 2020; liest jemand eine, wird ihre
# Zugriffszeit neuer als die Änderungszeit (relatime auf /var), und das erkennt die
# Schleife hier jede Sekunde.
BEFEHLE="pruefen aktualisieren auffrischen licht-aus licht-an"

auffrischen() {
    /mnt/us/libkh/bin/fbink -q -f -s < /dev/null
}

# Beleuchtung (wie in PiHome): Die App meldet nach einer Weile ohne Berührung "licht-aus"
# und beim nächsten Tipp "licht-an". Die Helligkeit davor merkt sich licht.txt.
licht() {
    w=$(lipc-get-prop com.lab126.powerd flIntensity 2>/dev/null)
    case "$w" in ''|*[!0-9]*) w=0 ;; esac
    if [ "$1" = aus ]; then
        [ "$w" -gt 0 ] && echo "$w" > $VZ/licht.txt
        lipc-set-prop com.lab126.powerd flIntensity 0
    elif [ "$w" -eq 0 ]; then
        s=$(cat $VZ/licht.txt 2>/dev/null)
        case "$s" in ''|*[!0-9]*|0) s=12 ;; esac
        lipc-set-prop com.lab126.powerd flIntensity "$s"
    fi
}

befehle_starten() {
    [ -f $TMP/befehl.pid ] && kill -0 "$(cat $TMP/befehl.pid)" 2>/dev/null && return
    (
        mkdir -p $TMP/befehl
        for b in $BEFEHLE; do
            echo "kindledashBefehl(\"$b\");" > $TMP/befehl/$b.js
            touch -t 202001010000 $TMP/befehl/$b.js
        done
        while true; do
            for b in $BEFEHLE; do
                f=$TMP/befehl/$b.js
                if [ "$(stat -c %X $f)" -gt "$(stat -c %Y $f)" ]; then
                    touch -t 202001010000 $f
                    log "Befehl $b"
                    case $b in
                        auffrischen) sleep 1; auffrischen ;;
                        licht-aus) licht aus ;;
                        licht-an) licht an ;;
                        pruefen|aktualisieren)
                            # kein zweites Update, solange eins läuft
                            case "$(cat $TMP/update-status.txt 2>/dev/null)" in laeuft*) continue ;; esac
                            if [ $b = aktualisieren ]; then aufgabe=installieren; else aufgabe=pruefen; fi
                            nohup sh $VZ/aktualisieren.sh $aufgabe > /dev/null 2>&1 &
                            ;;
                    esac
                fi
            done
            sleep 1
        done
    ) &
    echo $! > $TMP/befehl.pid
}

holen() {
    # gibt die Antwort von Node-RED aus, wenn sie nach KindleDash aussieht
    a=$(curl -k -s -m 8 "https://$1:1881$PFAD") || return 1
    case "$a" in *'"kindledash"'*) echo "$a"; return 0 ;; esac
    return 1
}

suchen() {
    # alle Adressen im eigenen /24-Netz, je 20 gleichzeitig
    netz=$(ip -4 addr show wlan0 | sed -n 's/.*inet \([0-9.]*\)\.[0-9]*\/.*/\1/p')
    [ -n "$netz" ] || return 1
    rm -f $TMP/treffer
    i=1
    while [ $i -le 254 ]; do
        ( curl -k -s -m 3 "https://$netz.$i:1881$PFAD" | grep -q '"kindledash"' && echo "$netz.$i" >> $TMP/treffer ) &
        [ $((i % 20)) -eq 0 ] && wait
        i=$((i + 1))
    done
    wait
    [ -s $TMP/treffer ] || return 1
    head -1 $TMP/treffer
}

ssh_starten() {
    [ -f $VZ/ssh-an ] || return
    [ -f /tmp/dropbear_kindledash.pid ] && kill -0 "$(cat /tmp/dropbear_kindledash.pid)" 2>/dev/null && return
    iptables -C INPUT -p tcp --dport 2223 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 2223 -j ACCEPT
    iptables -C OUTPUT -p tcp --sport 2223 -j ACCEPT 2>/dev/null || iptables -I OUTPUT -p tcp --sport 2223 -j ACCEPT
    ( cd /mnt/us/koreader && ./dropbear -E -R -s -p 2223 -P /tmp/dropbear_kindledash.pid ) 2>>$TMP/dienst.log
    log "SSH auf Port 2223"
}

log "Dienst startet ($1)"

if [ "$1" = "--boot" ]; then
    # nach dem Hochfahren braucht die Kindle-Oberfläche etwas, bis Apps starten können
    sleep 40
fi
lipc-set-prop com.lab126.powerd preventScreenSaver 1
ssh_starten
befehle_starten
# Die App startet mit Licht an. War es beim Neustart (etwa durch ein Update) aus, wieder einschalten.
[ -f $VZ/licht.txt ] && licht an
# gleich eine frische Datei schreiben, sonst liest die App bis zur ersten Antwort den alten Stand
schreiben false "" "startet"
[ "$1" = "--boot" ] || [ "$1" = "--app" ] && lipc-set-prop com.lab126.appmgrd start $APP

fehler=0
letzte_auffrischung=$(date +%s)
# erste Update-Prüfung nach zwei Minuten, dann alle sechs Stunden
naechste_pruefung=$(( $(date +%s) + 120 ))
while true; do
    lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null
    befehle_starten
    if [ "$(date +%s)" -ge $naechste_pruefung ]; then
        sh $VZ/aktualisieren.sh pruefen > /dev/null 2>&1 &
        naechste_pruefung=$(( $(date +%s) + 21600 ))
    fi

    if [ -s $GX_FEST ]; then gx=$(cat $GX_FEST); elif [ -s $GX_GEFUNDEN ]; then gx=$(cat $GX_GEFUNDEN); else gx=""; fi

    if [ -n "$gx" ] && antwort=$(holen "$gx"); then
        schreiben true "$gx" "$antwort"
        fehler=0
    else
        fehler=$((fehler + 1))
        # ohne bekannten GX gleich und dann alle 5 Minuten suchen, sonst nach fünf Fehlversuchen in Folge
        if [ ! -s $GX_FEST ] && { { [ -z "$gx" ] && [ $((fehler % 10)) -eq 1 ]; } || [ $fehler -eq 5 ]; }; then
            neu=$(suchen) && { echo "$neu" > $GX_GEFUNDEN; log "GX gefunden: $neu"; gx=$neu; fehler=0; }
        fi
        if [ -n "$gx" ]; then schreiben false "$gx" "keine Antwort"; else schreiben false "" "kein GX gefunden"; fi
    fi

    jetzt=$(date +%s)
    if [ $((jetzt - letzte_auffrischung)) -ge 3600 ]; then
        auffrischen
        letzte_auffrischung=$jetzt
    fi

    # Protokoll klein halten
    [ -f $TMP/dienst.log ] && [ "$(wc -c < $TMP/dienst.log)" -gt 20000 ] && tail -c 10000 $TMP/dienst.log > $TMP/dienst.log.neu && mv $TMP/dienst.log.neu $TMP/dienst.log

    sleep 30
done
