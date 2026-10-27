# KindleDash

E-Ink-Dashboard auf einem Kindle Paperwhite 3 für das Victron-Hauskraftwerk.

| Ordner | Inhalt |
|---|---|
| `kindle/web` | App für den Kindle-Browser (ES5) |
| `kindle/*.sh` | Scriptlets für die Kindle-Bibliothek |
| `werkzeuge` | Hilfsskripte am PC |
| `entwurf` | Entwürfe und Bildschirmfotos |

## Dunkel und Beleuchtung

**Dunkel**: Nie, Nachts (Vorgabe, von Sonnenuntergang bis Sonnenaufgang laut Open-Meteo) oder Immer. Alle Farben sind invertiert. Sie stehen in `kindle/web/dunkel.css`, erzeugt aus `app.css` mit `python werkzeuge/kindle_dunkel.py` (aus PiHome übernommen). Nach jeder Änderung an `app.css` neu erzeugen, `--pruefen` meldet einen veralteten Stand. Beim Wechsel frischt der Bildschirm einmal komplett auf.

**Beleuchtung aus nach**: nie, 2, 5 (Vorgabe) oder 15 Minuten ohne Berührung. Dann setzt der Dienst die Beleuchtung per `lipc` auf 0. Der nächste Tipp schaltet sie wieder ein und löst sonst nichts aus. Die Helligkeit davor merkt sich `/mnt/us/kindledash/licht.txt`.

## Updates

Der Kindle bietet nur Releases an, keine Zwischenstände von `main`.

1. Änderung committen und pushen
2. Release anlegen: `gh release create v1.0.2 --title v1.0.2 --notes "…"`
3. Der Kindle prüft alle sechs Stunden, in den Einstellungen erscheint oben rechts „Update auf v1.0.2“

Die Version vor dem Update liegt auf dem Kindle unter `/mnt/us/kindledash/vorher`. Das Scriptlet „KindleDash zurücksetzen“ in der Bibliothek holt sie zurück.

Im Heimnetz geht es direkt per SSH: `sh werkzeuge/aufspielen.sh [IP]`.

## Datenquellen

- Wetter, Einstrahlung und Ortssuche: [Open-Meteo](https://open-meteo.com/), CC BY 4.0
- Postleitzahlen: [GeoNames](https://www.geonames.org/), CC BY 4.0, aufbereitet mit `werkzeuge/plz_erzeugen.py`
