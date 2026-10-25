#!/bin/sh
# Name: SSH-Zugang KindleDash
# Author: KindleDash
#
# Startet einen eigenen SSH-Server als root (dropbear aus KOReader) auf
# Port 2223, nur mit Schlüssel (settings/SSH/authorized_keys von KOReader),
# und öffnet dafür die Firewall. Gilt bis zum nächsten Neustart.

LOG=/mnt/us/kindledash-ssh.log
PID=/tmp/dropbear_kindledash.pid
PORT=2223

{
    echo "== $(date)"
    id

    iptables -C INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null \
        || iptables -I INPUT -p tcp --dport $PORT -j ACCEPT
    iptables -C OUTPUT -p tcp --sport $PORT -j ACCEPT 2>/dev/null \
        || iptables -I OUTPUT -p tcp --sport $PORT -j ACCEPT

    if [ -f $PID ] && kill -0 "$(cat $PID)" 2>/dev/null; then
        echo "SSH laeuft bereits auf Port $PORT"
    else
        cd /mnt/us/koreader && ./dropbear -E -R -s -p $PORT -P $PID \
            && echo "SSH gestartet auf Port $PORT"
    fi

    ps | grep '[d]ropbear'
    ip -4 addr show wlan0 | grep inet
} > $LOG 2>&1

cat $LOG
