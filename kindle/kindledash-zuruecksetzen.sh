#!/bin/sh
# Name: KindleDash zurücksetzen
# Author: KindleDash
#
# Holt den Stand vor dem letzten Update zurück, falls das Update Ärger macht.

VZ=/mnt/us/kindledash
TMP=/tmp/kindledash

if [ ! -d $VZ/vorher/web ]; then
    echo "Kein früherer Stand gespeichert."
    exit 0
fi

[ -f $TMP/dienst.pid ] && kill "$(cat $TMP/dienst.pid)" 2>/dev/null
[ -f $TMP/befehl.pid ] && kill "$(cat $TMP/befehl.pid)" 2>/dev/null
rm -f $TMP/dienst.pid $TMP/befehl.pid
lipc-set-prop com.lab126.appmgrd stop app://de.kindledash.app

cp $VZ/vorher/web/* $VZ/web/
for f in $VZ/vorher/*.sh $VZ/vorher/*.conf $VZ/vorher/version.txt; do [ -f "$f" ] && cp "$f" $VZ/; done
echo "Früherer Stand $(cat $VZ/version.txt 2>/dev/null) wiederhergestellt."

sh $VZ/installieren.sh > /dev/null 2>&1
