#!/bin/sh
# Name: KindleDash starten
# Author: KindleDash
# DontUseFBInk
#
# Startet das Dashboard. Beim ersten Mal richtet installieren.sh alles ein,
# danach startet nur noch der Dienst (falls nötig) und die App.

if [ ! -f /etc/upstart/kindledash.conf ]; then
    sh /mnt/us/kindledash/installieren.sh
else
    sh /mnt/us/kindledash/dienst.sh --app > /dev/null 2>&1 &
fi
