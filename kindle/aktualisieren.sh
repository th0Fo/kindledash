#!/bin/sh
#
# Updates aus GitHub (Releases von th0Fo/kindledash).
#
#   aktualisieren.sh pruefen       fragt das neueste Release ab, schreibt es nach /tmp/kindledash/neu.txt
#   aktualisieren.sh installieren  lädt das neueste Release, sichert den Stand nach
#                                  /mnt/us/kindledash/vorher und spielt es ein
#
# Eigene Einstellungen (gx.txt, ssh-an, KEIN_AUTOSTART) bleiben unberührt, die
# Einstellungen der App liegen ohnehin im Browser-Speicher des Kindle.

REPO=th0Fo/kindledash
VZ=/mnt/us/kindledash
TMP=/tmp/kindledash
STATUS=$TMP/update-status.txt
mkdir -p $TMP

# Stand für die App, Felder durch | getrennt:
#   laeuft|<Prozent>|<Text>   fertig|<Version>|<Uhrzeit in Sekunden>   fehler|<Text>   geprueft
status() {
    echo "$*" > $STATUS.neu; mv $STATUS.neu $STATUS
    # für die App, die den Stand während des Updates jede Sekunde als Skript lädt
    printf 'kindledashUpdate("%s");\n' "$*" > $TMP/update.js.neu; mv $TMP/update.js.neu $TMP/update.js
    echo "$(date '+%d.%m. %H:%M:%S') update: $*" >> $TMP/dienst.log
}
schritt() { status "laeuft|$1|$2"; }
fehler() { status "fehler|$1"; }

neuestes() {
    # gibt "tag url" des neuesten Release aus
    j=$(curl -s -m 20 -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest") || return 1
    tag=$(echo "$j" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$tag" ] || return 1
    echo "$tag https://codeload.github.com/$REPO/tar.gz/refs/tags/$tag"
}

pruefen() {
    n=$(neuestes) || { fehler "GitHub nicht erreichbar"; return 1; }
    echo "${n%% *}" > $TMP/neu.txt
    status "geprueft"
}

# Lädt $1 nach $2 und meldet dabei den Fortschritt zwischen 5 und 65 Prozent.
# GitHub nennt für Quellarchive keine Größe, also gilt die Größe vom letzten Mal.
laden_mit_fortschritt() {
    erwartet=$(cat $VZ/update-groesse.txt 2>/dev/null)
    [ -n "$erwartet" ] && [ "$erwartet" -gt 0 ] 2>/dev/null || erwartet=900000
    curl -s -L -m 180 -o "$2" "$1" &
    cpid=$!
    while kill -0 $cpid 2>/dev/null; do
        groesse=$(wc -c < "$2" 2>/dev/null || echo 0)
        p=$((5 + 60 * groesse / erwartet)); [ $p -gt 65 ] && p=65
        schritt $p "Lade $3 ($((groesse / 1024)) KB)"
        sleep 1
    done
    wait $cpid || return 1
    wc -c < "$2" > $VZ/update-groesse.txt
}

installieren() {
    schritt 2 "Suche das neueste Release"
    n=$(neuestes) || { fehler "GitHub nicht erreichbar"; return 1; }
    tag=${n%% *}; url=${n#* }
    rm -rf $TMP/update $TMP/update.tgz
    mkdir -p $TMP/update
    laden_mit_fortschritt "$url" $TMP/update.tgz "$tag" || { fehler "Download abgebrochen"; return 1; }
    schritt 72 "Entpacke $tag"
    tar xzf $TMP/update.tgz -C $TMP/update || { fehler "Archiv kaputt"; return 1; }
    schritt 78 "Prüfe die Dateien"
    neu=$(ls -d $TMP/update/*/kindle 2>/dev/null | head -1)
    if [ ! -f "$neu/web/index.html" ] || [ ! -f "$neu/web/app.js" ] || [ ! -f "$neu/dienst.sh" ]; then
        fehler "Archiv unvollständig"; return 1
    fi

    schritt 84 "Sichere den bisherigen Stand"
    rm -rf $VZ/vorher && mkdir -p $VZ/vorher
    cp -r $VZ/web $VZ/vorher/web
    for f in $VZ/*.sh $VZ/*.conf $VZ/version.txt; do [ -f "$f" ] && cp "$f" $VZ/vorher/; done

    schritt 92 "Spiele $tag ein"
    cp $neu/web/* $VZ/web/
    for f in dienst.sh aktualisieren.sh installieren.sh kindledash.conf kindledash-starten.sh \
             kindledash-zuruecksetzen.sh ssh-zugang.sh; do
        [ -f "$neu/$f" ] && cp "$neu/$f" $VZ/$f
    done
    echo "$tag" > $VZ/version.txt
    echo "$tag" > $TMP/neu.txt
    rm -rf $TMP/update $TMP/update.tgz

    schritt 97 "Starte das Dashboard neu"
    sleep 2
    # die neu gestartete App liest das und meldet das Ergebnis
    status "fertig|$tag|$(date +%s)"
    neustart
}

# Dienst und App mit den neuen Dateien neu starten
neustart() {
    [ -f $TMP/dienst.pid ] && kill "$(cat $TMP/dienst.pid)" 2>/dev/null
    [ -f $TMP/befehl.pid ] && kill "$(cat $TMP/befehl.pid)" 2>/dev/null
    rm -f $TMP/dienst.pid $TMP/befehl.pid
    sleep 1
    lipc-set-prop com.lab126.appmgrd stop app://de.kindledash.app
    sleep 2
    sh $VZ/installieren.sh > /dev/null 2>&1
}

case "$1" in
    pruefen) pruefen ;;
    installieren) installieren ;;
    *) echo "Aufruf: $0 pruefen|installieren"; exit 1 ;;
esac
