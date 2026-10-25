/*
 * KindleDash Startseite. Nur ES5: der Kindle-Browser kennt kein let,
 * keine Pfeilfunktionen, keine Template-Strings, kein Promise und kein fetch.
 */
(function () {
  "use strict";

  var AKKU_KWH = 4.8;
  var LADELEISTUNG_W = 1800;
  // Untergrenzen fürs Entladen: im Netzbetrieb hält ESS die Mindestladung,
  // bei Stromausfall läuft der Akku bis zur Abschaltung. Später vom GX lesen.
  var MIN_SOC_NETZ = 70;
  var MIN_SOC_AUSFALL = 10;

  // Standort und Anlage aus dem Einrichtungsassistenten. Die Vorgaben passen zur
  // Anlage in Hamm, nur die Modulleistung ist geschätzt (Typenschild offen).
  var ANLAGE_VORGABE = {
    ort: "Hamm", region: "Nordrhein-Westfalen", lat: 51.68, lon: 7.82,
    module: 3, wp: 400, neigung: 35, richtung: "S", gx: "192.168.178.140"
  };
  var WIRKUNGSGRAD = 0.8;
  var WETTER_MINUTEN = 30;
  var anlage = null;
  var eingerichtet = false;

  // Open-Meteo zählt den Azimut von Süden: Osten -90, Westen 90
  var RICHTUNGEN = {
    N: [180, "Nord"], NO: [-135, "Nordost"], O: [-90, "Ost"], SO: [-45, "Südost"],
    S: [0, "Süd"], SW: [45, "Südwest"], W: [90, "West"], NW: [135, "Nordwest"]
  };
  function kwp(a) { return a.module * a.wp / 1000; }
  var WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  var MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
    "August", "September", "Oktober", "November", "Dezember"];

  // Anlagenwerte sind noch Beispiele, später vom GX (Node-RED)
  var BEISPIEL = {
    normal: { soc: 78, akkuW: 120, pvW: 420, hausW: 290 },
    netzausfall: { soc: 78, akkuW: -290, pvW: 0, hausW: 290 }
  };
  var daten = {
    soc: 78, akkuW: 120, pvW: 420, hausW: 290,
    stromausfallSeit: "14:05",
    letzteWerte: "14:12"
  };

  // Wetter und Prognose von Open-Meteo, aufbereitet von prognoseAufbereiten()
  var prognose = null;

  // WMO-Wettercodes zu Symbol und Text
  var WETTER = {
    0: ["sonne", "klar"], 1: ["sonne", "überwiegend klar"], 2: ["sonne-wolke", "teils bewölkt"],
    3: ["wolke", "bedeckt"], 45: ["nebel", "Nebel"], 48: ["nebel", "Reifnebel"],
    51: ["niesel", "leichter Niesel"], 53: ["niesel", "Niesel"], 55: ["niesel", "starker Niesel"],
    56: ["niesel", "gefrierender Niesel"], 57: ["niesel", "gefrierender Niesel"],
    61: ["regen", "leichter Regen"], 63: ["regen", "Regen"], 65: ["regen", "starker Regen"],
    66: ["regen", "gefrierender Regen"], 67: ["regen", "gefrierender Regen"],
    71: ["schnee", "leichter Schnee"], 73: ["schnee", "Schnee"], 75: ["schnee", "starker Schnee"],
    77: ["schnee", "Schneegriesel"], 80: ["regen", "Regenschauer"], 81: ["regen", "Regenschauer"],
    82: ["regen", "starke Schauer"], 85: ["schnee", "Schneeschauer"], 86: ["schnee", "Schneeschauer"],
    95: ["gewitter", "Gewitter"], 96: ["gewitter", "Gewitter mit Hagel"], 99: ["gewitter", "Gewitter mit Hagel"]
  };
  function wetterCode(c) { return WETTER[c] || ["wolke", ""]; }

  var einstellungen = { ausrichtung: "hoch", zustand: "normal" };
  var netzladung = false;

  function $(id) { return document.getElementById(id); }

  function laden() {
    try {
      var s = JSON.parse(localStorage.getItem("kindledash.einstellungen") || "{}");
      if (s.ausrichtung) { einstellungen.ausrichtung = s.ausrichtung; }
    } catch (e) { /* ohne Speicher gelten die Vorgaben */ }
    var m = /[#&](hoch|quer-links|quer-rechts)/.exec(location.hash);
    if (m) { einstellungen.ausrichtung = m[1]; }
    var z = /[#&](normal|netzausfall|offline|laden)/.exec(location.hash);
    if (z) { einstellungen.zustand = z[1]; }

    anlage = kopie(ANLAGE_VORGABE);
    try {
      var a = JSON.parse(localStorage.getItem("kindledash.anlage") || "null");
      if (a) { anlage = kopie(a); eingerichtet = true; }
    } catch (e2) { /* Vorgaben gelten */ }
  }

  function kopie(o) { return JSON.parse(JSON.stringify(o)); }

  function speichern() {
    try {
      localStorage.setItem("kindledash.einstellungen", JSON.stringify({ ausrichtung: einstellungen.ausrichtung }));
    } catch (e) { /* nicht kritisch */ }
  }

  function komma(x, stellen) { return x.toFixed(stellen).replace(".", ","); }
  function icon(name, klasse) {
    return '<svg class="i' + (klasse ? " " + klasse : "") + '"><use xlink:href="#' + name + '"/></svg>';
  }

  // "quer-rechts" und "quer-links" sagen, wo der USB-Anschluss liegt, wenn der
  // Kindle quer hängt. Anschluss rechts heißt: Inhalt im Uhrzeigersinn drehen.
  function ausrichtung() {
    return einstellungen.ausrichtung === "hoch" ? "hoch" : "quer";
  }

  function koerperKlasse() {
    var c = [ausrichtung(), einstellungen.zustand === "laden" ? "normal" : einstellungen.zustand];
    if (ausrichtung() === "quer" && window.innerWidth < window.innerHeight) {
      c.push("gedreht");
      c.push(einstellungen.ausrichtung === "quer-links" ? "ccw" : "cw");
    }
    if (document.querySelector(".dialog.offen")) { c.push("dialog-offen"); }
    if (as.entwurf) { c.push("assistent-offen"); }
    document.body.className = c.join(" ");
  }

  function kopf() {
    var jetzt = new Date();
    $("datum").innerHTML = WOCHENTAGE[jetzt.getDay()] + ", " + jetzt.getDate() + ". " + MONATE[jetzt.getMonth()];
    var mm = jetzt.getMinutes();
    $("uhr").innerHTML = jetzt.getHours() + ":" + (mm < 10 ? "0" : "") + mm;

    var z = einstellungen.zustand;
    if (z === "netzausfall") {
      $("status").innerHTML = icon("stecker-aus") + "Stromausfall seit " + daten.stromausfallSeit;
    } else if (z === "offline") {
      $("status").innerHTML = icon("wlan-aus") + "keine Verbindung";
    } else {
      $("status").innerHTML = icon("stecker") + "Stromnetz verbunden";
    }
    $("laden-knopf").className = "knopf-icon" + (netzladung ? " aktiv" : "");
  }

  // Grob reicht: ab 2 Stunden ganze Stunden, darunter Minuten in Zehnern
  function dauer(stunden) {
    if (stunden > 48) { return "über 2 Tage"; }
    if (stunden >= 2) { return Math.round(stunden) + " Std"; }
    return Math.max(10, Math.round(stunden * 6) * 10) + " Min";
  }

  // Wie lange reicht der Akku, oder wann ist er voll
  function restzeit() {
    var w = daten.akkuW, kwh;
    if (netzladung) {
      kwh = (100 - daten.soc) / 100 * AKKU_KWH;
      return kwh > 0 ? "voll in etwa " + dauer(kwh * 1000 / LADELEISTUNG_W) : "";
    }
    if (w > 30 && daten.soc < 100) {
      kwh = (100 - daten.soc) / 100 * AKKU_KWH;
      return "voll in etwa " + dauer(kwh * 1000 / w);
    }
    if (w < -30) {
      var grenze = einstellungen.zustand === "netzausfall" ? MIN_SOC_AUSFALL : MIN_SOC_NETZ;
      kwh = (daten.soc - grenze) / 100 * AKKU_KWH;
      if (kwh <= 0) { return "Reserve erreicht"; }
      return "noch etwa " + dauer(kwh * 1000 / -w);
    }
    return "";
  }

  function hauptwerte() {
    var b = BEISPIEL[einstellungen.zustand === "netzausfall" ? "netzausfall" : "normal"], k;
    for (k in b) { if (b.hasOwnProperty(k)) { daten[k] = b[k]; } }
    $("soc").innerHTML = daten.soc + "<span>%</span>";
    var zellen = "", i, voll = daten.soc / 10;
    for (i = 0; i < 10; i++) {
      zellen += "<i class=\"" + (i + 1 <= voll ? "voll" : (i < voll ? "halb" : "")) + "\"></i>";
    }
    $("zellen").innerHTML = zellen;
    if (netzladung) {
      $("richtung").innerHTML = icon("pfeil-hoch") + "lädt aus dem Netz";
    } else if (daten.akkuW >= 0) {
      $("richtung").innerHTML = icon("pfeil-hoch") + "lädt mit " + daten.akkuW + " W";
    } else {
      $("richtung").innerHTML = icon("pfeil-runter") + "entlädt mit " + (-daten.akkuW) + " W";
    }
    $("restzeit").innerHTML = restzeit();
    $("pv").innerHTML = daten.pvW + "<span>W</span>";
    $("haus").innerHTML = daten.hausW + "<span>W</span>";
    $("letzte-werte").innerHTML = "letzte Werte um " + daten.letzteWerte;
  }

  // --- Wetter und Prognose ---------------------------------------------------

  function wetterUrl() {
    return "https://api.open-meteo.com/v1/forecast?latitude=" + anlage.lat + "&longitude=" + anlage.lon +
      "&current=temperature_2m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&hourly=global_tilted_irradiance&tilt=" + anlage.neigung + "&azimuth=" + RICHTUNGEN[anlage.richtung][0] +
      "&timezone=Europe%2FBerlin&forecast_days=7";
  }

  // Erzeugung je Stunde in W: Einstrahlung auf die Modulfläche mal Leistung mal Verluste
  function watt(gti) { return kwp(anlage) * gti * WIRKUNGSGRAD; }

  function prognoseAufbereiten(r) {
    var tage = [], stunden = {}, i, datum, stunde;
    for (i = 0; i < r.hourly.time.length; i++) {
      datum = r.hourly.time[i].substr(0, 10);
      stunde = parseInt(r.hourly.time[i].substr(11, 2), 10);
      if (!stunden[datum]) { stunden[datum] = []; }
      stunden[datum][stunde] = watt(r.hourly.global_tilted_irradiance[i] || 0);
    }
    for (i = 0; i < r.daily.time.length; i++) {
      datum = r.daily.time[i];
      var summe = 0, s, w = stunden[datum] || [];
      for (s = 0; s < w.length; s++) { summe += w[s] || 0; }
      tage.push({
        datum: datum,
        code: r.daily.weather_code[i],
        max: Math.round(r.daily.temperature_2m_max[i]),
        min: Math.round(r.daily.temperature_2m_min[i]),
        regen: r.daily.precipitation_probability_max[i],
        kwh: summe / 1000,
        stunden: w
      });
    }
    return {
      geholt: new Date().getTime(),
      schluessel: wetterUrl(),
      temp: Math.round(r.current.temperature_2m),
      code: r.current.weather_code,
      tage: tage
    };
  }

  function wetterHolen() {
    var x = new XMLHttpRequest();
    x.open("GET", wetterUrl(), true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) { return; }
      if (x.status === 200) {
        try {
          prognose = prognoseAufbereiten(JSON.parse(x.responseText));
          localStorage.setItem("kindledash.prognose", JSON.stringify(prognose));
        } catch (e) { /* alte Prognose bleibt stehen */ }
        wetter(); kurve(); woche();
      }
    };
    x.send();
  }

  function wetterAusSpeicher() {
    try {
      var p = JSON.parse(localStorage.getItem("kindledash.prognose") || "null");
      // älter als 12 Stunden zeigen wir nicht mehr
      if (p && p.schluessel === wetterUrl() && new Date().getTime() - p.geholt < 12 * 3600000) { prognose = p; }
    } catch (e) { /* ohne Speicher eben ohne */ }
  }

  function wetter() {
    if (!prognose) { return; }
    var h = prognose.tage[0], c = wetterCode(prognose.code);
    // innerHTML in einem svg-Element kann der alte Browser nicht, also das ganze Symbol ersetzen
    $("wetter-icon").innerHTML = icon(c[0]);
    $("temp").innerHTML = prognose.temp + "°";
    $("wetter-text").innerHTML = c[1] + "<br>" + h.min + "° bis " + h.max + "°<br>" +
      (h.regen >= 20 ? "Regen " + h.regen + " %" : "trocken");
    $("kwh-heute").innerHTML = komma(h.kwh, 1) + "<span>kWh</span>";
    $("anteil").innerHTML = Math.min(100, Math.round(h.kwh / AKKU_KWH * 100)) + " %";
  }

  // Tageskurve: erwartete Leistung je Stunde als Fläche, dazu die aktuelle Uhrzeit.
  // Die gemessene Linie kommt dazu, sobald der GX Werte liefert.
  function kurve() {
    if (!prognose) { return; }
    var quer = ausrichtung() === "quer";
    var W = quer ? 676 : 590, H = quer ? 160 : 170, unten = H - 30;
    var w = prognose.tage[0].stunden, von = 24, bis = 0, spitze = 100, s;
    for (s = 0; s < 24; s++) {
      if ((w[s] || 0) > 5) { von = Math.min(von, s - 1); bis = Math.max(bis, s); }
      spitze = Math.max(spitze, (w[s] || 0) * 1.15);
    }
    if (von >= bis) { von = 8; bis = 17; }
    von = Math.floor(von / 2) * 2; bis = Math.ceil(bis / 2) * 2;
    function x(stunde) { return (stunde - von) / (bis - von) * W; }
    function y(wert) { return unten - wert / spitze * (unten - 8); }
    // Open-Meteo gibt den Mittelwert der vorangegangenen Stunde, also eine halbe Stunde früher zeichnen
    var flaeche = "M0 " + unten;
    for (s = von; s <= bis; s++) { flaeche += " L" + x(Math.max(von, s - 0.5)).toFixed(1) + " " + y(w[s] || 0).toFixed(1); }
    flaeche += " L" + W + " " + unten + " Z";
    var achse = "", k;
    for (k = von; k <= bis; k += 2) {
      achse += '<text x="' + x(k) + '" y="' + (H - 4) + '" font-size="22" fill="#6e6e6e" text-anchor="' +
        (k === von ? "start" : (k === bis ? "end" : "middle")) + '">' + k + "</text>";
    }
    var jetzt = new Date(), jh = jetzt.getHours() + jetzt.getMinutes() / 60, marke = "";
    if (jh > von && jh < bis) {
      marke = '<line x1="' + x(jh) + '" y1="8" x2="' + x(jh) + '" y2="' + unten +
        '" stroke="#000" stroke-width="2" stroke-dasharray="4 5"/>';
    }
    $("kurve").innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' +
      '<path d="' + flaeche + '" fill="#e4e4e4" stroke="#6e6e6e" stroke-width="2"/>' +
      '<line x1="0" y1="' + unten + '" x2="' + W + '" y2="' + unten + '" stroke="#6e6e6e" stroke-width="2"/>' +
      marke + achse + "</svg>";
  }

  function woche() {
    if (!prognose) { return; }
    var html = "", i, t, d;
    for (i = 0; i < prognose.tage.length; i++) {
      t = prognose.tage[i];
      // der alte Browser liest ISO-Datumsangaben nicht zuverlässig, also selbst zerlegen
      d = new Date(+t.datum.substr(0, 4), +t.datum.substr(5, 2) - 1, +t.datum.substr(8, 2), 12);
      html += '<div class="tag' + (i === 0 ? " heute-tag" : "") + '">' +
        '<div class="name">' + WOCHENTAGE[d.getDay()] + "</div>" + icon(wetterCode(t.code)[0]) +
        '<div class="t">' + t.max + "°<span>" + t.min + "°</span></div>" +
        '<div class="saeule"><i style="height:' + Math.min(100, Math.round(t.kwh / AKKU_KWH * 100)) + '%"></i></div>' +
        '<div class="e">' + komma(t.kwh, 1) + "</div></div>";
    }
    $("woche").innerHTML = html;
  }

  function dialogLaden() {
    $("laden-soc").innerHTML = daten.soc + " %";
    var minuten = Math.round((100 - daten.soc) / 100 * AKKU_KWH * 1000 / LADELEISTUNG_W * 60 / 5) * 5;
    $("laden-dauer").innerHTML = minuten + " Minuten";
    $("laden-start").innerHTML = netzladung ? "Vollladen beenden" : "Jetzt vollladen";
  }

  function segmente() {
    var gruppen = ["ausrichtung", "zustand"], g, el, kinder, i;
    for (g = 0; g < gruppen.length; g++) {
      el = $(gruppen[g]);
      kinder = el.getElementsByTagName("div");
      for (i = 0; i < kinder.length; i++) {
        kinder[i].className = kinder[i].getAttribute("data-wert") === einstellungen[gruppen[g]] ? "an" : "";
      }
    }
  }

  function oeffne(id) {
    schliesseAlle();
    if (id === "dialog-laden") { dialogLaden(); }
    if (id === "dialog-einstellungen") { segmente(); }
    $(id).className = "dialog offen";
    koerperKlasse();
  }

  function schliesseAlle() {
    var d = document.querySelectorAll(".dialog"), i;
    for (i = 0; i < d.length; i++) { d[i].className = "dialog"; }
    koerperKlasse();
  }

  function alles() {
    koerperKlasse();
    kopf();
    hauptwerte();
    wetter();
    kurve();
    woche();
  }

  // --- Einrichtungsassistent -------------------------------------------------

  var SCHRITTE = ["standort", "module", "neigung", "richtung", "gx", "uebersicht"];
  var as = { schritt: 0, entwurf: null, suche: "", treffer: null, suchStatus: "", gxStatus: "" };

  function assistentOeffnen() {
    schliesseAlle();
    as.schritt = 0;
    as.entwurf = kopie(anlage);
    as.suche = "";
    as.treffer = null;
    as.suchStatus = "";
    as.gxStatus = "";
    koerperKlasse();
    assistent();
  }

  function assistentSchliessen() {
    as.entwurf = null;
    koerperKlasse();
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function regler(name, label, wert, einheit) {
    return '<div class="regler"><span class="label">' + label + '</span>' +
      '<div class="minus" data-as="' + name + '-minus">&minus;</div>' +
      '<div class="zahl">' + wert + (einheit ? "<span>" + einheit + "</span>" : "") + "</div>" +
      '<div class="plus" data-as="' + name + '-plus">+</div></div>';
  }

  // Seitenansicht eines Dachs mit Modul, Winkel nach Eingabe
  function dachbild(grad) {
    var r = grad * Math.PI / 180, L = 380, x0 = 140, y0 = 300;
    var x1 = x0 + L * Math.cos(r), y1 = y0 - L * Math.sin(r);
    var bogen = 110, bx = x0 + bogen * Math.cos(r), by = y0 - bogen * Math.sin(r);
    return '<svg class="dach" width="640" height="340" viewBox="0 0 640 340">' +
      '<line x1="40" y1="300" x2="600" y2="300" stroke="#b4b4b4" stroke-width="4"/>' +
      '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1.toFixed(1) + '" y2="' + y1.toFixed(1) + '" stroke="#000" stroke-width="16" stroke-linecap="round"/>' +
      (grad > 0 ? '<path d="M' + (x0 + bogen) + " " + y0 + " A" + bogen + " " + bogen + " 0 0 0 " + bx.toFixed(1) + " " + by.toFixed(1) +
        '" fill="none" stroke="#6e6e6e" stroke-width="3"/>' : "") +
      '<text x="' + (x0 + bogen + 24) + '" y="' + (y0 - 18) + '" font-size="40" font-weight="bold" fill="#000">' + grad + "°</text></svg>";
  }

  function trefferListe() {
    if (as.suchStatus) { return '<div class="hinweis-zeile">' + as.suchStatus + "</div>"; }
    if (!as.treffer) { return ""; }
    var html = '<div class="treffer">', i, t, e = as.entwurf;
    for (i = 0; i < as.treffer.length; i++) {
      t = as.treffer[i];
      html += '<div data-as="treffer" data-nr="' + i + '"' +
        (Math.abs(t.latitude - e.lat) < 1e-4 && Math.abs(t.longitude - e.lon) < 1e-4 ? ' class="an"' : "") + ">" +
        "<b>" + esc(t.name) + "</b><span>" + esc([t.admin3, t.admin1].filter(function (x) { return x && x !== t.name; }).join(", ")) +
        "</span></div>";
    }
    return html + "</div>";
  }

  function assistent() {
    var e = as.entwurf, s = SCHRITTE[as.schritt], html = "", i;
    $("as-schritt").innerHTML = "Schritt " + (as.schritt + 1) + " von " + SCHRITTE.length;
    var f = "";
    for (i = 0; i < SCHRITTE.length; i++) { f += "<i" + (i <= as.schritt ? ' class="an"' : "") + "></i>"; }
    $("as-fortschritt").innerHTML = f;

    if (s === "standort") {
      html = "<h2>Wo steht die Anlage?</h2>" +
        '<div class="unter">Gewählt: <b>' + esc(e.ort) + "</b>" + (e.region ? ", " + esc(e.region) : "") + "</div>" +
        '<div class="eingabe-zeile"><input class="eingabe" id="as-suche" type="text" placeholder="Postleitzahl oder Ort" value="' + esc(as.suche) + '">' +
        '<div class="knopf" data-as="suchen">Suchen</div></div>' +
        '<div id="as-treffer">' + trefferListe() + "</div>";
    } else if (s === "module") {
      html = "<h2>Wie viele Module, mit welcher Leistung?</h2>" +
        regler("anzahl", "Anzahl Module", e.module, "") +
        regler("wp", "Leistung je Modul", e.wp, "W") +
        '<div class="ergebnis">Gesamtleistung<b>' + komma(kwp(e), 2) + " kWp</b></div>";
    } else if (s === "neigung") {
      html = "<h2>Wie steil stehen die Module?</h2>" + dachbild(e.neigung) +
        regler("neigung", "Neigung", e.neigung, "°");
    } else if (s === "richtung") {
      var reihen = [["NW", "N", "NO"], ["W", "", "O"], ["SW", "S", "SO"]], r, k, c;
      html = "<h2>Wohin zeigen die Module?</h2>" + '<div class="kompass">';
      for (r = 0; r < 3; r++) {
        for (k = 0; k < 3; k++) {
          c = reihen[r][k];
          html += c ? '<div data-as="richtung" data-wert="' + c + '"' + (e.richtung === c ? ' class="an"' : "") + "><b>" + c + "</b><span>" +
            RICHTUNGEN[c][1] + "</span></div>" : '<div class="mitte">' + icon("haus") + "</div>";
        }
      }
      html += "</div>";
    } else if (s === "gx") {
      html = "<h2>Unter welcher IP-Adresse ist der GX erreichbar?</h2>" +
        '<div class="eingabe-zeile"><input class="eingabe" id="as-gx" type="text" value="' + esc(e.gx) + '">' +
        '<div class="knopf" data-as="gx-pruefen">Prüfen</div></div>' +
        '<div class="hinweis-zeile" id="as-gx-status">' + as.gxStatus + "</div>";
    } else {
      html = "<h2>Alles richtig?</h2>" + '<div class="uebersicht">' +
        "<div><span>Ort</span><b>" + esc(e.ort) + "</b></div>" +
        "<div><span>Module</span><b>" + e.module + " × " + e.wp + " W = " + komma(kwp(e), 2) + " kWp</b></div>" +
        "<div><span>Neigung</span><b>" + e.neigung + "°</b></div>" +
        "<div><span>Ausrichtung</span><b>" + RICHTUNGEN[e.richtung][1] + "</b></div>" +
        "<div><span>GX</span><b>" + esc(e.gx) + "</b></div></div>";
    }
    $("as-inhalt").innerHTML = html;
    $("as-zurueck").innerHTML = as.schritt === 0 ? "Abbrechen" : "Zurück";
    $("as-weiter").innerHTML = as.schritt === SCHRITTE.length - 1 ? "Speichern" : "Weiter";
  }

  function eingabenUebernehmen() {
    var s = $("as-suche"), g = $("as-gx");
    if (s) { as.suche = s.value; }
    if (g) { as.entwurf.gx = g.value.replace(/\s/g, ""); }
  }

  // Die Postleitzahlen liegen als plz.js auf dem Kindle (GeoNames). Sie werden
  // erst bei der ersten Suche geladen, weil die Datei gut 300 KB groß ist.
  function plzLaden(weiter) {
    if (window.PLZ_DE) { weiter(); return; }
    var s = document.createElement("script");
    s.src = "plz.js";
    s.onload = weiter;
    s.onerror = function () { as.suchStatus = "Postleitzahlen fehlen"; $("as-treffer").innerHTML = trefferListe(); };
    document.body.appendChild(s);
  }

  function plzSuchen(anfang) {
    plzLaden(function () {
      var t = [], k, p;
      for (k in window.PLZ_DE) {
        if (window.PLZ_DE.hasOwnProperty(k) && k.indexOf(anfang) === 0) {
          p = window.PLZ_DE[k];
          t.push({ name: k + " " + p[2], admin1: "", admin3: "", latitude: p[0], longitude: p[1] });
          if (t.length >= 6) { break; }
        }
      }
      as.suchStatus = t.length ? "" : "Postleitzahl nicht gefunden";
      as.treffer = t;
      if (as.entwurf && SCHRITTE[as.schritt] === "standort") { $("as-treffer").innerHTML = trefferListe(); }
    });
  }

  function ortSuchen() {
    eingabenUebernehmen();
    var name = as.suche.replace(/^\s+|\s+$/g, "");
    if (name.length < 2) { return; }
    as.suchStatus = "Suche läuft";
    as.treffer = null;
    $("as-treffer").innerHTML = trefferListe();
    if (/^\d{2,5}$/.test(name)) { plzSuchen(name); return; }
    var x = new XMLHttpRequest();
    x.open("GET", "https://geocoding-api.open-meteo.com/v1/search?count=5&language=de&countryCode=DE&name=" +
      encodeURIComponent(name), true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) { return; }
      as.suchStatus = "";
      if (x.status === 200) {
        try { as.treffer = JSON.parse(x.responseText).results || []; } catch (e) { as.treffer = []; }
        if (!as.treffer.length) { as.suchStatus = "Nichts gefunden"; }
      } else {
        as.suchStatus = "Suche nicht erreichbar";
      }
      if (SCHRITTE[as.schritt] === "standort") { $("as-treffer").innerHTML = trefferListe(); }
    };
    x.send();
  }

  // Der GX liefert die Werte später über Node-RED, der Endpunkt erlaubt Abfragen von der App
  function gxPruefen() {
    eingabenUebernehmen();
    as.gxStatus = "Prüfe " + esc(as.entwurf.gx);
    $("as-gx-status").innerHTML = as.gxStatus;
    var x = new XMLHttpRequest(), fertig = false;
    function ergebnis(ok) {
      if (fertig) { return; }
      fertig = true;
      as.gxStatus = ok ? icon("haken") + " GX antwortet" : "Keine Antwort vom GX";
      if (as.entwurf && SCHRITTE[as.schritt] === "gx") { $("as-gx-status").innerHTML = as.gxStatus; }
    }
    x.open("GET", "http://" + as.entwurf.gx + ":1880/kindledash/werte", true);
    x.onreadystatechange = function () { if (x.readyState === 4) { ergebnis(x.status === 200); } };
    // der alte Browser kennt kein xhr.timeout
    setTimeout(function () { if (!fertig) { x.abort(); ergebnis(false); } }, 8000);
    x.send();
  }

  function assistentAktion(a, el) {
    var e = as.entwurf;
    if (a === "suchen") { ortSuchen(); return; }
    if (a === "treffer") {
      var t = as.treffer[+el.getAttribute("data-nr")];
      e.ort = t.name; e.region = t.admin1 || ""; e.lat = t.latitude; e.lon = t.longitude;
      eingabenUebernehmen(); assistent(); return;
    }
    if (a === "gx-pruefen") { gxPruefen(); return; }
    if (a === "richtung") { e.richtung = el.getAttribute("data-wert"); assistent(); return; }
    if (a === "anzahl-minus") { e.module = Math.max(1, e.module - 1); }
    if (a === "anzahl-plus") { e.module = Math.min(60, e.module + 1); }
    if (a === "wp-minus") { e.wp = Math.max(50, e.wp - 5); }
    if (a === "wp-plus") { e.wp = Math.min(800, e.wp + 5); }
    if (a === "neigung-minus") { e.neigung = Math.max(0, e.neigung - 5); }
    if (a === "neigung-plus") { e.neigung = Math.min(90, e.neigung + 5); }
    assistent();
  }

  function assistentWeiter() {
    eingabenUebernehmen();
    if (as.schritt < SCHRITTE.length - 1) { as.schritt++; assistent(); return; }
    anlage = kopie(as.entwurf);
    eingerichtet = true;
    try { localStorage.setItem("kindledash.anlage", JSON.stringify(anlage)); } catch (e) { /* nur bis zum Neustart */ }
    prognose = null;
    assistentSchliessen();
    alles();
    wetterHolen();
  }

  function assistentZurueck() {
    eingabenUebernehmen();
    if (as.schritt === 0) { assistentSchliessen(); return; }
    as.schritt--;
    assistent();
  }

  // Ohne Titelleiste gibt es kein X, also zurück zur Kindle-Startseite
  function zumKindle() {
    var k = window.kindle;
    if (!k || !k.appmgr) { return; }
    try { k.appmgr.start("app://com.lab126.booklet.home"); } catch (e) {
      try { k.appmgr.back(); } catch (e2) { /* nichts zu tun */ }
    }
  }

  function klick(e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.getAttribute && t.getAttribute("data-as")) { assistentAktion(t.getAttribute("data-as"), t); return; }
      if (t.id === "as-weiter") { assistentWeiter(); return; }
      if (t.id === "as-zurueck") { assistentZurueck(); return; }
      if (t.id === "einrichtung-knopf") { assistentOeffnen(); return; }
      if (t.id === "laden-knopf") { oeffne("dialog-laden"); return; }
      if (t.id === "einstellungen-knopf") { oeffne("dialog-einstellungen"); return; }
      if (t.id === "beenden") { zumKindle(); return; }
      if (t.id === "laden-start") { netzladung = !netzladung; schliesseAlle(); alles(); return; }
      if (t.id === "schleier" || t.getAttribute("data-schliessen")) { schliesseAlle(); return; }
      if (t.getAttribute("data-wert") && t.parentNode && t.parentNode.className === "segment") {
        var gruppe = t.parentNode.id, wert = t.getAttribute("data-wert");
        einstellungen[gruppe] = wert;
        if (gruppe === "ausrichtung") { speichern(); }
        alles();
        segmente();
        koerperKlasse();
        return;
      }
      t = t.parentNode;
    }
  }

  laden();
  wetterAusSpeicher();
  alles();
  if (einstellungen.zustand === "laden") { oeffne("dialog-laden"); }
  document.addEventListener("click", klick, false);
  document.addEventListener("keyup", function (e) {
    if (e.keyCode === 13 && e.target && e.target.id === "as-suche") { ortSuchen(); }
  }, false);
  // Beim ersten Start fragt der Assistent die Anlage ab. #assistent-3 öffnet ihn zum Testen bei Schritt 3.
  var at = /[#&]assistent-?(\d)?/.exec(location.hash);
  if (!eingerichtet || at) {
    assistentOeffnen();
    if (at && at[1]) { as.schritt = Math.min(SCHRITTE.length, +at[1]) - 1; assistent(); }
  }
  setInterval(kopf, 30000);
  setInterval(kurve, 10 * 60000);
  wetterHolen();
  setInterval(wetterHolen, WETTER_MINUTEN * 60000);
})();
