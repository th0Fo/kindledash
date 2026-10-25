"""Erzeugt node-red/kindledash-flow.json für Node-RED auf dem Victron GX.

Aufruf: python -I werkzeuge/flow_erzeugen.py node-red/kindledash-flow.json

Der Ablauf liest nur. Er merkt sich die Werte der Victron-Eingänge im
Flow-Kontext und beantwortet GET /kindledash/werte mit JSON. Der Dienst auf
dem Kindle fragt das alle 30 Sekunden über https://GX:1881 ab.

Die Victron-Bausteine folgen dem Format aus den Beispielen von
node-red-contrib-victron (Dienst mit /0, wie dort).
"""
import json
import sys

TAB = "kd0000000000tab"

# Schlüssel, D-Bus-Dienst, Pfad, Typ, Anzeigename, Knotentyp
EINGAENGE = [
    ("soc", "com.victronenergy.system/0", "/Dc/Battery/Soc", "float", "Battery State of Charge (%)", "victron-input-system"),
    ("akkuW", "com.victronenergy.system/0", "/Dc/Battery/Power", "float", "Battery Power (W)", "victron-input-system"),
    ("pvW", "com.victronenergy.system/0", "/Dc/Pv/Power", "float", "PV - DC-coupled power (W)", "victron-input-system"),
    ("hausW", "com.victronenergy.system/0", "/Ac/Consumption/L1/Power", "float", "AC Consumption L1 (W)", "victron-input-system"),
    ("netzW", "com.victronenergy.system/0", "/Ac/Grid/L1/Power", "float", "Grid L1 (W)", "victron-input-system"),
    ("netzQuelle", "com.victronenergy.system/0", "/Ac/ActiveIn/Source", "enum", "Active input source", "victron-input-system"),
    ("zustand", "com.victronenergy.system/0", "/SystemState/State", "enum", "System state", "victron-input-system"),
    ("minSoc", "com.victronenergy.settings/0", "/Settings/CGwacs/BatteryLife/MinimumSocLimit", "float",
     "ESS Minimum SoC (unless grid fails) (%)", "victron-input-settings"),
]

MERKEN = "flow.set('kd_{k}', {{ w: msg.payload, t: Date.now() }});\nreturn null;"

# Wechselt die Netzquelle zwischen 240 (kein Netz) und etwas anderem, beginnt ein neuer Zeitraum
NETZ = (
    "const alt = flow.get('kd_netzQuelle');\n"
    "if (!alt || (alt.w === 240) !== (msg.payload === 240)) {\n"
    "    flow.set('kd_netzSeit', Date.now());\n"
    "}\n"
    "flow.set('kd_netzQuelle', { w: msg.payload, t: Date.now() });\n"
    "return null;"
)

ANTWORT = (
    "const schluessel = " + json.dumps([e[0] for e in EINGAENGE]) + ";\n"
    "const out = { kindledash: 1, zeit: Date.now() };\n"
    "let neuste = 0;\n"
    "for (const k of schluessel) {\n"
    "    const v = flow.get('kd_' + k);\n"
    "    if (v && v.w !== null && v.w !== undefined) { out[k] = v.w; neuste = Math.max(neuste, v.t); }\n"
    "}\n"
    "// 240 heißt: kein Netz am AC-Eingang (Wechselrichterbetrieb)\n"
    "if (out.netzQuelle !== undefined) { out.netz = out.netzQuelle === 240 ? 'aus' : 'ein'; }\n"
    "out.netzSeit = flow.get('kd_netzSeit') || null;\n"
    "out.alter = neuste ? Math.round((Date.now() - neuste) / 1000) : null;\n"
    "msg.payload = out;\n"
    "msg.headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };\n"
    "return msg;"
)


def main(ziel):
    knoten = [{"id": TAB, "type": "tab", "label": "KindleDash", "disabled": False,
               "info": "Liefert Werte für das Kindle-Dashboard. Liest nur, schreibt nichts an der Anlage."}]
    for i, (k, dienst, pfad, typ, name, art) in enumerate(EINGAENGE):
        ein, fn = "kd%02dein" % i, "kd%02dfn" % i
        knoten.append({
            "id": ein, "type": art, "z": TAB, "service": dienst, "path": pfad,
            "serviceObj": {"service": dienst, "name": "Venus system" if "system" in dienst else "Venus settings"},
            "pathObj": {"path": pfad, "type": typ, "name": name},
            "name": "", "onlyChanges": False, "x": 220, "y": 60 + i * 60, "wires": [[fn]],
        })
        knoten.append({
            "id": fn, "type": "function", "z": TAB, "name": "merken " + k,
            "func": NETZ if k == "netzQuelle" else MERKEN.format(k=k),
            "outputs": 1, "noerr": 0, "initialize": "", "finalize": "", "libs": [],
            "x": 560, "y": 60 + i * 60, "wires": [[]],
        })
    y = 60 + len(EINGAENGE) * 60 + 40
    knoten += [
        {"id": "kdhttpin", "type": "http in", "z": TAB, "name": "GET /kindledash/werte", "url": "/kindledash/werte",
         "method": "get", "upload": False, "swaggerDoc": "", "x": 200, "y": y, "wires": [["kdantwort"]]},
        {"id": "kdantwort", "type": "function", "z": TAB, "name": "Werte als JSON", "func": ANTWORT,
         "outputs": 1, "noerr": 0, "initialize": "", "finalize": "", "libs": [], "x": 460, "y": y, "wires": [["kdhttpout"]]},
        {"id": "kdhttpout", "type": "http response", "z": TAB, "name": "", "statusCode": "", "headers": {},
         "x": 680, "y": y, "wires": []},
    ]
    with open(ziel, "w", encoding="utf-8", newline="\n") as f:
        json.dump(knoten, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(len(knoten), "Knoten")


if __name__ == "__main__":
    main(sys.argv[1])
