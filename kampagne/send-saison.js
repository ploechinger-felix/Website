#!/usr/bin/env node
/**
 * Kampagne „Saisonabschluss 2026" — E-Mail-Versand.
 *
 * Aufhänger und Rechenkern sind aus dem Postmailing übernommen
 * (scripts/generate-briefe-heimat94.js): Ende der Errichter-Mängelhaftung
 * nach § 634a Abs. 1 Nr. 2 BGB, kombiniert mit dem Messfenster der Saison
 * nach DIN EN IEC 62446-3. Beide Fristen sind je Empfänger gerechnet.
 *
 * Zustellbarkeit ist hier kein Nebenschauplatz, sondern der Grund für den
 * Aufbau: eine frisch angelegte Absenderadresse hat keine Reputation. Wer
 * am ersten Tag tausend gleichlautende Mails schickt, ist am zweiten Tag im
 * Spamordner — und zwar dauerhaft, weil die Domain mitleidet. Deshalb:
 *
 *   - Tagesmengen nach einer Rampe (RAMPE), gezählt in Versandtagen, nicht
 *     in Kalendertagen; ein ausgefallener Tag verschiebt, statt zu springen.
 *   - zufällige Abstände zwischen den Nachrichten statt Sekundentakt.
 *   - Betreffvarianten, je Empfänger deterministisch aus der Adresse
 *     abgeleitet — kein identischer Massenbetreff, aber reproduzierbar.
 *   - jede Mail trägt Zahlen dieser einen Anlage; die Textähnlichkeit über
 *     den Verteiler bleibt niedrig.
 *   - Multipart mit vollwertigem Textteil, keine Zählpixel, keine
 *     Weiterleitungslinks, Ziel-URL auf der eigenen Domain.
 *   - List-Unsubscribe im Kopf, Abmeldung im Fuß, Sperrliste vor jedem Lauf.
 *
 * Zwei Kampagnen, getrennte Listen und Protokolle:
 *   --kampagne plz83-85   (Voreinstellung)  987 Empfänger
 *   --kampagne plz94      Heimatregion,     524 Empfänger
 *
 * Modi:
 *   node send-saison.js --vorbereiten          Empfängerdatei bauen
 *   node send-saison.js --plan                 Rampe und Fortschritt zeigen
 *   node send-saison.js --pruefen              SMTP, DNS, Links, Aktionscode
 *   node send-saison.js --vorschau 0           HTML+Text von Empfänger #0
 *   node send-saison.js --test=ich@meine.de    echte Testmail an sich selbst
 *   node send-saison.js                        Trockenlauf der Tagesportion
 *   node send-saison.js --send --nur=a@b.de    nur diesen einen Empfänger
 *   node send-saison.js --send --heute         Tagesportion scharf
 *   node send-saison.js --send --anzahl 25     feste Menge scharf
 */

const fs   = require('fs');
const path = require('path');
const dns  = require('dns').promises;

require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT   = path.resolve(__dirname, '..');
const STATE  = path.join(__dirname, '.state');
const LOGDIR = path.join(__dirname, 'logs');

/* ── Kampagnen ──
   Zwei Gebiete, gleicher Aufhänger, getrennte Läufe. Jede Kampagne führt
   ihre eigene Empfängerdatei und ihr eigenes Versandprotokoll: teilten sie
   sich eine, würde die zweite Vorbereitung die Liste der ersten
   überschreiben und das Protokoll gleich mit — Empfänger bekämen die Mail
   ein zweites Mal, und nachweisen ließe sich nichts mehr.

   Die Sperrliste bleibt bewusst gemeinsam. Wer sich abmeldet, meint nicht
   eine Kampagne, sondern uns. */
const KAMPAGNEN = {
  'plz83-85': {
    xlsx:  path.join(ROOT, 'Anschreiben', 'KolibriInspect_PV_Leads.xlsx'),
    sheet: 'Alle Leads',
    plz:   '83,84,85',
    titel: 'Saisonabschluss 2026 — PLZ 83/84/85',
  },
  'plz94': {
    xlsx:  path.join(ROOT, 'Anschreiben', 'KolibriInspect_PV_Leads_PLZ94_Mail.xlsx'),
    sheet: 'PLZ94_Mail',
    plz:   '94',
    titel: 'Saisonabschluss 2026 — PLZ 94 (Heimatregion)',
  },
};

/* Die Auswahl muss vor dem Laden von saison-leads.js stehen: das Modul
   liest seine Einstellungen beim Einbinden aus der Umgebung. */
const KAMPAGNE = (() => {
  const i = process.argv.indexOf('--kampagne');
  const gewaehlt = (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1]
    : (process.env.SAISON_KAMPAGNE || 'plz83-85');
  if (!KAMPAGNEN[gewaehlt]) {
    console.error('Unbekannte Kampagne "' + gewaehlt + '". Bekannt: ' + Object.keys(KAMPAGNEN).join(', '));
    process.exit(1);
  }
  return gewaehlt;
})();
const KONFIG = KAMPAGNEN[KAMPAGNE];
process.env.SAISON_XLSX  = KONFIG.xlsx;
process.env.SAISON_SHEET = KONFIG.sheet;
process.env.SAISON_PLZ   = KONFIG.plz;

const nodemailer = require('nodemailer');
const L = require('./saison-leads');

const EMPFAENGER_JSON = path.join(STATE, KAMPAGNE + '-empfaenger.json');
const VERSAND_JSON    = path.join(STATE, KAMPAGNE + '-versand.json');
const SPERRLISTE      = path.join(__dirname, 'abmeldungen.txt');
const TEMPLATE        = path.join(__dirname, 'mail-template-saison.html');

/* ── Konfiguration ── */
const SMTP_HOST   = process.env.SMTP_HOST   || 'smtp.hostinger.com';
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';
const SMTP_USER   = process.env.SMTP_USER   || '';
const SMTP_PASS   = process.env.SMTP_PASS   || '';
const MAIL_FROM      = process.env.MAIL_FROM      || SMTP_USER;
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Kolibri Inspect';
const MAIL_REPLY_TO  = process.env.MAIL_REPLY_TO  || 'info@kolibri-inspect.de';
const ABMELDE_MAIL   = process.env.ABMELDE_MAIL   || MAIL_REPLY_TO;

const BASIS_URL       = process.env.CAMPAIGN_BASE_URL || 'https://www.kolibri-inspect.de/angebot.html';
const MUSTERBERICHT   = process.env.MUSTERBERICHT_URL || 'https://www.kolibri-inspect.de/musterbericht.pdf';
/* Die Thermogramme liegen in einer eigenen, auf Anzeigegröße gerechneten
   Fassung unter Bilder/mail/ — die Originale wiegen zusammen 538 kB und
   werden auf 76 px dargestellt. */
const BILD_BASIS      = process.env.BILD_BASIS_URL    || 'https://www.kolibri-inspect.de/Bilder/mail/';
const CAMPAIGN_REF    = process.env.CAMPAIGN_REF      || 'saison-mail-2026';

/* Zufälliger Abstand zwischen zwei Nachrichten. Ein fester Takt ist für
   jeden Filter das auffälligste Merkmal eines Massenversands. */
const PAUSE_MIN_S = parseInt(process.env.PAUSE_MIN_S || '30', 10);
const PAUSE_MAX_S = parseInt(process.env.PAUSE_MAX_S || '70', 10);

/* ── Warm-up-Rampe ──
   Menge je Versandtag. Gezählt werden Tage, an denen tatsächlich etwas
   rausging — fällt ein Tag aus, wird die Stufe nicht übersprungen.
   Ab dem letzten Eintrag bleibt die Menge konstant.

   Die Werte sind bewusst niedriger als jedes Providerlimit: nicht das
   Limit entscheidet über die Zustellung, sondern der Anstieg. Ein Postfach
   ohne Vorgeschichte, das an Tag 1 mit 20 Nachrichten beginnt und sich
   über zwei Wochen steigert, wird von den großen Empfängerseiten als
   normaler Geschäftsverkehr gelesen. */
const RAMPE = [20, 30, 45, 60, 80, 100, 120, 140, 150];

/* Werktags, in zwei Fenstern. Geschäftspost am Sonntagabend ist ein
   Massenversand-Signal; außerdem liest sie niemand. */
const VERSANDTAGE   = [1, 2, 3, 4, 5];          // Mo–Fr
const FENSTER = [{ von: '08:30', bis: '11:30' }, { von: '13:30', bis: '16:30' }];

/* ── CLI ── */
const argv = process.argv.slice(2);
const hat  = n => argv.includes('--' + n);
const wert = n => {
  const g = argv.find(a => a.startsWith('--' + n + '='));
  if (g) return g.slice(n.length + 3);
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const SEND        = hat('send');
const VORBEREITEN = hat('vorbereiten');
const PLAN        = hat('plan');
const PRUEFEN     = hat('pruefen');
const VORSCHAU    = wert('vorschau');
const TEST        = wert('test');
const NUR         = wert('nur');
const ANZAHL      = wert('anzahl') ? parseInt(wert('anzahl'), 10) : null;
const HEUTE_MODUS = hat('heute');
const OHNE_FENSTER = hat('ohne-fenster');
const TROTZDEM    = hat('trotzdem');

/* ── kleine Helfer ── */
const jetzt = () => new Date();
const iso = d => d.toISOString().slice(0, 10);
const schlaf = ms => new Promise(r => setTimeout(r, ms));
const zufall = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lesJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch { return fallback; }
}
function schreibJson(p, o) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2));
}

function log(rec) {
  fs.mkdirSync(LOGDIR, { recursive: true });
  const zeile = JSON.stringify(Object.assign({ ts: new Date().toISOString(), kampagne: KAMPAGNE }, rec));
  fs.appendFileSync(path.join(LOGDIR, KAMPAGNE + '-' + iso(jetzt()) + '.log'), zeile + '\n');
  console.log(zeile);
}

/* Sperrliste: eine Adresse je Zeile, alles nach # ist Kommentar. */
function ladeSperrliste() {
  if (!fs.existsSync(SPERRLISTE)) return new Set();
  return new Set(fs.readFileSync(SPERRLISTE, 'utf8')
    .split(/\r?\n/)
    .map(z => z.replace(/#.*$/, '').trim().toLowerCase())
    .filter(z => z.includes('@')));
}

/* ══════════════════════════════════════════════════════════════
   Betreffvarianten
   Je Lage drei Fassungen, die Auswahl kommt aus der Adresse. Damit ist der
   Betreff über den Verteiler gestreut, für denselben Empfänger aber immer
   derselbe — eine spätere Nachfassmail wiederholt so nicht denselben Satz.
   Kein Ausrufezeichen, keine Prozentzeichen, keine Versalien: die drei
   Merkmale, auf die jeder Filter zuerst schaut.
   ══════════════════════════════════════════════════════════════ */
/* Mobil zeigt die Trefferliste rund 45 Zeichen, Gmail am Rechner gut 70.
   Auf 45 kommt man mit einem deutschen Ortsnamen plus Monatsangabe nicht,
   ohne dass der Betreff kryptisch wird — und ein Kaltkontakt muss im
   Betreff sagen, worum es geht, sonst ist die Kürze wertlos. Der Kompromiss:
   Deckel bei 60, Median um 50, und „PV-Anlage" nur dort, wo der Rest der
   Zeile das Thema nicht schon trägt.

   Der Paragraf ist aus dem Betreff heraus. Er belegt gut, aber er liest
   sich im Posteingang wie Behördenpost. Im Text steht er weiterhin. */
const BETREFF_MAX = 60;

function betreff(e) {
  const ort = e.ort;
  const monat = e.gwEndeMonat;
  let liste;
  if (e.neuanlage) {
    liste = [
      'PV-Anlage ' + ort + ': Montagekontrolle',
      ort + ': Wurde die Modulmontage je geprüft?',
      'Neue PV-Anlage in ' + ort + ': Kontrolle in der Frist',
    ];
  } else if (e.gwMonateRest <= 0) {
    liste = [
      'PV-Anlage ' + ort + ': Thermografie zum Saisonende',
      ort + ': Befund für Versicherung und Wartung',
      'PV-Anlage ' + ort + ': Messsaison endet im Oktober',
    ];
  } else if (e.gwMonateRest <= 8) {
    liste = [
      'PV-Anlage ' + ort + ': Frist endet ' + monat,
      ort + ': Mängelhaftung endet ' + monat,
      'PV-Anlage ' + ort + ': letzte Messgelegenheit',
    ];
  } else {
    liste = [
      ort + ': Errichterfrist endet ' + monat,
      'PV-Anlage ' + ort + ': Befund vor Fristablauf',
      ort + ': Bestandsaufnahme vor ' + monat,
    ];
  }

  let h = 0;
  for (let i = 0; i < e.email.length; i++) h = ((h << 5) - h + e.email.charCodeAt(i)) | 0;
  const gewaehlt = liste[Math.abs(h) % liste.length];

  /* Sehr lange Ortsnamen sprengen auch die kürzeste Fassung. Dann greift
     die knappste Variante, statt den Satz mitten im Wort abzuschneiden. */
  if (gewaehlt.length <= BETREFF_MAX) return gewaehlt;
  const kurz = liste.slice().sort((a, b) => a.length - b.length)[0];
  return kurz.length <= BETREFF_MAX ? kurz : 'PV-Anlage ' + ort + ': Thermografie-Befund';
}

/* ══════════════════════════════════════════════════════════════
   Bausteine
   ══════════════════════════════════════════════════════════════ */

/* Der Link ins vorbefüllte Formular.
   Ohne die E-Mail-Adresse des Empfängers, und das aus drei Gründen: eine
   Adresse im Query-String steht anschließend im Zugriffsprotokoll des
   Webservers, sie wandert beim Weiterleiten der Mail mit, und ein langer
   Link mit eincodierter Adresse ist die Form, an der Filter Phishing
   erkennen. Die Seite springt ab fünf befüllten Feldern in den letzten
   Schritt — die verbleibenden sieben reichen dafür weiterhin. */
function ctaUrl(e) {
  const p = new URLSearchParams({
    company_name: e.firma || '',
    kwp: String(e.kwp),
    module_count: String(e.module),
    anlage_typ: /Freifläche/i.test(e.anlagenart) ? 'Freifläche' : 'Flachdach',
    Strasse_Hausnummer: e.strasse || '',
    Postleitzahl: e.plz,
    stadt: e.ort,
    promo: e.promo,
    ref: CAMPAIGN_REF,
  });
  return BASIS_URL + '?' + p.toString();
}

function abmeldeUrl(e) {
  return 'mailto:' + ABMELDE_MAIL
    + '?subject=' + encodeURIComponent('Abmelden')
    + '&body=' + encodeURIComponent(
        'Bitte löschen Sie ' + e.email + ' dauerhaft aus dem Verteiler.');
}

function kennzahl(label, wertText, farbe) {
  return '<td class="stapel kennzahl" width="20%" valign="top" style="font-family:\'Segoe UI\',Helvetica,Arial,sans-serif;">'
    + '<div style="font-size:8.5px; font-weight:700; letter-spacing:1px; color:#7A8886; text-transform:uppercase;">' + esc(label) + '</div>'
    + '<div style="font-size:14px; font-weight:700; color:' + (farbe || '#16211F') + '; padding-top:3px;">' + wertText + '</div>'
    + '</td>';
}

/* „September 2021" bricht in einer Fünftel-Spalte um und reißt die Zeile
   auseinander. Im Band steht deshalb die Kurzform; im Fließtext und in der
   Betreffzeile bleibt der Monat ausgeschrieben. */
function monatKurz(s) {
  const m = /^(\w{3})\w*\s+(\d{4})$/.exec(String(s || ''));
  return m ? m[1] + '.&nbsp;' + m[2] : esc(s || 'unbekannt');
}

/* Kennzahlenband wie im gedruckten Brief: fünf Werte zwischen zwei
   Haarlinien, keine gefüllte Fläche. Der Ertrag steht bewusst dabei — er
   macht die Eurobeträge weiter unten nachvollziehbar, statt sie einfach
   zu behaupten. */
function datenband(e) {
  const ertrag = Math.round(e.kwp * L.ERTRAG_KWH_PRO_KWP / 1000);
  return [
    kennzahl('Leistung', L.fmtKwp(e.kwp) + '&nbsp;kWp'),
    kennzahl('Module', L.fmtInt(e.module)),
    kennzahl('Am Netz seit', monatKurz(e.ibnMonatJahr)),
    kennzahl('Ertrag/Jahr', L.fmtInt(ertrag) + '&nbsp;MWh'),
    kennzahl(e.gwMonateRest > 0 ? 'Frist bis' : 'Frist endete',
      monatKurz(e.gwEndeMonat),
      e.gwMonateRest > 0 ? '#B5730C' : '#7A8886'),
  ].join('\n');
}

/* Fristbalken: Inbetriebnahme → heute → Messfenster → Fristende.
   Drei Segmente mit festen Prozentbreiten statt gesetzter Marker — in
   E-Mail-HTML ist alles, was absolut positioniert wird, eine Wette. */
function fristbalken(e, heute) {
  const ibn = e.ibnIso ? new Date(e.ibnIso) : null;
  const ende = e.gwEndeIso ? new Date(e.gwEndeIso) : null;
  const zelle = (breite, farbe) =>
    '<td width="' + breite + '%" style="width:' + breite + '%; height:10px; line-height:10px; font-size:0; background:' + farbe + ';">&nbsp;</td>';
  const legende = (l, m, r) =>
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:\'Segoe UI\',Helvetica,Arial,sans-serif; font-size:10.5px; color:#5C6B69;">'
    + '<tr><td align="left" style="padding-top:7px;">' + l + '</td>'
    + '<td align="center" style="padding-top:7px;">' + m + '</td>'
    + '<td align="right" style="padding-top:7px;">' + r + '</td></tr></table>';

  if (!ibn || !ende) return '';

  const spanne = ende - ibn;
  const pct = d => Math.max(0, Math.min(100, Math.round((d - ibn) / spanne * 100)));

  if (e.gwMonateRest <= 0) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:5px; overflow:hidden;">'
      + '<tr>' + zelle(100, '#D3E0DD') + '</tr></table>'
      + legende('Inbetriebnahme ' + esc(e.ibnMonatJahr),
                '<strong style="color:#5C6B69;">Frist abgelaufen</strong>',
                esc(e.gwEndeMonat));
  }

  const pHeute = pct(heute);
  const pSaison = Math.max(pHeute, pct(L.SAISON_ENDE));
  const restNachSaison = Math.max(0, 100 - pSaison);

  /* Wie im Brief: verstrichene Zeit grau, ein schmaler Marker für „heute",
     die verbleibende Frist in Amber. Der Balken zeigt damit, wie viel Zeit
     weg ist — nicht, wie viel Fläche die Marke belegt. */
  const marker = 3;
  const grau = Math.max(0, pHeute - marker);
  const balken = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr>'
    + zelle(grau, '#DDE5E3')
    + zelle(marker, '#167E74')
    + (restNachSaison > 0 ? zelle(pSaison - pHeute, '#E8C88A') : '')
    + zelle(Math.max(0, 100 - pHeute - (restNachSaison > 0 ? pSaison - pHeute : 0)), '#B5730C')
    + '</tr></table>';

  const mitte = restNachSaison > 0
    ? '<span style="color:#5C6B69;">messbar bis ' + L.SAISON_ENDE_KURZ + '</span>'
    : '';

  return balken + legende(
    'Inbetriebnahme ' + esc(e.ibnMonatJahr),
    mitte,
    '<strong style="color:#B5730C;">Frist endet ' + esc(e.gwEndeMonat) + '</strong>');
}

/* ── Titel und Untertitel ──
   Der Brief stellt oben die Tatsache hin, nicht einen Werbesatz: was gilt,
   für welche Anlage, bis wann. Das ist im Kaltkontakt auch das Wirksamste —
   der Empfänger erkennt in der ersten Zeile, dass es um seine Anlage geht
   und nicht um ein Angebot von der Stange. */
function titelZeile(e) {
  const ort = esc(e.ort);
  const kwp = L.fmtKwp(e.kwp);
  if (e.neuanlage) {
    return 'Montagefehler an Ihrer PV-Anlage in ' + ort + ' (' + kwp
      + ' kWp) zahlt bis ' + esc(e.gwEndeMonat) + ' noch Ihr Errichter';
  }
  if (e.gwMonateRest <= 0) {
    return 'Für Ihre PV-Anlage in ' + ort + ' (' + kwp
      + ' kWp) haftet seit ' + esc(e.gwEndeMonat) + ' niemand mehr außer Ihnen';
  }
  return 'Die Mängelhaftung Ihrer PV-Anlage in ' + ort + ' (' + kwp
    + ' kWp) endet im ' + esc(e.gwEndeMonat);
}

function untertitelZeile(e) {
  if (e.neuanlage) return 'Montage- und Anschlusskontrolle innerhalb der Haftungszeit';
  if (e.gwMonateRest <= 0) return 'Bestandsdokumentation für Versicherung und Wartung';
  return 'Befund vor Ablauf der Errichter-Mängelhaftung';
}

function absatzAufhaenger(e) {
  const p = t => '<p style="margin:0 0 15px 0;">' + t + '</p>';
  const zahl = t => '<strong style="color:#0E5A52;">' + t + '</strong>';
  const frist = '<strong style="color:#B5730C;">' + esc(e.gwEndeMonat) + '</strong>';

  if (e.neuanlage) {
    return p(esc(e.bauart) + ' in ' + esc(e.ort) + ' ist seit ' + zahl(esc(e.ibnMonatJahr))
      + ' am Netz. Was wir bei jungen Anlagen regelmäßig finden: nicht angeschlossene Strings, '
      + 'Transportschäden an Modulen, gequetschte Zellen unter zu fest angezogenen Klemmen. '
      + 'Der Zähler zeigt das nicht, er summiert nur — und bis ' + frist + ' gehen solche '
      + 'Fehler zulasten Ihres Errichters, nicht zu Ihren.');
  }
  if (e.gwMonateRest <= 0) {
    return p(esc(e.bauart) + ' in ' + esc(e.ort) + ' ist seit ' + zahl(esc(e.ibnMonatJahr))
      + ' am Netz. Die Mängelhaftung Ihres Errichters (§&nbsp;634a Abs.&nbsp;1 Nr.&nbsp;2 BGB, '
      + 'fünf Jahre ab Abnahme) ist im ' + esc(e.gwEndeMonat) + ' abgelaufen. Modulfehler '
      + 'gehen seither vollständig zu Ihren Lasten — und ein Befund, der schwarz auf weiß '
      + 'festhält, in welchem Zustand die Anlage ist, zählt jetzt gegenüber Versicherung, '
      + 'Wartungsfirma und einem späteren Käufer.');
  }
  return p(esc(e.bauart) + ' in ' + esc(e.ort) + ' ist seit ' + zahl(esc(e.ibnMonatJahr))
    + ' am Netz. Die Mängelhaftung Ihres Errichters (§&nbsp;634a Abs.&nbsp;1 Nr.&nbsp;2 BGB, '
    + 'fünf Jahre ab Abnahme) endet damit voraussichtlich im ' + frist
    + '. Bis dahin trägt er die Kosten für Modulfehler, die bei Übergabe angelegt waren. '
    + 'Danach Sie.');
}

/* Zweiter Absatz: was gemessen wird, und das Fazit aus dem Fristverlauf.
   Das Fazit stand vorher als fetter Einzeiler über dem Balken und las sich
   wie ein Werbeeinschub. Als Satz im Fließtext trägt es weiter. */
function absatzMessung(e) {
  const p = t => '<p style="margin:0 0 15px 0;">' + t + '</p>';
  let s = '';
  if (e.fazit) {
    s += p(e.fazitDringend
      ? '<strong>' + esc(e.fazit) + '</strong>'
      : esc(e.fazit));
  }
  s += p('Wir messen im laufenden Betrieb die Oberflächentemperatur jedes Moduls, '
    + 'georeferenziert, ohne Anlagenstillstand — ein Termin, rund zwei Stunden, kein Eingriff '
    + 'in Ihren Betrieb. ' + esc(e.spezifisch) + ' Was solche Befunde bei Ihrer Anlage kosten, '
    + 'wenn sie unentdeckt bleiben:');
  return s;
}

/* Das Angebot als Absatz statt als Kasten mit „Aktionscode".
   Ein Rabatt ohne Begründung sieht nach Verkaufstrick aus. Der Grund ist
   real und wird deshalb genannt: am Saisonende liegen die letzten Termine
   ohnehin beieinander. */
function absatzAngebot(e) {
  const gross = e.kwp >= L.SCHWELLE_GROSS;
  return '<p style="margin:0;">Zum Saisonende bündeln wir die verbleibenden Messtermine in '
    + 'einer Region und geben die gesparte Anfahrt weiter — bei Ihrer Anlagengröße '
    + (gross ? 'entfällt die Anfahrtspauschale damit ganz' : 'kostet die Anfahrt 95 statt 190 Euro')
    + '. Das gilt für Termine bis zum ' + esc(e.aktionBis) + ', danach schließt das Messfenster '
    + 'ohnehin bis März.</p>';
}

/* Die Nachschrift wird nach der Betreffzeile am häufigsten gelesen. Sie
   verkauft hier nichts, sondern verschenkt etwas: einen fachlichen Hinweis
   und eine Frage, die sich in einem Satz beantworten lässt. Das ist die
   niedrigste Hürde, die ein Kaltkontakt anbieten kann. */
function psZeile(e) {
  const kursiv = t => '<span style="color:#5C6B69;">' + t + '</span>';
  if (e.neuanlage) {
    return kursiv('P.S. — Hat Ihr Errichter die Anlage nach der Montage selbst thermografiert? '
      + 'Dann lassen Sie sich den Bericht geben. Fehlt er, ist das schon die halbe Antwort.');
  }
  if (e.gwMonateRest <= 0) {
    return kursiv('P.S. — Falls für Ihre Anlage schon einmal eine Thermografie gemacht wurde: '
      + 'schreiben Sie mir kurz, wann. Wenn der Befund noch trägt, sparen Sie sich den Termin.');
  }
  return kursiv('P.S. — Maßgeblich für die Frist ist die Abnahme, nicht die Inbetriebnahme im '
    + 'Register. Weicht Ihr Abnahmeprotokoll ab, verschiebt sich der ' + esc(e.gwEndeMonat)
    + ' entsprechend. Schreiben Sie mir das Datum, dann rechne ich Ihnen den richtigen Termin.');
}

/* Kennung des Befundes → Bilddatei.
   Die Zuordnung steht hier und nicht in den Empfängerdaten: dort würde ein
   Dateiname mitgespeichert und beim nächsten Wechsel von Format oder Pfad
   still veralten, bis jemand die Empfängerdatei neu baut. Genau das ist
   einmal passiert. */
const BEFUND_BILD = {
  zellfehler:    'Zellfehler.jpg',
  diode:         'Diodenfehler.jpg',
  string:        'Stringfehler.jpg',
  verschmutzung: 'Verschmutzung.jpg',
};

/* Beträge mit Minuszeichen, wie im Brief. „1.772 €" neben einem Fehlerbild
   liest sich einen Wimpernschlag lang wie ein Preis; „− 1.772 €" nicht. */
const minus = n => '−&nbsp;' + L.fmtEur(n);

function befundZeilen(e) {
  return e.befund.map(b =>
    '<tr><td style="padding:10px 0; border-bottom:1px solid #E4EBE9;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="befund-bild" width="72" valign="top" style="padding-right:14px;">'
    + '<img src="' + BILD_BASIS + (BEFUND_BILD[b.art] || '') + '" width="72" alt="Thermogramm ' + esc(b.name) + '" '
    + 'style="display:block; width:72px; height:auto; background:#EFF5F3;">'
    + '</td>'
    + '<td valign="top" style="font-family:\'Segoe UI\',Helvetica,Arial,sans-serif;">'
    + '<div style="font-size:13.5px; font-weight:700; color:#16211F;">' + esc(b.name) + '</div>'
    + '<div style="font-size:11px; line-height:16px; color:#7A8886; padding-top:2px;">' + esc(b.annahme) + '</div>'
    + '</td>'
    + '<td width="80" align="right" valign="top" style="font-family:\'Segoe UI\',Helvetica,Arial,sans-serif; font-size:13px; color:#16211F; white-space:nowrap;">'
    + minus(b.eur) + '</td>'
    + '<td width="104" align="right" valign="top" style="font-family:\'Segoe UI\',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#B5730C; white-space:nowrap;">'
    + (b.gesamt == null ? '—' : minus(b.gesamt)) + '</td>'
    + '</tr></table></td></tr>'
  ).join('\n');
}

function preisZeilen(e) {
  const p = e.preis;
  const z = (links, unten, listeText, aktionText, aktionFarbe) =>
    '<tr>'
    + '<td style="padding:10px 0; border-bottom:1px solid #E4EBE9; font-family:\'Segoe UI\',Helvetica,Arial,sans-serif; font-size:13px; color:#16211F;">'
    + links + (unten ? '<div style="font-size:11px; color:#7A8886; padding-top:2px;">' + unten + '</div>' : '')
    + '</td>'
    + '<td width="96" align="right" style="padding:10px 0; border-bottom:1px solid #E4EBE9; font-family:\'Segoe UI\',Helvetica,Arial,sans-serif; font-size:13px; color:#7A8886; white-space:nowrap;">' + listeText + '</td>'
    + '<td width="112" align="right" style="padding:10px 0; border-bottom:1px solid #E4EBE9; font-family:\'Segoe UI\',Helvetica,Arial,sans-serif; font-size:13px; font-weight:700; color:' + (aktionFarbe || '#16211F') + '; white-space:nowrap;">' + aktionText + '</td>'
    + '</tr>';

  const anfahrtUnten = e.kwp >= L.SCHWELLE_GROSS
    ? 'entfällt ab 500 kWp'
    : 'gebündelte Anfahrt zum Saisonende';

  const zeilen = [
    z('Anfahrtspauschale', anfahrtUnten, L.fmtEur2(L.PAUSCHALE_LISTE),
      p.pauschale === 0 ? 'entfällt' : L.fmtEur2(p.pauschale), '#167E74'),
    z('Thermografie-Inspektion',
      L.fmtInt(e.module) + ' Module à ' + L.fmtEur2(p.ratePerModul),
      L.fmtEur2(p.preisModule), L.fmtEur2(p.preisModule)),
    z('Befundbericht mit Thermogrammen', 'Handlungsempfehlung je Befund', 'inklusive', 'inklusive'),
  ];
  if (p.zuschlagAktion > 0) {
    zeilen.push(z('Anfahrt über ' + L.FREIKILOMETER + ' km', e.distanzKm + ' km einfache Strecke',
      L.fmtEur2(p.zuschlagAktion), L.fmtEur2(p.zuschlagAktion)));
  }
  return zeilen.join('\n');
}

function befundBasis(e) {
  const art = e.stromwert >= 0.2 ? 'Eigenverbrauch' : 'Volleinspeisung';
  return 'Beispielrechnung mit branchenüblichen Häufigkeiten, bewertet mit '
    + String(e.stromwert).replace('.', ',') + ' €/kWh (' + art + ')'
    + (e.restJahre != null ? ' über ' + e.restJahre + ' Jahre Restlaufzeit der Einspeisung' : '')
    + '. Ob diese Befunde bei Ihnen vorliegen, zeigt erst die Messung — die Inspektion Ihrer Anlage '
    + 'kostet einmalig ' + L.fmtEur2(e.preis.nettoAktion) + ' netto.';
}

function fussnoten(e) {
  return 'Rechenannahmen: ' + L.ERTRAG_KWH_PRO_KWP + ' kWh je kWp und Jahr (konservativ für Süd&shy;bayern); '
    + 'Strom&shy;wert ' + String(L.STROMWERT_VOLL_EUR_KWH).replace('.', ',') + ' €/kWh bei Volleinspeisung, '
    + String(L.STROMWERT_TEIL_EUR_KWH).replace('.', ',') + ' €/kWh bei Teileinspeisung; '
    + L.EINSPEISUNG_JAHRE + ' Jahre EEG-Einspeisedauer ab Inbetriebnahme; Anomaliequote '
    + '2,8 % der Module aus unserem Musterbericht. Die Verlustanteile gelten je betroffenem Modul '
    + 'und werden über Häufigkeit mal Einzelverlust auf die Anlage gerechnet. '
    + 'Die Beträge sind eine Beispielrechnung für den Fall, dass ein Befund vorliegt — keine Prognose '
    + 'für Ihre Anlage. Anlagendaten (Leistung, Module, Inbetriebnahme, Standort) stammen aus dem '
    + 'öffentlichen Marktstammdatenregister der Bundesnetzagentur; maßgeblich für die Frist nach '
    + '§ 634a BGB ist die Abnahme, die davon abweichen kann — bitte anhand Ihres Abnahmeprotokolls prüfen. '
    + 'Preise netto zzgl. USt. Das Messfenster folgt DIN EN IEC 62446-3 (mindestens 600 W/m² Einstrahlung).';
}

/* ── Textfassung ──
   Kein Abfallprodukt: Manche Empfänger sehen nur diesen Teil, und ein
   fehlender oder lieblos gefüllter Textteil ist für sich schon ein
   Spammerkmal. Sie folgt derselben Dramaturgie wie die HTML-Fassung —
   Tatsache, Frist, Befunde, Preis, Nachschrift. */
function textFassung(e, v) {
  const linie = '--------------------------------------------------------';
  const z = [];
  z.push('KOLIBRI INSPECT');
  z.push('Drohnen-Thermografie für Photovoltaik, normgerecht nach DIN EN IEC 62446-3');
  z.push('');
  z.push('Salzweg, ' + v.datum);
  z.push('');
  z.push(titelZeile(e).replace(/&nbsp;/g, ' '));
  z.push(untertitelZeile(e));
  z.push('');
  z.push(e.anrede + ',');
  z.push('');

  if (e.neuanlage) {
    z.push(e.bauart + ' in ' + e.ort + ' ist seit ' + e.ibnMonatJahr + ' am Netz. Was wir bei',
      'jungen Anlagen regelmäßig finden: nicht angeschlossene Strings,',
      'Transportschäden an Modulen, gequetschte Zellen unter zu fest',
      'angezogenen Klemmen. Der Zähler zeigt das nicht, er summiert nur —',
      'und bis ' + e.gwEndeMonat + ' gehen solche Fehler zulasten Ihres',
      'Errichters, nicht zu Ihren.');
  } else if (e.gwMonateRest <= 0) {
    z.push(e.bauart + ' in ' + e.ort + ' ist seit ' + e.ibnMonatJahr + ' am Netz. Die',
      'Mängelhaftung Ihres Errichters (§ 634a Abs. 1 Nr. 2 BGB, fünf Jahre ab',
      'Abnahme) ist im ' + e.gwEndeMonat + ' abgelaufen. Modulfehler gehen seither',
      'vollständig zu Ihren Lasten — und ein Befund, der schwarz auf weiß',
      'festhält, in welchem Zustand die Anlage ist, zählt jetzt gegenüber',
      'Versicherung, Wartungsfirma und einem späteren Käufer.');
  } else {
    z.push(e.bauart + ' in ' + e.ort + ' ist seit ' + e.ibnMonatJahr + ' am Netz. Die',
      'Mängelhaftung Ihres Errichters (§ 634a Abs. 1 Nr. 2 BGB, fünf Jahre ab',
      'Abnahme) endet damit voraussichtlich im ' + e.gwEndeMonat + '. Bis dahin trägt',
      'er die Kosten für Modulfehler, die bei Übergabe angelegt waren. Danach Sie.');
  }

  const ertrag = Math.round(e.kwp * L.ERTRAG_KWH_PRO_KWP / 1000);
  z.push('', linie,
    'Leistung ' + L.fmtKwp(e.kwp) + ' kWp | Module ' + L.fmtInt(e.module)
      + ' | am Netz seit ' + e.ibnMonatJahr,
    'Ertrag rund ' + L.fmtInt(ertrag) + ' MWh/Jahr | Frist '
      + (e.gwMonateRest > 0 ? 'bis ' : 'endete ') + e.gwEndeMonat,
    linie, '');

  if (e.fazit) z.push(e.fazit, '');
  z.push('Wir messen im laufenden Betrieb die Oberflächentemperatur jedes Moduls,',
    'georeferenziert, ohne Anlagenstillstand — ein Termin, rund zwei Stunden,',
    'kein Eingriff in Ihren Betrieb. ' + e.spezifisch,
    '',
    'Was solche Befunde bei Ihrer Anlage kosten, wenn sie unentdeckt bleiben:',
    '');

  for (const b of e.befund) {
    z.push('  ' + b.name,
      '  ' + b.annahme,
      '  − ' + L.fmtEur(b.eur) + ' je Jahr'
        + (b.gesamt == null ? '' : '   − ' + L.fmtEur(b.gesamt) + ' über ' + e.restJahre + ' Jahre'),
      '');
  }
  z.push('  Treten diese Befunde gemeinsam auf:',
    '  − ' + L.fmtEur(e.befundSummeEur) + ' je Jahr'
      + (e.befundSummeGesamt == null ? '' : '   − ' + L.fmtEur(e.befundSummeGesamt) + ' über die Restlaufzeit'),
    '',
    'Beispielrechnung mit branchenüblichen Häufigkeiten. Ob diese Befunde bei',
    'Ihnen vorliegen, zeigt erst die Messung.',
    '');

  const gross = e.kwp >= L.SCHWELLE_GROSS;
  z.push('Zum Saisonende bündeln wir die verbleibenden Messtermine in einer Region',
    'und geben die gesparte Anfahrt weiter — bei Ihrer Anlagengröße '
      + (gross ? 'entfällt die' : 'kostet die'),
    gross ? 'Anfahrtspauschale damit ganz. Das gilt für Termine bis zum ' + e.aktionBis + ','
          : 'Anfahrt 95 statt 190 Euro. Das gilt für Termine bis zum ' + e.aktionBis + ',',
    'danach schließt das Messfenster ohnehin bis März.',
    '', linie,
    '  Anfahrtspauschale        Liste ' + L.fmtEur2(L.PAUSCHALE_LISTE)
      + '   jetzt ' + (e.preis.pauschale === 0 ? 'entfällt' : L.fmtEur2(e.preis.pauschale)),
    '  Thermografie ' + L.fmtInt(e.module) + ' Module à ' + L.fmtEur2(e.preis.ratePerModul)
      + ' = ' + L.fmtEur2(e.preis.preisModule),
    '  Befundbericht mit Thermogrammen und Handlungsempfehlung: inklusive');
  if (e.preis.zuschlagAktion > 0) {
    z.push('  Anfahrt über ' + L.FREIKILOMETER + ' km: ' + L.fmtEur2(e.preis.zuschlagAktion));
  }
  z.push('  GESAMT NETTO ' + L.fmtEur2(e.preis.nettoAktion)
      + ' statt ' + L.fmtEur2(e.preis.nettoListe) + ', zzgl. MwSt.',
    linie, '',
    'Preis und Termin ansehen — Ihre Anlagendaten sind im Formular schon',
    'eingetragen, Sie sehen den Preis, bevor Sie etwas bestätigen, und können',
    'dort auch nur einen Termin anfragen:',
    v.cta_url,
    '',
    'Mit freundlichen Grüßen',
    'Dipl.-Ing. Friedrich Plöchinger',
    'Kolibri Inspect · TGA Plöchinger GmbH',
    '+49 179 1599311 · info@kolibri-inspect.de',
    '');

  if (e.neuanlage) {
    z.push('P.S. — Hat Ihr Errichter die Anlage nach der Montage selbst thermografiert?',
      'Dann lassen Sie sich den Bericht geben. Fehlt er, ist das schon die halbe',
      'Antwort.');
  } else if (e.gwMonateRest <= 0) {
    z.push('P.S. — Falls für Ihre Anlage schon einmal eine Thermografie gemacht wurde:',
      'schreiben Sie mir kurz, wann. Wenn der Befund noch trägt, sparen Sie sich',
      'den Termin.');
  } else {
    z.push('P.S. — Maßgeblich für die Frist ist die Abnahme, nicht die Inbetriebnahme',
      'im Register. Weicht Ihr Abnahmeprotokoll ab, verschiebt sich der',
      e.gwEndeMonat + ' entsprechend. Schreiben Sie mir das Datum, dann rechne ich',
      'Ihnen den richtigen Termin.');
  }

  z.push('', linie,
    'TGA Plöchinger GmbH · Passauer Str. 20 · 94121 Salzweg',
    'Geschäftsführer Friedrich Plöchinger · USt-IdNr. DE 322 015 971',
    'Impressum: https://www.kolibri-inspect.de/impressum.html',
    'Datenschutz: https://www.kolibri-inspect.de/datenschutz.html',
    '',
    'Ihre Anlagendaten stammen aus dem öffentlichen Marktstammdatenregister der',
    'Bundesnetzagentur. Keine Weitergabe Ihrer Daten, keine Zählpixel.',
    'Keine weiteren Nachrichten: antworten Sie mit „Abmelden", dann löschen wir',
    'Ihre Adresse dauerhaft.');

  return z.join('\n');
}

function baueMail(e, heute) {
  const v = {
    subject: betreff(e),
    cta_url: ctaUrl(e),
  };
  v.preheader = 'Vier typische Befunde, auf Ihre ' + L.fmtInt(e.module) + ' Module gerechnet: '
    + L.fmtEur(e.befundSummeEur) + ' Ertragsverlust je Jahr.';
  v.titel = titelZeile(e);
  v.untertitel = esc(untertitelZeile(e));
  v.datum = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(heute);
  v.ort = esc(e.ort);
  v.anrede = esc(e.anrede);
  v.logo_url = BILD_BASIS + 'symbol.png';
  v.datenband = datenband(e);
  v.absatz_aufhaenger = absatzAufhaenger(e);
  v.fristbalken = fristbalken(e, heute);
  v.absatz_messung = absatzMessung(e);
  v.befund_zeilen = befundZeilen(e);
  v.befund_kopf_rest = e.restJahre != null ? 'ÜBER ' + e.restJahre + ' JAHRE' : 'ÜBER DIE LAUFZEIT';
  v.befund_summe_jahr = minus(e.befundSummeEur);
  v.befund_summe_gesamt = e.befundSummeGesamt == null ? '—' : minus(e.befundSummeGesamt);
  v.befund_basis = esc(befundBasis(e));
  v.absatz_angebot = absatzAngebot(e);
  v.preis_zeilen = preisZeilen(e);
  v.preis_liste = L.fmtEur2(e.preis.nettoListe);
  v.preis_aktion = L.fmtEur2(e.preis.nettoAktion);
  v.ps = psZeile(e);
  v.abmelden_url = abmeldeUrl(e);

  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  const html = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] != null ? String(v[k]) : '');
  const text = textFassung(e, v);

  const offen = html.match(/\{\{\w+\}\}/g);
  if (offen) throw new Error('Unbefüllte Platzhalter: ' + [...new Set(offen)].join(', '));

  return { subject: v.subject, html, text, cta: v.cta_url };
}

/* ══════════════════════════════════════════════════════════════
   Tagesportion
   ══════════════════════════════════════════════════════════════ */
function ladeVersand() {
  return lesJson(VERSAND_JSON, { gesendet: {}, tage: [] });
}

/* ── Die Rampe gehört der Absenderadresse, nicht der Kampagne ──
   Reputation wird pro Postfach gemessen. Zählte jede Kampagne für sich,
   hätte das zwei Folgen, beide falsch: zwei Läufe am selben Tag würden das
   Tagesvolumen verdoppeln, und eine zweite Kampagne nach elf Tagen
   eingespieltem Versand müsste ohne Grund wieder bei 20 anfangen.

   Deshalb werden alle Versandprotokolle im Zustandsverzeichnis
   zusammengezählt. */
function alleTage() {
  const summe = new Map();
  let dateien = [];
  try { dateien = fs.readdirSync(STATE).filter(f => f.endsWith('-versand.json')); } catch { /* noch nichts da */ }
  for (const f of dateien) {
    const v = lesJson(path.join(STATE, f), { tage: [] });
    for (const t of (v.tage || [])) summe.set(t.datum, (summe.get(t.datum) || 0) + t.anzahl);
  }
  return summe;
}

function tagesMenge(_versand, datum) {
  const tage = alleTage();
  const bisher = [...tage.entries()].filter(([d, n]) => d !== datum && n > 0).length;
  return RAMPE[Math.min(bisher, RAMPE.length - 1)];
}

function schonHeute(_versand, datum) {
  return alleTage().get(datum) || 0;
}

function imFenster(d) {
  if (!VERSANDTAGE.includes(d.getDay())) return false;
  const min = d.getHours() * 60 + d.getMinutes();
  return FENSTER.some(f => {
    const [vh, vm] = f.von.split(':').map(Number);
    const [bh, bm] = f.bis.split(':').map(Number);
    return min >= vh * 60 + vm && min <= bh * 60 + bm;
  });
}

function naechstesFenster(d) {
  const p = new Date(d);
  for (let i = 0; i < 14 * 24 * 60; i++) {
    p.setMinutes(p.getMinutes() + 1);
    if (imFenster(p)) return p;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════
   Vorabprüfung
   ══════════════════════════════════════════════════════════════ */
/* DNS-Abfrage mit Ausweichauflöser.
   Der Systemauflöser ist nicht überall erreichbar (VPN, lokaler Stub, ein
   Container ohne Netz). Ein nicht erreichbarer Auflöser darf nicht als
   „Eintrag fehlt" durchgehen — das würde den Versand mit einer Falschmeldung
   blockieren. Deshalb liefern die Helfer drei Zustände: gefunden, sicher
   nicht vorhanden (NXDOMAIN/ENODATA) und nicht prüfbar. */
const AUSWEICH_DNS = ['1.1.1.1', '8.8.8.8'];

async function frage(art, name) {
  const methode = art === 'TXT' ? 'resolveTxt' : 'resolveCname';
  const auswerten = r => art === 'TXT' ? r.map(a => a.join('')) : r;
  const versuche = [dns];
  for (const server of AUSWEICH_DNS) {
    const r = new (require('dns').promises.Resolver)();
    r.setServers([server]);
    versuche.push(r);
  }
  let unerreichbar = false;
  for (const auf of versuche) {
    try { return { werte: auswerten(await auf[methode](name)), pruefbar: true }; }
    catch (e) {
      if (e.code === 'ENOTFOUND' || e.code === 'ENODATA' || e.code === 'NXDOMAIN') {
        return { werte: [], pruefbar: true };
      }
      unerreichbar = true;
    }
  }
  return { werte: [], pruefbar: !unerreichbar };
}

const txt   = name => frage('TXT', name);
const cname = name => frage('CNAME', name);
async function status(url) {
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'KolibriInspect-Preflight/1.0' } });
    return { code: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) { return { code: 0, text: '', fehler: e.message }; }
}

async function pruefen() {
  const befunde = [];
  const ok   = (n, d) => befunde.push({ n, s: 'ok', d });
  const warn = (n, d) => befunde.push({ n, s: 'warnung', d });
  const bad  = (n, d) => befunde.push({ n, s: 'FEHLER', d });

  // 1 Zugangsdaten
  if (SMTP_USER && SMTP_PASS) ok('SMTP-Zugang', SMTP_USER + ' auf ' + SMTP_HOST + ':' + SMTP_PORT);
  else bad('SMTP-Zugang', 'SMTP_USER oder SMTP_PASS fehlen in kampagne/.env');

  // 2 Verbindung
  if (SMTP_USER && SMTP_PASS) {
    const t = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    try { await t.verify(); ok('SMTP-Anmeldung', 'Postfach nimmt Nachrichten an'); }
    catch (e) { bad('SMTP-Anmeldung', e.message); }
    t.close();
  }

  // 3 Absenderdomain
  const domain = (MAIL_FROM.split('@')[1] || '').toLowerCase();
  const spfA = await txt(domain);
  const spf = spfA.werte.filter(s => /^v=spf1/i.test(s));
  if (spf.length) ok('SPF', spf[0]);
  else if (!spfA.pruefbar) warn('SPF', 'kein DNS-Auflöser erreichbar — von Hand prüfen');
  else bad('SPF', 'kein SPF-Eintrag für ' + domain);

  const dmA = await txt('_dmarc.' + domain);
  const dmarc = dmA.werte.filter(s => /^v=DMARC1/i.test(s));
  if (!dmarc.length && !dmA.pruefbar) warn('DMARC', 'kein DNS-Auflöser erreichbar — von Hand prüfen');
  else if (!dmarc.length) bad('DMARC', 'kein _dmarc-Eintrag');
  else if (/p=none/i.test(dmarc[0]) && !/rua=/i.test(dmarc[0]))
    warn('DMARC', dmarc[0] + '  → ohne rua= keine Berichte über Zustellprobleme');
  else ok('DMARC', dmarc[0]);

  let dkim = null;
  let dkimPruefbar = true;
  for (const sel of ['hostingermail1', 'hostingermail2', 'hostingermail3', 'default', 'mail']) {
    const c = await cname(sel + '._domainkey.' + domain);
    const t = await txt(sel + '._domainkey.' + domain);
    if (!c.pruefbar || !t.pruefbar) dkimPruefbar = false;
    if (c.werte.length || t.werte.length) {
      dkim = sel + '._domainkey → ' + (c.werte[0] || 'TXT gesetzt');
      break;
    }
  }
  if (dkim) ok('DKIM', dkim);
  else if (!dkimPruefbar) warn('DKIM', 'kein DNS-Auflöser erreichbar — von Hand prüfen');
  else bad('DKIM', 'kein Schlüssel gefunden. Ohne DKIM stuft Google unbekannte Absender '
    + 'deutlich strenger ein — in hPanel unter E-Mails → DNS-Einstellungen aktivieren');

  // 4 Ziele der Links
  const angebot = await status(BASIS_URL);
  if (angebot.code !== 200) bad('angebot.html', 'HTTP ' + angebot.code);
  else if (!angebot.text.includes(L.PROMO_CODE))
    bad('Aktionscode', L.PROMO_CODE + ' steht nicht in der ausgelieferten angebot.html — '
      + 'erst api/promo-codes.js und angebot.html deployen, sonst rechnet das Formular den Listenpreis');
  else ok('Aktionscode', L.PROMO_CODE + ' ist auf der Seite hinterlegt');

  const mb = await status(MUSTERBERICHT);
  mb.code === 200 ? ok('Musterbericht', 'erreichbar') : bad('Musterbericht', 'HTTP ' + mb.code);

  for (const b of ['Zellfehler.jpg', 'Diodenfehler.jpg', 'Stringfehler.jpg', 'Verschmutzung.jpg']) {
    const r = await status(BILD_BASIS + encodeURIComponent(b));
    if (r.code !== 200) bad('Bild ' + b, 'HTTP ' + r.code);
  }
  if (!befunde.some(b => b.n.startsWith('Bild '))) ok('Thermogramme', 'alle vier erreichbar');

  // 5 Empfängerdatei
  const empf = lesJson(EMPFAENGER_JSON, null);
  empf ? ok('Empfängerdatei', empf.length + ' Empfänger vorbereitet')
       : bad('Empfängerdatei', 'fehlt — zuerst --vorbereiten');

  const sperr = ladeSperrliste();
  ok('Sperrliste', sperr.size + ' Adressen');

  console.log('\n  Vorabprüfung — ' + KONFIG.titel + '\n');
  for (const b of befunde) {
    const m = b.s === 'ok' ? '  ok     ' : b.s === 'warnung' ? '  achtung' : '  FEHLER ';
    console.log(m + '  ' + b.n.padEnd(18) + b.d);
  }
  const fehler = befunde.filter(b => b.s === 'FEHLER').length;
  console.log('\n  ' + (fehler ? fehler + ' Punkt(e) blockieren den Versand.' : 'Alles bereit.') + '\n');
  return fehler === 0;
}

/* ══════════════════════════════════════════════════════════════
   Abläufe
   ══════════════════════════════════════════════════════════════ */
async function vorbereiten() {
  console.log('Empfänger aufbereiten …');
  const empf = await L.baueEmpfaenger({ heute: jetzt(), geocode: true, log: console.log });
  const sperr = ladeSperrliste();
  const gefiltert = empf.filter(e => !sperr.has(e.email));
  if (empf.length !== gefiltert.length) {
    console.log(empf.length - gefiltert.length + ' Adressen aus der Sperrliste entfernt');
  }
  schreibJson(EMPFAENGER_JSON, gefiltert);
  if (!fs.existsSync(SPERRLISTE)) {
    fs.writeFileSync(SPERRLISTE,
      '# Abmeldungen und Bounces. Eine Adresse je Zeile.\n'
      + '# Wird vor jedem Lauf gelesen; Eintraege gehen nie wieder raus.\n');
  }

  const lauf = gefiltert.filter(e => e.gwMonateRest > 0).length;
  const frei = gefiltert.filter(e => L.istFreemail(e.email)).length;
  console.log('\n  ' + gefiltert.length + ' Empfänger in ' + EMPFAENGER_JSON);
  console.log('  Mängelhaftung läuft noch: ' + lauf + ' · abgelaufen: ' + (gefiltert.length - lauf)
    + ' · Neuanlagen: ' + gefiltert.filter(e => e.neuanlage).length);
  console.log('  Freemail-Postfächer: ' + frei + ' — stehen am Ende der Reihenfolge');
  console.log('  Reihenfolge: Geschäftsadressen vor Freemail, darin knappste Frist zuerst,\n'
    + '  danach die größten Anlagen.\n');
}

function planAusgeben() {
  const empf = lesJson(EMPFAENGER_JSON, []);
  const versand = ladeVersand();
  const gesendet = Object.keys(versand.gesendet).length;
  const offen = empf.length - gesendet;

  console.log('\n  Versandplan — ' + KONFIG.titel + '\n');
  console.log('  Empfänger gesamt   ' + empf.length);
  console.log('  bereits versandt   ' + gesendet);
  console.log('  offen              ' + offen);
  console.log('  Absender           ' + MAIL_FROM);
  console.log('  Fenster            Mo–Fr ' + FENSTER.map(f => f.von + '–' + f.bis).join(' und '));
  console.log('  Abstand            ' + PAUSE_MIN_S + '–' + PAUSE_MAX_S + ' s, zufällig\n');

  let rest = offen;
  let tagIndex = [...alleTage().values()].filter(n => n > 0).length;
  const d = new Date();
  const zeilen = [];
  while (rest > 0 && zeilen.length < 40) {
    d.setDate(d.getDate() + (zeilen.length === 0 && imFenster(new Date()) ? 0 : 1));
    if (!VERSANDTAGE.includes(d.getDay())) continue;
    const menge = Math.min(RAMPE[Math.min(tagIndex, RAMPE.length - 1)], rest);
    rest -= menge;
    tagIndex++;
    zeilen.push({ datum: iso(d), menge, rest });
  }
  console.log('  Tag          Menge   danach offen');
  for (const z of zeilen) {
    console.log('  ' + z.datum + '   ' + String(z.menge).padStart(4) + '   ' + String(z.rest).padStart(12));
  }
  console.log('\n  Letzte Mail voraussichtlich am ' + (zeilen.length ? zeilen[zeilen.length - 1].datum : '—')
    + ' — Messfenster schließt am 31.10.2026.\n');
}

async function vorschau(index) {
  const empf = lesJson(EMPFAENGER_JSON, []);
  const e = empf[index];
  if (!e) { console.error('Kein Empfänger an Position ' + index + ' (0–' + (empf.length - 1) + ')'); process.exit(1); }
  const m = baueMail(e, jetzt());
  const ziel = path.join(STATE, 'vorschau-' + index + '.html');
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(ziel, m.html);
  console.log('Empfänger #' + index + ': ' + e.firma + ' · ' + e.ort + ' · ' + L.fmtKwp(e.kwp)
    + ' kWp · ' + L.fmtInt(e.module) + ' Module · Frist ' + (e.gwEndeMonat || '—')
    + ' (' + e.gwMonateRest + ' Monate)');
  console.log('Betreff: ' + m.subject);
  console.log('HTML:    ' + ziel);
  console.log('CTA:     ' + m.cta);
  console.log('\n──── Textfassung ────\n' + m.text);
}

/* Testnachricht an eine eigene Adresse.
   Bewusst getrennt vom regulären Lauf: „einfach den ersten Empfänger
   nehmen" wäre kein Test, sondern die erste echte Kaltmail — und zwar an
   den Betreiber mit der knappsten Frist, also den wertvollsten Kontakt.
   Der Testlauf nimmt dessen Daten als Inhalt, verschickt aber an die
   angegebene Adresse und schreibt nichts ins Versandprotokoll. */
async function testmail(ziel, index) {
  const empf = lesJson(EMPFAENGER_JSON, null);
  if (!empf) { console.error('Empfängerdatei fehlt — zuerst --vorbereiten'); process.exit(1); }
  const e = empf[index] || empf[0];
  if (!SMTP_USER || !SMTP_PASS) { console.error('SMTP_USER/SMTP_PASS fehlen in kampagne/.env'); process.exit(1); }

  const m = baueMail(e, jetzt());
  const t = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await t.verify();
  await t.sendMail({
    from: '"' + MAIL_FROM_NAME + '" <' + MAIL_FROM + '>',
    to: ziel,
    replyTo: MAIL_REPLY_TO,
    subject: '[TEST] ' + m.subject,
    html: m.html,
    text: m.text,
    headers: {
      'List-Unsubscribe': '<mailto:' + ABMELDE_MAIL + '?subject=Abmelden>',
      'X-Campaign': CAMPAIGN_REF + '-test',
    },
  });
  t.close();
  console.log('Testnachricht an ' + ziel + ' verschickt.');
  console.log('Inhalt: Datensatz #' + (empf[index] ? index : 0) + ' (' + e.ort + ', '
    + L.fmtKwp(e.kwp) + ' kWp, Frist ' + (e.gwEndeMonat || '—') + ')');
  console.log('Nicht ins Versandprotokoll eingetragen — der echte Lauf ist davon unberührt.');
  console.log('\nJetzt prüfen: Darstellung mit und ohne Bilder, Abmeldelink, und unter');
  console.log('„Original anzeigen" müssen SPF, DKIM und DMARC auf PASS stehen.');
}

async function versenden() {
  const heute = jetzt();
  const datum = iso(heute);
  const empf = lesJson(EMPFAENGER_JSON, null);
  if (!empf) { console.error('Empfängerdatei fehlt — zuerst: node send-saison.js --vorbereiten'); process.exit(1); }

  const versand = ladeVersand();
  const sperr = ladeSperrliste();

  let offen = empf.filter(e => !versand.gesendet[e.email] && !sperr.has(e.email));
  if (NUR) offen = offen.filter(e => e.email === NUR.toLowerCase());

  let menge;
  if (NUR) menge = offen.length;
  else if (ANZAHL) menge = ANZAHL;
  else {
    const soll = tagesMenge(versand, datum);
    menge = Math.max(0, soll - schonHeute(versand, datum));
    if (!HEUTE_MODUS && !SEND) menge = Math.min(menge, offen.length);
  }
  const portion = offen.slice(0, menge);

  console.log('[' + (SEND ? 'LIVE' : 'TROCKENLAUF') + '] ' + KONFIG.titel + ' — ' + datum);
  console.log('offen: ' + offen.length + ' · heute vorgesehen: ' + menge
    + ' · bereits heute raus: ' + schonHeute(versand, datum));
  if (!portion.length) { console.log('Nichts zu tun.'); return; }

  if (SEND && !NUR) {
    const bereit = await pruefen();
    if (!bereit && !TROTZDEM) {
      console.error('Vorabprüfung nicht bestanden. Beheben oder --trotzdem setzen.');
      process.exit(1);
    }
  }

  let transporter = null;
  if (SEND) {
    if (!SMTP_USER || !SMTP_PASS) { console.error('SMTP_USER/SMTP_PASS fehlen in kampagne/.env'); process.exit(1); }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true, maxConnections: 1, maxMessages: 50,
      /* Ohne diese Angabe meldet sich der Client beim EHLO mit dem
         Rechnernamen des Arbeitsplatzes — kein gültiger Domainname. Bis zum
         Empfänger dringt das nicht durch, weil Hostinger weiterleitet, aber
         der Einlieferungsserver sieht es. */
      name: (MAIL_FROM.split('@')[1] || 'kolibri-inspect.de'),
    });
    await transporter.verify();
  }

  let raus = 0, fehler = 0;
  for (const e of portion) {
    // Sendefenster einhalten, außer bei Einzeltest oder ausdrücklichem Wunsch
    if (SEND && !NUR && !OHNE_FENSTER && !imFenster(new Date())) {
      const n = naechstesFenster(new Date());
      console.log('Außerhalb des Sendefensters. Pause bis ' + (n ? n.toLocaleString('de-DE') : '?'));
      if (!n) break;
      await schlaf(Math.min(n - new Date(), 3 * 60 * 60 * 1000));
      if (!imFenster(new Date())) break;
    }

    try {
      const m = baueMail(e, heute);
      if (!SEND) {
        log({ status: 'trockenlauf', email: e.email, firma: e.firma, ort: e.ort,
              kwp: e.kwp, gw_monate: e.gwMonateRest, betreff: m.subject,
              netto: e.preis.nettoAktion });
      } else {
        await transporter.sendMail({
          from: '"' + MAIL_FROM_NAME + '" <' + MAIL_FROM + '>',
          to: e.email,
          replyTo: MAIL_REPLY_TO,
          subject: m.subject,
          html: m.html,
          text: m.text,
          headers: {
            'List-Unsubscribe': '<mailto:' + ABMELDE_MAIL + '?subject=Abmelden>',
            'X-Campaign': CAMPAIGN_REF,
          },
        });
        versand.gesendet[e.email] = { ts: new Date().toISOString(), datum, betreff: m.subject };
        const t = versand.tage.find(x => x.datum === datum);
        t ? t.anzahl++ : versand.tage.push({ datum, anzahl: 1 });
        schreibJson(VERSAND_JSON, versand);
        log({ status: 'versandt', email: e.email, firma: e.firma, ort: e.ort,
              kwp: e.kwp, gw_monate: e.gwMonateRest, betreff: m.subject });
      }
      raus++;
    } catch (err) {
      fehler++;
      log({ status: 'fehler', email: e.email, firma: e.firma, fehler: err.message });
      /* Weist das Postfach die Nachricht dauerhaft zurück, ist weitermachen
         das Schlechteste, was man tun kann — jeder weitere Versuch
         verschlechtert die Reputation. */
      if (/5\.7\.|rate|limit|quota|blocked|spam/i.test(err.message)) {
        console.error('Abbruch: der Server meldet eine Sperre oder ein Limit. Lauf später fortsetzen.');
        break;
      }
    }

    if (portion.indexOf(e) < portion.length - 1) {
      const p = zufall(PAUSE_MIN_S, PAUSE_MAX_S);
      if (SEND) await schlaf(p * 1000);
    }
  }

  if (transporter) transporter.close();
  console.log('\nFertig. ' + (SEND ? 'versandt: ' + raus : 'Trockenlauf: ' + raus + ' vorbereitet')
    + (fehler ? ' · Fehler: ' + fehler : ''));
  const rest = empf.length - Object.keys(versand.gesendet).length;
  console.log('Noch offen: ' + rest);
}

/* ── Einstieg ── */
(async () => {
  if (VORBEREITEN) return vorbereiten();
  if (PRUEFEN)     { const ok = await pruefen(); process.exit(ok ? 0 : 1); }
  if (PLAN)        return planAusgeben();
  if (VORSCHAU != null && !TEST) return vorschau(parseInt(VORSCHAU, 10));
  if (TEST)        return testmail(TEST, VORSCHAU != null ? parseInt(VORSCHAU, 10) : 0);
  return versenden();
})().catch(e => { console.error('Abbruch:', e.message); process.exit(1); });
