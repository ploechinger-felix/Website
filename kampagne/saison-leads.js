/**
 * Kampagne „Saisonabschluss 2026" — E-Mail — Empfängeraufbereitung.
 *
 * Baut aus der Leadliste eine geordnete Empfängerdatei, in der jedes
 * Serienfeld bereits ausgerechnet ist. Der Versand liest danach nur noch
 * diese Datei: was einmal vorbereitet wurde, ändert sich zwischen den
 * Tagesportionen nicht mehr, und die Reihenfolge bleibt über Tage stabil.
 *
 * Rechenkern und Wortlaut sind aus scripts/generate-briefe-heimat94.js
 * übernommen — dieselben Konstanten, dieselbe Befundrechnung, damit Brief
 * und Mail nicht auseinanderlaufen. Wird dort eine Annahme geändert, muss
 * sie hier nachgezogen werden; die Fußnote nennt beide Male dieselben Werte.
 *
 * Empfängerkreis: Anlagen-PLZ 83/84/85, ab MIN_KWP, eine E-Mail je Betreiber
 * (die größte Anlage gewinnt — Konzernadressen stehen sonst mehrfach im
 * Verteiler).
 */

const fs   = require('fs');
const path = require('path');
const { Resolver } = require('dns').promises;
const ExcelJS = require('exceljs');

const ROOT        = path.resolve(__dirname, '..');
const XLSX_PATH   = process.env.SAISON_XLSX || path.join(ROOT, 'Anschreiben', 'KolibriInspect_PV_Leads.xlsx');
const SHEET       = process.env.SAISON_SHEET || 'Alle Leads';
const COORD_CACHE = path.join(ROOT, 'scripts', '.cache', 'plz-coords.json');

const PLZ_PREFIXE = (process.env.SAISON_PLZ || '83,84,85').split(',').map(s => s.trim());
const MIN_KWP     = parseFloat(process.env.SAISON_MIN_KWP || '100');

/* ── Aktion ──
   Spiegel von api/promo-codes.js → SAISON-2026. Ändert sich dort etwas,
   muss es hier nachgezogen werden; send-saison.js --pruefen vergleicht den
   Code zusätzlich gegen die ausgelieferte angebot.html. */
const PROMO_CODE      = process.env.SAISON_PROMO || 'SAISON-2026';
const AKTION_BIS      = '31. Oktober 2026';
const PAUSCHALE_LISTE = 190;
const PAUSCHALE_KLEIN = 95;      // < 500 kWp
const PAUSCHALE_GROSS = 0;       // ab 500 kWp entfällt die Anfahrt
const SCHWELLE_GROSS  = 500;
const FREIKILOMETER   = 200;
const ANFAHRT_RATE    = 0.50;    // € je km über den Freikilometern

/* Staffelpreis je Modul — Spiegel von angebot.html / api/server.js */
const PRICE_TIERS = [
  { max: 500,      rate: 0.80 },
  { max: 1500,     rate: 0.70 },
  { max: 3000,     rate: 0.60 },
  { max: 5000,     rate: 0.50 },
  { max: Infinity, rate: 0.40 },
];

const SALZWEG = { lat: 48.5577, lng: 13.4442 };

/* ── Rechenannahmen der Befundtabelle ──
   Wortgleich mit der Fußnote im Brief. Die Prozentsätze gelten je
   betroffenem Modul, nicht für die Anlage: gerechnet wird über
   Häufigkeit × Einzelverlust auf Anlagenebene. Den Jahresertrag direkt mit
   15 % zu multiplizieren wäre um Größenordnungen zu hoch. */
const ERTRAG_KWH_PRO_KWP     = 950;
const STROMWERT_VOLL_EUR_KWH = 0.08;
const STROMWERT_TEIL_EUR_KWH = 0.25;
const MODULE_JE_STRING       = 22;
const ANOMALIEQUOTE          = 0.028;
const VERLUST_HOTSPOT        = 0.15;
const QUOTE_DIODE            = 0.01;
const VERLUST_DIODE          = 0.30;
const VERLUST_VERSCHMUTZ     = 0.01;
const EINSPEISUNG_JAHRE      = 20;
const NEUANLAGE_JAHRE        = 2;

/* Messfenster: DIN EN IEC 62446-3 verlangt mindestens 600 W/m²
   Einstrahlung. In Bayern trägt das bis Ende Oktober, danach beginnt die
   Messsaison erst im März wieder. */
const SAISON_ENDE      = new Date(2026, 9, 31);
const SAISON_ENDE_KURZ = '31. Oktober';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
                'August', 'September', 'Oktober', 'November', 'Dezember'];

/* „Noch 1 Monate" liest sich wie ein Serienbrief, der niemanden gemeint hat.
   Der Fall tritt bei genau den Empfängern auf, deren Frist am knappsten ist —
   also bei denen, die zuerst angeschrieben werden. */
const monate = n => (Math.abs(n) === 1 ? '1 Monat' : n + ' Monate');

/* ── Formatierung ── */
const fmtInt  = v => new Intl.NumberFormat('de-DE').format(Math.round(Number(v) || 0));
const fmtKwp  = v => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(Number(v) || 0);
const fmtEur  = v => new Intl.NumberFormat('de-DE').format(Math.round(Number(v) || 0)) + ' €';
const fmtEur2 = v => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0) + ' €';
const monatJahr = d => d ? MONATE[d.getMonth()] + ' ' + d.getFullYear() : '';

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  const s = String(v);
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const monateBis = (ziel, heute) => Math.round((ziel - heute) / (1000 * 60 * 60 * 24 * 30.44));

function restJahre(ibn, heute) {
  if (!ibn) return null;
  const verstrichen = (heute - ibn) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.floor(EINSPEISUNG_JAHRE - verstrichen));
}

/* Teileinspeiser verbrauchen den Strom überwiegend selbst; ihnen entgeht der
   Bezugspreis, nicht die Einspeisevergütung. Unbekannt fällt bewusst auf den
   niedrigeren Wert zurück — lieber zu vorsichtig gerechnet als ein Betrag,
   den der Empfänger anzweifelt. */
const stromwert = art => /teileinspeisung|eigenverbrauch/i.test(String(art || ''))
  ? STROMWERT_TEIL_EUR_KWH
  : STROMWERT_VOLL_EUR_KWH;

function befundRechnung(l, heute) {
  const kwp = l.kwp;
  const module = l.module || 1;
  const kwpModul = kwp / module;
  const preis = stromwert(l.einspeisungsart);
  const jahre = restJahre(l.ibn, heute);
  const eur = kwpAnteil => Math.round(Math.round(kwpAnteil * ERTRAG_KWH_PRO_KWP) * preis);

  const posten = [
    { bild: 'Zellfehler.jpg',    name: 'Zellfehler / Hot-Spot',
      annahme: fmtInt(module * ANOMALIEQUOTE) + ' Module auffällig (2,8 %), je −15 %',
      kwp: module * ANOMALIEQUOTE * VERLUST_HOTSPOT * kwpModul },
    { bild: 'Diodenfehler.jpg',  name: 'Defekte Bypass-Diode',
      annahme: fmtInt(Math.max(1, Math.round(module * QUOTE_DIODE))) + ' Module betroffen (1 %), je −30 %',
      kwp: module * QUOTE_DIODE * VERLUST_DIODE * kwpModul },
    { bild: 'Stringfehler.jpg',  name: 'Ausgefallener String',
      annahme: 'ein Strang à ' + MODULE_JE_STRING + ' Module ohne Ertrag',
      kwp: MODULE_JE_STRING * kwpModul },
    { bild: 'Verschmutzung.jpg', name: 'Verschmutzung',
      annahme: '5 % Minderertrag auf rund 20 % der Fläche',
      kwp: kwp * VERLUST_VERSCHMUTZ },
  ].map(p => {
    const e = eur(p.kwp);
    return Object.assign({}, p, { eur: e, gesamt: jahre == null ? null : e * jahre });
  });

  const summeEur = posten.reduce((s, p) => s + p.eur, 0);
  return {
    posten, jahre, stromwert: preis, summeEur,
    summeGesamt: jahre == null ? null : summeEur * jahre,
  };
}

function preisRechnung(l, distanzKm) {
  const tier = PRICE_TIERS.find(t => l.module <= t.max);
  const preisModule = Math.round(l.module * tier.rate * 100) / 100;

  const pauschale = l.kwp >= SCHWELLE_GROSS ? PAUSCHALE_GROSS : PAUSCHALE_KLEIN;
  const zuschlagAktion = distanzKm > FREIKILOMETER
    ? Math.round((distanzKm - FREIKILOMETER) * ANFAHRT_RATE * 100) / 100 : 0;
  const zuschlagListe = distanzKm > 100
    ? Math.round((distanzKm - 100) * ANFAHRT_RATE * 100) / 100 : 0;

  const nettoListe  = Math.round((PAUSCHALE_LISTE + preisModule + zuschlagListe) * 100) / 100;
  const nettoAktion = Math.round((pauschale + preisModule + zuschlagAktion) * 100) / 100;

  return {
    ratePerModul: tier.rate, preisModule, pauschale, zuschlagAktion,
    nettoListe, nettoAktion,
    ersparnis: Math.round((nettoListe - nettoAktion) * 100) / 100,
  };
}

/* ── Entfernung ──
   Nur für den Anfahrtszuschlag jenseits der 200 Freikilometer. Nominatim
   erlaubt eine Anfrage je Sekunde; deshalb läuft die Auflösung einmal in der
   Vorbereitung und nicht im Versand, und jede PLZ landet im Cache. */
function haversineKm(a, b) {
  const R = 6371;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function ladeCoordCache() {
  try { return JSON.parse(fs.readFileSync(COORD_CACHE, 'utf8').replace(/^﻿/, '')); }
  catch { return {}; }
}

function schreibeCoordCache(cache) {
  fs.mkdirSync(path.dirname(COORD_CACHE), { recursive: true });
  fs.writeFileSync(COORD_CACHE, JSON.stringify(cache, null, 2));
}

async function geocodePlz(plz, ort) {
  const q = encodeURIComponent(plz + ' ' + ort + ', Deutschland');
  const url = 'https://nominatim.openstreetmap.org/search?q=' + q + '&format=json&limit=1';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KolibriInspect-Kampagne/2.0 (info@kolibri-inspect.de)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    /* Netzfehler: Distanz bleibt 0, der Zuschlag entfällt — ein Ausfall geht
       nie zu Lasten des Empfängers. */
  }
  return null;
}

/* ── Zustellbarkeit der Domain ──
   Eine Empfängerdomain ohne Mailserver erzeugt einen harten Rückläufer, und
   harte Rückläufer sind für eine frische Absenderadresse das teuerste
   Einzelsignal überhaupt: Anbieter messen die Quote, nicht die Absicht. An
   Tag 1 mit 20 Nachrichten wiegt ein einziger Rückläufer fünf Prozent.

   Geprüft wird MX, ersatzweise A — ein A-Record allein ist nach RFC 5321
   ein gültiges Zustellziel, aber unsicher genug, um ihn zu melden.
   Antwortet der Auflöser gar nicht, bleibt der Empfänger drin: eine
   Netzstörung darf keine Liste kürzen. */
const MX_CACHE = path.join(__dirname, '.state', 'mx-cache.json');

function mxAufloeser() {
  const r = new Resolver();
  r.setServers(['1.1.1.1', '8.8.8.8']);
  return r;
}

async function pruefeDomain(d) {
  const r = mxAufloeser();
  try {
    const mx = await r.resolveMx(d);
    if (mx && mx.length) return 'mx';
  } catch (e) {
    if (e.code !== 'ENODATA' && e.code !== 'ENOTFOUND') return 'unklar';
  }
  try {
    const a = await r.resolve4(d);
    if (a && a.length) return 'nur-a';
  } catch (e) {
    if (e.code !== 'ENODATA' && e.code !== 'ENOTFOUND') return 'unklar';
  }
  return 'tot';
}

async function pruefeDomains(leads, log) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(MX_CACHE, 'utf8')); } catch { /* erster Lauf */ }

  const domains = [...new Set(leads.map(l => l.email.split('@')[1]))];
  const offen = domains.filter(d => !cache[d] || cache[d] === 'unklar');
  if (offen.length) {
    log('Zustellbarkeit: ' + offen.length + ' Domains werden geprüft');
    const gleichzeitig = 25;
    for (let i = 0; i < offen.length; i += gleichzeitig) {
      const teil = offen.slice(i, i + gleichzeitig);
      const res = await Promise.all(teil.map(pruefeDomain));
      teil.forEach((d, j) => cache[d] = res[j]);
    }
    fs.mkdirSync(path.dirname(MX_CACHE), { recursive: true });
    fs.writeFileSync(MX_CACHE, JSON.stringify(cache, null, 2));
  }

  const tot = leads.filter(l => cache[l.email.split('@')[1]] === 'tot');
  const nurA = leads.filter(l => cache[l.email.split('@')[1]] === 'nur-a');
  if (tot.length) {
    log('Zustellbarkeit: ' + tot.length + ' Empfänger entfernt — Domain hat keinen Mailserver');
    log('  ' + [...new Set(tot.map(l => l.email.split('@')[1]))].join(', '));
  }
  if (nurA.length) log('Zustellbarkeit: ' + nurA.length + ' Domains ohne MX, nur A-Record — bleiben drin, Rückläufer beobachten');

  return leads.filter(l => cache[l.email.split('@')[1]] !== 'tot');
}

/* ── Excel lesen ── */
async function ladeRohLeads() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error('Leadliste nicht gefunden: ' + XLSX_PATH);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error('Sheet "' + SHEET + '" fehlt in ' + XLSX_PATH);

  const hdr = ws.getRow(1).values.slice(1).map(v => String(v == null ? '' : v));
  const col = name => {
    const i = hdr.indexOf(name);
    if (i < 0) throw new Error('Spalte "' + name + '" fehlt im Sheet ' + SHEET);
    return i + 1;
  };
  const c = {
    firma: col('Firmenname'), ansprech: col('Ansprechpartner'), anrede: col('Anrede'),
    mail: col('E-Mail'), strasse: col('Straße (Anlage)'),
    plzA: col('PLZ (Anlage)'), ortA: col('Ort (Anlage)'),
    kwp: col('Leistung (kWp)'), module: col('Module'),
    art: col('Anlagenart'), einspeisung: col('Einspeisungsart'),
    ibn: col('Inbetriebnahme'), see: col('Einheit-MaStR-Nr.'),
    landkreis: col('Landkreis'),
  };

  const zahl = v => {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const roh = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const email = String(row.getCell(c.mail).text || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return;
    const plzAnlage = String(row.getCell(c.plzA).text || '').trim();
    if (!PLZ_PREFIXE.some(p => plzAnlage.startsWith(p))) return;
    const kwp = zahl(row.getCell(c.kwp).value);
    const module = Math.round(zahl(row.getCell(c.module).value));
    if (!(kwp >= MIN_KWP) || !module) return;

    roh.push({
      email: email,
      firma:     String(row.getCell(c.firma).text || '').trim(),
      ansprech:  String(row.getCell(c.ansprech).text || '').trim(),
      anrede:    String(row.getCell(c.anrede).text || '').trim().replace(/[,;]\s*$/, ''),
      strasse:   String(row.getCell(c.strasse).text || '').trim(),
      plz:       plzAnlage,
      ort:       String(row.getCell(c.ortA).text || '').trim(),
      landkreis: String(row.getCell(c.landkreis).text || '').trim(),
      kwp: kwp,
      module: module,
      anlagenart:      String(row.getCell(c.art).text || '').trim(),
      einspeisungsart: String(row.getCell(c.einspeisung).text || '').trim(),
      ibn: toDate(row.getCell(c.ibn).value),
      see: String(row.getCell(c.see).text || '').trim(),
    });
  });
  return roh;
}

/* Eine Adresse, ein Empfänger: bei mehreren Anlagen gewinnt die größte.
   Andernfalls stünde dieselbe Verwaltungsadresse zehnmal im Verteiler — der
   schnellste Weg in den Spamordner und der sicherste Weg zur Beschwerde. */
function dedupe(roh) {
  const best = new Map();
  for (const l of roh) {
    const prev = best.get(l.email);
    if (!prev || l.kwp > prev.kwp) best.set(l.email, l);
  }
  return [...best.values()];
}

/* Freemail-Anbieter. Ihre Filter sind für unbekannte Absender die
   strengsten — t-online drosselt neue Adressen früh und hartnäckig, GMX und
   web.de sind kaum milder. Ein Block an Tag zwei trifft nicht nur diese
   Empfänger, sondern die ganze Kampagne. */
const FREEMAIL = /^(gmx\.|web\.de$|t-online\.de$|gmail\.com$|googlemail\.|hotmail\.|outlook\.|live\.|yahoo\.|aol\.|freenet\.de$|online\.de$|icloud\.)/i;
const istFreemail = email => FREEMAIL.test(String(email).split('@')[1] || '');

/* ── Sortierung ──
   Erst die Geschäftsadressen, dann die Freemail-Postfächer: bis die zweite
   Gruppe an der Reihe ist, hat die Absenderadresse gut eine Woche
   unauffälligen Verkehr hinter sich, und ein strenger Anbieter kann nicht
   mehr den ganzen Lauf kippen.

   Innerhalb beider Gruppen gilt dieselbe Ordnung: die Betreiber mit noch
   laufender Mängelhaftung zuerst, die knappste Frist voran — dort trägt der
   Aufhänger am weitesten. Danach die abgelaufenen Fristen nach
   Anlagengröße, wo der Auftragswert zählt. */
function sortiere(leads) {
  return leads.sort((a, b) => {
    const af = istFreemail(a.email), bf = istFreemail(b.email);
    if (af !== bf) return af ? 1 : -1;
    const al = a.gwMonateRest > 0;
    const bl = b.gwMonateRest > 0;
    if (al !== bl) return al ? -1 : 1;
    if (al) return a.gwMonateRest - b.gwMonateRest;
    return b.kwp - a.kwp;
  });
}

function textbausteine(l, heute) {
  const gwEnde = l.ibn ? new Date(l.ibn.getFullYear() + 5, l.ibn.getMonth(), l.ibn.getDate()) : null;
  const monateRest = gwEnde ? monateBis(gwEnde, heute) : 0;
  const jahreAlt = l.ibn ? (heute - l.ibn) / (1000 * 60 * 60 * 24 * 365.25) : 99;
  const neu = jahreAlt <= NEUANLAGE_JAHRE;

  /* Bauartabhängiger Satz. Die MaStR-Anlagenart steht in Teilen der Liste
     noch als Katalognummer; dann greift die neutrale Fassung. */
  const art = l.anlagenart;
  const spezifisch = /Freifläche/i.test(art)
    ? 'Bei Freiflächenanlagen typisch: Verschmutzungsbänder an den Unterkanten, Teilverschattung durch aufgewachsene Vegetation.'
    : /Aufdach|Dachanlage|Parkplatz/i.test(art)
      ? 'Bei Dachanlagen typisch: Teilverschattung durch Aufbauten, Hotspots in Feldern, die vom Boden aus nicht beurteilbar sind.'
      : 'Typisch: Hotspots, defekte Bypass-Dioden, Stringausfälle, Verschmutzung.';

  const bauart = /Freifläche/i.test(art) ? 'Ihre Freiflächenanlage'
    : /Aufdach|Dachanlage/i.test(art) ? 'Ihre Dachanlage'
    : 'Ihre Anlage';

  /* Fazit unter dem Fristbalken. Endet die Frist nach dem Messfenster, ist
     der 31. Oktober die letzte Gelegenheit, davor noch zu messen. */
  let fazit = null;
  let fazitDringend = false;
  if (!neu && gwEnde && monateRest > 0) {
    if (gwEnde <= SAISON_ENDE) {
      fazit = 'Die Frist endet noch in dieser Messsaison — danach gibt es keine Gelegenheit mehr davor.';
      fazitDringend = true;
    } else if (monateBis(gwEnde, SAISON_ENDE) <= 5) {
      fazit = 'Noch ' + monate(monateRest) + ' Frist — die letzte Messgelegenheit davor endet am ' + SAISON_ENDE_KURZ + '.';
      fazitDringend = true;
    } else {
      fazit = 'Noch ' + monate(monateRest) + ' Frist — diese Saison oder die nächste ab März.';
    }
  } else if (!neu && monateRest <= 0) {
    fazit = 'Die Mängelhaftung ist abgelaufen — der Befund dient jetzt Versicherung, Wartungsvertrag und Anlagenwert.';
  }

  return { gwEnde, monateRest, neu, spezifisch, bauart, fazit, fazitDringend };
}

async function baueEmpfaenger(opts) {
  const o = opts || {};
  const heute = o.heute || new Date();
  const geocode = o.geocode !== false;
  const log = o.log || function () {};

  const roh = await ladeRohLeads();
  let leads = dedupe(roh);
  log('Leadliste: ' + roh.length + ' Zeilen im Zielgebiet → ' + leads.length + ' eindeutige Empfänger');

  if (o.mxPruefung !== false) leads = await pruefeDomains(leads, log);

  const cache = ladeCoordCache();
  if (geocode) {
    const offen = [...new Set(leads.map(l => l.plz))].filter(p => !cache[p]);
    if (offen.length) log('Entfernung: ' + offen.length + ' PLZ noch nicht im Cache (je gut 1 s)');
    let neu = 0;
    for (const plz of offen) {
      const beispiel = leads.find(l => l.plz === plz);
      const c = await geocodePlz(plz, beispiel ? beispiel.ort : '');
      if (c) { cache[plz] = c; neu++; }
      await new Promise(r => setTimeout(r, 1100));
    }
    if (neu) { schreibeCoordCache(cache); log('Entfernung: ' + neu + ' PLZ neu aufgelöst und gespeichert'); }
  }

  const angereichert = leads.map(l => {
    const t = textbausteine(l, heute);
    const coords = cache[l.plz];
    const distanz = coords ? Math.round(haversineKm(SALZWEG, coords)) : 0;
    const p = preisRechnung(l, distanz);
    const b = befundRechnung(l, heute);

    return {
      email: l.email, firma: l.firma, ansprech: l.ansprech,
      anrede: l.anrede || 'Sehr geehrte Damen und Herren',
      strasse: l.strasse, plz: l.plz, ort: l.ort, landkreis: l.landkreis,
      kwp: l.kwp, module: l.module,
      anlagenart: l.anlagenart, einspeisungsart: l.einspeisungsart, see: l.see,
      ibnIso: l.ibn ? l.ibn.toISOString().slice(0, 10) : null,
      ibnMonatJahr: monatJahr(l.ibn),
      gwEndeIso: t.gwEnde ? t.gwEnde.toISOString().slice(0, 10) : null,
      gwEndeMonat: monatJahr(t.gwEnde),
      gwMonateRest: t.monateRest,
      neuanlage: t.neu,
      spezifisch: t.spezifisch,
      bauart: t.bauart,
      fazit: t.fazit,
      fazitDringend: t.fazitDringend,
      distanzKm: distanz,
      restJahre: b.jahre,
      stromwert: b.stromwert,
      befund: b.posten,
      befundSummeEur: b.summeEur,
      befundSummeGesamt: b.summeGesamt,
      preis: p,
      promo: PROMO_CODE,
      aktionBis: AKTION_BIS,
    };
  });

  return sortiere(angereichert);
}

module.exports = {
  baueEmpfaenger, befundRechnung, preisRechnung, restJahre, textbausteine,
  istFreemail, pruefeDomains,
  fmtInt, fmtKwp, fmtEur, fmtEur2, monatJahr, monate, toDate,
  PROMO_CODE, AKTION_BIS, PAUSCHALE_LISTE, PAUSCHALE_KLEIN, PAUSCHALE_GROSS,
  SCHWELLE_GROSS, FREIKILOMETER, SAISON_ENDE, SAISON_ENDE_KURZ,
  ERTRAG_KWH_PRO_KWP, STROMWERT_VOLL_EUR_KWH, STROMWERT_TEIL_EUR_KWH,
  ANOMALIEQUOTE, EINSPEISUNG_JAHRE, MODULE_JE_STRING,
  MIN_KWP, PLZ_PREFIXE, XLSX_PATH, SHEET,
};
