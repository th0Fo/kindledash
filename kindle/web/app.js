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

  // Standort und Anlage, später aus dem Einrichtungsassistenten
  var ANLAGE = { lat: 51.68, lon: 7.82, kwp: 1.2, neigung: 35, azimut: 0, wirkungsgrad: 0.8 };
  var WETTER_MINUTEN = 30;
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
  }

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
    return "https://api.open-meteo.com/v1/forecast?latitude=" + ANLAGE.lat + "&longitude=" + ANLAGE.lon +
      "&current=temperature_2m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&hourly=global_tilted_irradiance&tilt=" + ANLAGE.neigung + "&azimuth=" + ANLAGE.azimut +
      "&timezone=Europe%2FBerlin&forecast_days=7";
  }

  // Erzeugung je Stunde in W: Einstrahlung auf die Modulfläche mal Leistung mal Verluste
  function watt(gti) { return ANLAGE.kwp * gti * ANLAGE.wirkungsgrad; }

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
      if (p && new Date().getTime() - p.geholt < 12 * 3600000) { prognose = p; }
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
  setInterval(kopf, 30000);
  setInterval(kurve, 10 * 60000);
  wetterHolen();
  setInterval(wetterHolen, WETTER_MINUTEN * 60000);
})();
