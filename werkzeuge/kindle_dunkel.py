#!/usr/bin/env python3
"""Erzeugt kindle/web/dunkel.css aus kindle/web/app.css.

Die App bildet den Dunkelmodus der Kindle-Firmware nach (übernommen aus PiHome),
wie der Kindle selbst: jede Farbe wird invertiert. Statt ein zweites Stylesheet von Hand zu
pflegen, bekommt hier jede Regel mit Farbe ein Gegenstueck unter body.dunkel. Der Selektor
wird dabei nur verlaengert, die Spezifitaet steigt also immer, und die Reihenfolge bleibt.

Aufruf:  python werkzeuge/kindle_dunkel.py          schreibt dunkel.css
         python werkzeuge/kindle_dunkel.py --pruefen  Rueckgabe 1, wenn dunkel.css veraltet ist
"""
import io
import os
import re
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HIER, "..", "kindle", "web")
QUELLE = os.path.join(WEB, "app.css")
ZIEL = os.path.join(WEB, "dunkel.css")

HEX = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
RGBA = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,\s*[\d.]+\s*)?\)")
EIGENSCHAFTEN = ("color", "background", "background-color", "border", "border-color", "border-top",
                 "border-bottom", "border-left", "border-right", "stroke", "fill", "outline")


def invertiere_hex(m):
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + "".join("%02x" % (255 - int(h[i:i + 2], 16)) for i in (0, 2, 4))


def invertiere_rgba(m):
    r, g, b = (255 - int(m.group(i)) for i in (1, 2, 3))
    rest = m.group(4) or ""
    return ("rgba(%d, %d, %d%s)" % (r, g, b, rest)) if rest else ("rgb(%d, %d, %d)" % (r, g, b))


def dunkler_selektor(sel):
    sel = sel.strip()
    if sel == "html":
        return "body.dunkel"
    if sel == "body" or sel.startswith("body.") or sel.startswith("body "):
        return "body.dunkel" + sel[4:]
    return "body.dunkel " + sel


def erzeugen():
    css = io.open(QUELLE, encoding="utf-8").read()
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)          # Kommentare raus
    zeilen = ["/* Automatisch erzeugt aus app.css von werkzeuge/kindle_dunkel.py - nicht von Hand aendern.",
              " * Dunkelmodus: jede Farbe invertiert, wie der Dunkelmodus der Kindle-Firmware. */"]
    for sel, inhalt in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        sel = sel.strip()
        if sel.startswith("@"):
            continue                                        # @font-face u. ae. haben keine Farben
        neu = []
        for dekl in inhalt.split(";"):
            if ":" not in dekl:
                continue
            name, wert = dekl.split(":", 1)
            name = name.strip()
            if name not in EIGENSCHAFTEN and not name.startswith("border"):
                continue
            if not (HEX.search(wert) or RGBA.search(wert)):
                continue
            wert = RGBA.sub(invertiere_rgba, HEX.sub(invertiere_hex, wert.strip()))
            neu.append("%s: %s" % (name, wert))
        if neu:
            liste = []
            for s in sel.split(","):
                d = dunkler_selektor(s)
                if d not in liste:                          # "html, body" ergaebe zweimal body.dunkel
                    liste.append(d)
            selektoren = ", ".join(liste)
            zeilen.append("%s { %s; }" % (selektoren, "; ".join(neu)))
    return "\n".join(zeilen) + "\n"


if __name__ == "__main__":
    text = erzeugen()
    if sys.argv[1:] == ["--pruefen"]:
        alt = io.open(ZIEL, encoding="utf-8").read() if os.path.exists(ZIEL) else ""
        if alt.replace("\r\n", "\n") != text:
            print("dunkel.css ist veraltet: python werkzeuge/kindle_dunkel.py")
            sys.exit(1)
        print("dunkel.css passt zu app.css")
        sys.exit(0)
    io.open(ZIEL, "w", encoding="utf-8", newline="\n").write(text)
    print("dunkel.css geschrieben: %d Regeln" % (len(text.splitlines()) - 2))
