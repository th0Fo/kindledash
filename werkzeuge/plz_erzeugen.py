"""Erzeugt kindle/web/plz.js aus der GeoNames-Postleitzahlenliste für Deutschland.

Quelle: https://download.geonames.org/export/zip/DE.zip (CC BY 4.0, GeoNames).
Aufruf: python -I werkzeuge/plz_erzeugen.py <Pfad zu DE.txt> kindle/web/plz.js

Großkunden-Postleitzahlen (Firmen, Behörden) haben in der Liste keine
Genauigkeitsangabe und fliegen raus. Hat eine Postleitzahl mehrere Orte,
bleiben bis zu drei Namen und der Mittelpunkt ihrer Koordinaten.
"""
import json
import sys
from collections import OrderedDict


def main(quelle, ziel):
    plz = OrderedDict()
    with open(quelle, encoding="utf-8") as f:
        for zeile in f:
            t = zeile.rstrip("\n").split("\t")
            if len(t) < 12 or not t[11]:
                continue
            nummer, ort, lat, lon = t[1], t[2], float(t[9]), float(t[10])
            plz.setdefault(nummer, []).append((ort, lat, lon))

    daten = OrderedDict()
    for nummer in sorted(plz):
        orte = plz[nummer]
        namen = []
        for ort, _, _ in orte:
            if ort not in namen:
                namen.append(ort)
        lat = sum(o[1] for o in orte) / len(orte)
        lon = sum(o[2] for o in orte) / len(orte)
        daten[nummer] = [round(lat, 3), round(lon, 3), ", ".join(namen[:3])]

    with open(ziel, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* Postleitzahlen Deutschland mit Koordinaten. Daten: GeoNames (geonames.org), CC BY 4.0.\n")
        f.write("   Erzeugt mit werkzeuge/plz_erzeugen.py, nicht von Hand bearbeiten. */\n")
        f.write("window.PLZ_DE = ")
        json.dump(daten, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(len(daten), "Postleitzahlen")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
