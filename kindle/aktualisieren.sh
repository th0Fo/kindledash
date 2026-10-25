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

status() { echo "$*" > $STATUS; echo "$(date '+%d.%m. %H:%M:%S') update: $*" >> $TMP/dienst.log; }

neuestes() {
    # gibt "tag url" des neuesten Release aus
    j=$(curl -s -m 20 -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/latest") || return 1
    tag=$(echo "$j" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$tag" ] || return 1
    echo "$tag https://codeload.github.com/$REPO/tar.gz/refs/tags/$tag"
}

pruefen() {
    n=$(neuestes) || { status "fehler: GitHub nicht erreichbar"; return 1; }
    echo "${n%% *}" > $TMP/neu.txt
    status "geprueft"
}

installieren() {
    status "laeuft: lade"
    n=$(neuestes) || { status "fehler: GitHub nicht erreichbar"; return 1; }
    tag=${n%% *}; url=${n#* }
    rm -rf $TMP/update $TMP/update.tgz
    mkdir -p $TMP/update
    curl -s -L -m 120 -o $TMP/update.tgz "$url" || { status "fehler: Download abgebrochen"; return 1; }
    tar xzf $TMP/update.tgz -C $TMP/update || { status "fehler: Archiv kaputt"; return 1; }
    neu=$(ls -d $TMP/update/*/kindle 2>/dev/null | head -1)
    if [ ! -f "$neu/web/index.html" ] || [ ! -f "$neu/web/app.js" ] || [ ! -f "$neu/dienst.sh" ]; then
        status "fehler: Archiv unvollständig"; return 1
    fi

    status "laeuft: spiele ein"
    rm -rf $VZ/vorher && mkdir -p $VZ/vorher
    cp -r $VZ/web $VZ/vorher/web
    for f in $VZ/*.sh $VZ/*.conf $VZ/version.txt; do [ -f "$f" ] && cp "$f" $VZ/vorher/; done

    cp $neu/web/* $VZ/web/
    for f in dienst.sh aktualisieren.sh befehl.sh installieren.sh kindledash.conf kindledash-starten.sh \
             kindledash-zuruecksetzen.sh ssh-zugang.sh; do
        [ -f "$neu/$f" ] && cp "$neu/$f" $VZ/$f
    done
    echo "$tag" > $VZ/version.txt
    echo "$tag" > $TMP/neu.txt
    rm -rf $TMP/update $TMP/update.tgz

    status "fertig: $tag"
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
