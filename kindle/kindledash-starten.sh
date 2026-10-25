#!/bin/sh
# Name: KindleDash starten
# Author: KindleDash
# DontUseFBInk
#
# Trägt die App beim ersten Mal in die App-Liste des Kindle ein, hält den
# Bildschirm wach und startet das Dashboard.

DB=/var/local/appreg.db
ID=de.kindledash.app

if [ "$(sqlite3 $DB "select count(*) from handlerIds where handlerId='$ID';")" = "0" ]; then
    cp $DB /mnt/us/kindledash/appreg.db.bak
    sqlite3 $DB "
insert into handlerIds(handlerId) values('$ID');
insert into properties(handlerId,name,value) values('$ID','command','/usr/bin/mesquite -l $ID -c file:///mnt/us/kindledash/web/');
insert into properties(handlerId,name,value) values('$ID','framework','');
insert into properties(handlerId,name,value) values('$ID','unloadPolicy','unloadOnPause');
insert into properties(handlerId,name,value) values('$ID','supportedOrientation','U');
insert into associations(handlerId,interface,contentId,defaultAssoc) values('$ID','application','none','false');
"
fi

lipc-set-prop com.lab126.powerd preventScreenSaver 1
lipc-set-prop com.lab126.appmgrd start app://$ID
