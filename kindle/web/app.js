/*
 * KindleDash Startseite. Nur ES5: der Kindle-Browser kennt kein let,
 * keine Pfeilfunktionen, keine Template-Strings, kein Promise und kein fetch.
 */
(function () {
  "use strict";

  var AKKU_KWH = 4.8;
  var LADELEISTUNG_W = 1800;
  var WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  var MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
    "August", "September", "Oktober", "November", "Dezember"];

  // Beispielwerte, später vom GX (Node-RED) und von Open-Meteo
  var daten = {
    soc: 78,
    akkuW: 120,
    pvW: 420,
    hausW: 290,
    stromausfallSeit: "14:05",
    letzteWerte: "14:12",
    wetter: { icon: "sonne-wolke", temp: 13, text: "heiter bis wolkig", min: 7, max: 14, regen: "trocken" },
    kwhHeute: 3.1,
    woche: [
      ["sonne-wolke", 14, 7, 3.1],
      ["regen", 11, 6, 0.9],
      ["wolke", 10, 5, 1.4],
      ["sonne", 12, 3, 3.6],
      ["sonne-wolke", 13, 5, 2.7],
      ["niesel", 11, 7, 1.1],
      ["regen", 9, 6, 0.7]
    ]
  };

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

  function hauptwerte() {
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
      $("richtung").innerHTML = icon("pfeil-runter") + "gibt " + (-daten.akkuW) + " W ab";
    }
    $("pv").innerHTML = daten.pvW + "<span>W</span>";
    $("haus").innerHTML = daten.hausW + "<span>W</span>";
    $("letzte-werte").innerHTML = "letzte Werte um " + daten.letzteWerte;
  }

  function wetter() {
    var w = daten.wetter;
    $("wetter-icon").innerHTML = '<use xlink:href="#' + w.icon + '"/>';
    $("temp").innerHTML = w.temp + "°";
    $("wetter-text").innerHTML = w.text + "<br>" + w.min + "° bis " + w.max + "°, " + w.regen;
    $("kwh-heute").innerHTML = komma(daten.kwhHeute, 1) + "<span>kWh</span>";
    $("anteil").innerHTML = Math.round(daten.kwhHeute / AKKU_KWH * 100) + " %";
  }

  // Tageskurve: erwartete Leistung als Fläche, gemessene als Linie bis jetzt
  function kurve() {
    var W = ausrichtung() === "quer" ? 676 : 590, H = 170, unten = 140;
    var von = 7, bis = 18, spitze = 640, h, s = 3, w;
    function x(stunde) { return (stunde - von) / (bis - von) * W; }
    function y(watt) { return unten - watt / spitze * (unten - 8); }
    function erwartet(stunde) { return 560 * Math.exp(-Math.pow(stunde - 12.5, 2) / (2 * 2.2 * 2.2)); }
    var flaeche = "M0 " + unten, linie = "";
    for (h = von; h <= bis + 1e-9; h += 0.25) { flaeche += " L" + x(h).toFixed(1) + " " + y(erwartet(h)).toFixed(1); }
    flaeche += " L" + W + " " + unten + " Z";
    var jetztH = 14.53;
    for (h = von; h <= jetztH; h += 0.25) {
      s = (s * 9301 + 49297) % 233280;
      w = erwartet(h) * (0.9 + 0.16 * s / 233280);
      linie += (linie ? " L" : "M") + x(h).toFixed(1) + " " + y(w).toFixed(1);
    }
    var achse = "", stunden = [8, 10, 12, 14, 16, 18], k;
    for (k = 0; k < stunden.length; k++) {
      achse += '<text x="' + x(stunden[k]) + '" y="166" font-size="22" fill="#6e6e6e" text-anchor="' +
        (stunden[k] === 18 ? "end" : "middle") + '">' + stunden[k] + "</text>";
    }
    var jx = x(jetztH);
    $("kurve").innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' +
      '<path d="' + flaeche + '" fill="#e4e4e4"/>' +
      '<line x1="0" y1="' + unten + '" x2="' + W + '" y2="' + unten + '" stroke="#6e6e6e" stroke-width="2"/>' +
      '<path d="' + linie + '" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round"/>' +
      '<line x1="' + jx + '" y1="8" x2="' + jx + '" y2="' + unten + '" stroke="#000" stroke-width="2" stroke-dasharray="4 5"/>' +
      '<circle cx="' + jx + '" cy="' + y(daten.pvW) + '" r="7" fill="#000"/>' + achse + "</svg>";
  }

  function woche() {
    var heute = new Date().getDay(), html = "", i, t;
    for (i = 0; i < daten.woche.length; i++) {
      t = daten.woche[i];
      html += '<div class="tag' + (i === 0 ? " heute-tag" : "") + '">' +
        '<div class="name">' + WOCHENTAGE[(heute + i) % 7] + "</div>" + icon(t[0]) +
        '<div class="t">' + t[1] + "°<span>" + t[2] + "°</span></div>" +
        '<div class="saeule"><i style="height:' + Math.min(100, Math.round(t[3] / AKKU_KWH * 100)) + '%"></i></div>' +
        '<div class="e">' + komma(t[3], 1) + "</div></div>";
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
  alles();
  if (einstellungen.zustand === "laden") { oeffne("dialog-laden"); }
  document.addEventListener("click", klick, false);
  setInterval(kopf, 30000);
})();
