#!/bin/sh
# Name: KindleDash installieren
# Author: KindleDash
#
# Einmalig nach dem Kopieren von /mnt/us/kindledash ausführen (per SSH oder
# als Scriptlet aus der Bibliothek). Trägt die App in die App-Liste ein, legt
# den Autostart an und startet Dienst und Dashboard.

VZ=/mnt/us/kindledash
DB=/var/local/appreg.db
ID=de.kindledash.app

if [ "$(sqlite3 $DB "select count(*) from handlerIds where handlerId='$ID';")" = "0" ]; then
    cp $DB $VZ/appreg.db.bak
    sqlite3 $DB "
insert into handlerIds(handlerId) values('$ID');
insert into properties(handlerId,name,value) values('$ID','command','/usr/bin/mesquite -l $ID -c file:///mnt/us/kindledash/web/');
insert into properties(handlerId,name,value) values('$ID','framework','');
insert into properties(handlerId,name,value) values('$ID','unloadPolicy','unloadOnPause');
insert into properties(handlerId,name,value) values('$ID','supportedOrientation','U');
insert into associations(handlerId,interface,contentId,defaultAssoc) values('$ID','application','none','false');
"
    echo "App eingetragen"
fi

if ! cmp -s $VZ/kindledash.conf /etc/upstart/kindledash.conf; then
    mntroot rw && cp $VZ/kindledash.conf /etc/upstart/kindledash.conf
    mntroot ro
    echo "Autostart eingerichtet"
fi

cp $VZ/kindledash-starten.sh /mnt/us/documents/kindledash-starten.sh
cp $VZ/kindledash-zuruecksetzen.sh /mnt/us/documents/kindledash-zuruecksetzen.sh
chmod +x $VZ/befehl.sh
sh $VZ/dienst.sh --app > /dev/null 2>&1 &
echo "KindleDash läuft"
