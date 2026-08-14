/**
 * Kampagne „Saisonabschluss 2026" (PLZ 94) – ein druckfertiges PDF pro Empfänger.
 *
 * Ersetzt den Word-Seriendruck: LetterXpress nimmt pro Brief eine PDF-Datei
 * entgegen, ein gemergtes Sammeldokument wäre nur ein manueller Zwischenschritt.
 *
 * Gestaltung folgt dem Designsystem der Website (index.html): Poppins als
 * Auszeichnungsschrift, Open Sans für Fließtext, Teal #167E74 statt des
 * früheren Forstgrüns. Wer den QR-Code scannt, landet auf einer Seite mit
 * denselben Schriften und derselben Farbe.
 *
 * Layout nach dem LetterXpress-Formblatt (DIN A4 hoch, 210 × 297 mm):
 *   - Anschriftfeld  20 mm von links, 27 mm von oben, 85 × 40 mm
 *   - nicht bedruckbarer Rand 3 mm auf allen Seiten
 *   - Schriftgrad Anschrift 10–12 pt
 * Vor dem Livelauf einen Brief im Testmodus einreichen und die
 * Adressposition an der Vorschau prüfen.
 *
 * Voraussetzung: node scripts/build-print-fonts.js (erzeugt fonts/print/*.ttf)
 *
 * Aufruf:
 *   node scripts/generate-briefe-heimat94.js                # Welle 1
 *   node scripts/generate-briefe-heimat94.js --welle 2
 *   node scripts/generate-briefe-heimat94.js --limit 3      # Probedruck
 *   node scripts/generate-briefe-heimat94.js --token A7K3M  # einzelner Brief
 */

const fs      = require('fs');
const path    = require('path');
const PDFDocument = require('pdfkit');
const QRCode  = require('qrcode');
const ExcelJS = require('exceljs');

const ROOT   = path.resolve(__dirname, '..');
const BILDER = path.join(ROOT, 'Bilder');
const FONTS  = path.join(ROOT, 'fonts', 'print');
const SHEET  = 'Heimat_PLZ94';

/* ── CLI ── */
const argv  = process.argv.slice(2);
const argOf = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const WELLE = parseInt(argOf('--welle') || '1', 10);
const LIMIT = argOf('--limit') ? parseInt(argOf('--limit'), 10) : Infinity;
const ONLY_TOKEN = (argOf('--token') || '').toUpperCase() || null;
/* --xlsx/--out erlauben einen Layout-Test gegen Beispieldaten, ohne die
   echte Leadliste anzufassen. */
const XLSX_PATH = argOf('--xlsx') || path.join(ROOT, 'Anschreiben', 'KolibriInspect_PV_Leads_PLZ94.xlsx');
const OUT_DIR   = argOf('--out')  || path.join(ROOT, 'Anschreiben', 'Briefe_Heimat94');

/* ── Maße ── */
const MM = n => n * 2.834645669;          // Millimeter → PDF-Punkte
const PAGE_H = MM(297);
const L      = MM(20);                    // linker Satzspiegel
const R      = MM(190);                   // rechter Satzspiegel
const WIDTH  = R - L;

/* Anschriftfeld laut LetterXpress-Formblatt */
const ADR_X = MM(20), ADR_Y = MM(27), ADR_W = MM(85), ADR_H = MM(40);
/* Obere ~18 mm sind Zusatz-/Vermerkzone – dort steht die Rücksendeangabe. */
const ABSENDER_Y  = ADR_Y + MM(18);
const ANSCHRIFT_Y = ADR_Y + MM(23);

/* ── Farbtokens ──
   Abgeleitet aus den CSS-Variablen in index.html, für Tinte auf weißem
   Papier nachgezogen. TEAL ist bitgleich mit --teal der Website. */
const TEAL   = '#167E74';   // Primärfarbe, identisch zur Website
const DEEP   = '#0E5A52';   // dunkler, für kleine Typo auf Weiß
/* --tealB (#22C2AF) der Website bleibt hier ungenutzt: auf weißem Papier
   trägt es zu wenig Kontrast, und der Brief kommt mit vier Farben aus. */
const INK    = '#16211F';   // Fließtext: Nah-Schwarz mit Teal-Bias
const SLATE  = '#5C6B69';   // Sekundärtext
const MIST   = '#EFF5F3';   // Flächen
const LINE   = '#D3E0DD';   // Haarlinien
const AMBER  = '#B5730C';   // Fristmarker – genau einmal im Brief

/* ── Schrift ──
   Poppins zeichnet aus, Open Sans trägt den Fließtext. Beide stammen aus
   fonts/ (SIL OFL, Einbetten gestattet) und werden von
   scripts/build-print-fonts.js nach TTF entpackt. Fällt das Verzeichnis
   weg, greifen die Base-14-Schriften – dann sieht der Brief anders aus,
   bricht aber nicht. */
const HAT_FONTS = fs.existsSync(path.join(FONTS, 'Poppins-Regular.ttf'));
const F_BODY    = HAT_FONTS ? 'body'      : 'Helvetica';
const F_DISPLAY = HAT_FONTS ? 'display'   : 'Helvetica';
const F_MED     = HAT_FONTS ? 'displayM'  : 'Helvetica';
const F_SEMI    = HAT_FONTS ? 'displaySB' : 'Helvetica-Bold';
const F_BOLD    = HAT_FONTS ? 'displayB'  : 'Helvetica-Bold';
/* Kursiv gibt es nicht: Open Sans liegt nur als Regular vor. Auszeichnung
   läuft stattdessen über Poppins und Farbe – kein Faux-Italic. */

function schriftenLaden(doc) {
  if (!HAT_FONTS) return;
  doc.registerFont('body',      path.join(FONTS, 'OpenSans-Regular.ttf'));
  doc.registerFont('display',   path.join(FONTS, 'Poppins-Regular.ttf'));
  doc.registerFont('displayM',  path.join(FONTS, 'Poppins-Medium.ttf'));
  doc.registerFont('displaySB', path.join(FONTS, 'Poppins-SemiBold.ttf'));
  doc.registerFont('displayB',  path.join(FONTS, 'Poppins-Bold.ttf'));
}

/* ── Kampagnentexte ── */
const ABSENDER_KURZ = 'Kolibri Inspect · TGA Plöchinger GmbH · Passauer Str. 20 · 94121 Salzweg';
const FOOTER_ZEILE  = 'Kolibri Inspect | TGA Plöchinger GmbH | Passauer Str. 20, 94121 Salzweg | info@kolibri-inspect.de';
const TELEFON       = '+49 179 1599311';
/* Direkt auf die PDF-Datei, nicht auf eine Landingpage: wer vom Papier
   scannt, will den Bericht sehen, keine weitere Webseite. */
const MUSTERBERICHT_URL   = 'https://www.kolibri-inspect.de/musterbericht.pdf';
const MUSTERBERICHT_KURZ  = 'kolibri-inspect.de/musterbericht.pdf';
const QUELLEN = 'Quellen: IEA PVPS Task 13 Report T13-30:2025; TÜV Rheinland/DB Schenker Logistikstudie PV-Module; '
  + 'DIN EN IEC 62446-3; Inbetriebnahmedaten: Marktstammdatenregister (BNetzA)';

/* ── Messsaison ──
   Muss mit den Konstanten in extract-heimat-plz94.js übereinstimmen. */
const SAISON_ENDE       = new Date(2026, 9, 31);   // 31.10.2026
const SAISON_ENDE_KURZ  = '31.10.';

/* ── Beispielrechnung Ertragsverlust ──
   Rechnet die vier typischen Befunde auf die Kennwerte der konkreten Anlage
   hoch. Alle Annahmen stehen als Fußnote im Brief; die Prozentwerte je
   Fehlerbild stammen aus index.html (Zelldefekt bis 15 %, Bypassdiode
   11–26 %, Stringfehler bis 25 %, Verschmutzung 2–10 %), die Anomaliequote
   von 2,8 % aus dem eigenen Musterbericht (musterbericht.pdf).

   Wichtig: die Prozentsätze gelten je betroffenem Modul, nicht für die
   Anlage. Deshalb wird über Häufigkeit × Einzelverlust auf Anlagenebene
   gerechnet – ein direktes Multiplizieren des Jahresertrags mit 15 % wäre
   um Größenordnungen falsch. */
const ERTRAG_KWH_PRO_KWP = 950;
const STROMWERT_EUR_KWH  = 0.08;
const MODULE_JE_STRING   = 22;     // übliche Stranglänge
const ANOMALIEQUOTE      = 0.028;  // Anteil auffälliger Module
const VERLUST_HOTSPOT    = 0.15;   // je betroffenem Modul
const QUOTE_DIODE        = 0.01;   // Anteil Module mit defekter Bypass-Diode
const VERLUST_DIODE      = 0.30;   // je betroffenem Modul
const VERLUST_VERSCHMUTZ = 0.01;   // anlagenweit, 5 % auf ~20 % der Fläche
/* EEG-Einspeisevergütung läuft 20 Jahre ab Inbetriebnahme (zzgl. des
   Inbetriebnahmejahres – hier bewusst nicht mitgerechnet). */
const EINSPEISUNG_JAHRE  = 20;

/* Restliche Einspeisezeit in vollen Jahren, abgerundet. */
function restJahre(ibnIso, heute = new Date()) {
  const ibn = parseIso(ibnIso);
  if (!ibn) return null;
  const verstrichen = (heute - ibn) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.floor(EINSPEISUNG_JAHRE - verstrichen));
}

function befundRechnung(r) {
  const kwp    = Number(r.LEISTUNG_KWP) || 0;
  const module = Number(r.ANZAHL_MODULE) || 1;
  const kwpModul = kwp / module;
  const jahr = kwpAnteil => Math.round(kwpAnteil * ERTRAG_KWH_PRO_KWP);
  const eur  = kwh => Math.round(kwh * STROMWERT_EUR_KWH);
  const jahre = restJahre(r.IBN_ISO);

  const posten = [
    { bild: 0, name: 'Zellfehler / Hot-Spot',
      annahme: `${Math.round(module * ANOMALIEQUOTE)} Module auffällig (2,8 %), je −15 %`,
      kwp: module * ANOMALIEQUOTE * VERLUST_HOTSPOT * kwpModul },
    { bild: 1, name: 'Defekte Bypass-Diode',
      annahme: `${Math.max(1, Math.round(module * QUOTE_DIODE))} Module betroffen (1 %), je −30 %`,
      kwp: module * QUOTE_DIODE * VERLUST_DIODE * kwpModul },
    { bild: 2, name: 'Ausgefallener String',
      annahme: `ein Strang à ${MODULE_JE_STRING} Module ohne Ertrag`,
      kwp: MODULE_JE_STRING * kwpModul },
    { bild: 3, name: 'Verschmutzung',
      annahme: '5 % Minderertrag auf rund 20 % der Fläche',
      kwp: kwp * VERLUST_VERSCHMUTZ },
  ].map(p => {
    const kwh = jahr(p.kwp);
    const e = eur(kwh);
    return { ...p, kwh, eur: e, gesamt: jahre == null ? null : e * jahre };
  });

  const summeEur = posten.reduce((s, p) => s + p.eur, 0);
  return {
    posten,
    jahre,
    summeKwh: posten.reduce((s, p) => s + p.kwh, 0),
    summeEur,
    summeGesamt: jahre == null ? null : summeEur * jahre,
  };
}

/* ── Hilfen ── */
const fmtKwp = v => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(Number(v) || 0);
const fmtInt = v => new Intl.NumberFormat('de-DE').format(Number(v) || 0);
const fmtEur = v => new Intl.NumberFormat('de-DE').format(Math.round(Number(v) || 0)) + ' €';
const parseIso = s => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

/* Absatz mit hervorgehobenen Zahlen.
   `teile` ist eine Folge aus Strings (Fließtext) und { z: '…' }-Objekten
   (Kennzahl). Kennzahlen laufen in Poppins SemiBold, eine Spur größer und
   in Markenfarbe – sie sollen beim Überfliegen hängenbleiben. */
function absatzMitZahlen(doc, teile, x, y, breite, o = {}) {
  const gross = o.size || 9.5;
  teile.forEach((teil, i) => {
    const letzter = i === teile.length - 1;
    const opts = { width: breite, lineGap: o.lineGap ?? 1.2, continued: !letzter };
    if (typeof teil === 'string') {
      doc.font(F_BODY).fontSize(gross).fillColor(o.color || INK);
      i === 0 ? doc.text(teil, x, y, opts) : doc.text(teil, opts);
    } else {
      doc.font(F_SEMI).fontSize(gross + 1).fillColor(teil.farbe || DEEP);
      i === 0 ? doc.text(teil.z, x, y, opts) : doc.text(teil.z, opts);
    }
  });
}

/* QR aus dem Kurzlink.
   Fehlerkorrektur Q (25 %) toleriert Knicke und Druckartefakte, margin 4 ist
   die spezifizierte Ruhezone. Gemessen: der Kurzlink ergibt Version 4 mit 33
   Modulen → 0,63 mm pro Modul bei 26 mm Kantenlänge. Der volle Deeplink käme
   auf Version 13 / 69 Module → 0,34 mm, praktisch am Minimum. */
function qrBuffer(text) {
  return QRCode.toBuffer(text, {
    errorCorrectionLevel: 'Q',
    margin: 4,
    width: 600,
    color: { dark: TEAL, light: '#FFFFFF' },
  });
}

/* Haarlinie */
function regel(doc, y, farbe = LINE, staerke = 0.6, von = L, bis = R) {
  doc.moveTo(von, y).lineTo(bis, y).strokeColor(farbe).lineWidth(staerke).stroke();
}

/* Spaltentexte laufen mit lineBreak:false stumm in die Nachbarspalte, wenn
   sie zu breit sind. Beide Tabellen prüfen deshalb vor dem Setzen – der
   Fehler ist sonst erst im gedruckten Brief sichtbar. */
function pruefeBreite(doc, text, max, wo, spacing = 0) {
  const w = doc.widthOfString(String(text)) + spacing * String(text).length;
  if (w > max) {
    console.log(`  ⚠ ${wo}: "${text}" ist ${(w / MM(1)).toFixed(1)} mm breit, `
      + `Spalte fasst ${(max / MM(1)).toFixed(1)} mm — Text kürzen.`);
  }
  return w;
}

/* Satzspiegel-Kontrolle: Seite 1 muss vor 280 mm enden, sonst kippt der Brief
   auf drei Seiten. Mit DEBUG_LAYOUT=1 die Zwischenstände sichtbar machen. */
function marke(name, y) {
  if (!process.env.DEBUG_LAYOUT) return;
  console.log(`    [layout] ${String(name).padEnd(18)} ${(y / MM(1)).toFixed(1)} mm`);
}

/* Kleine Versal-Auszeichnung über einem Block.
   lineBreak:false ist hier Pflicht: ein umbrechendes Label setzt seine
   zweite Zeile genau dort ab, wo der Wert steht, und überdruckt ihn. */
function label(doc, text, x, y, breite, farbe = TEAL) {
  const t = String(text).toUpperCase();
  doc.font(F_SEMI).fontSize(6.5).fillColor(farbe);
  pruefeBreite(doc, t, breite, 'Label', 0.8);
  doc.text(t, x, y, { width: breite, characterSpacing: 0.8, lineBreak: false });
}

/* ══════════════════════════════════════════════════════════════════
   Messkarte: Anlagendaten + Fristverlauf
   Trägt das Argument des Briefs als Objekt statt als Fließtext. Alle
   Werte stammen aus dem Marktstammdatenregister, nichts ist dekorativ.
   ══════════════════════════════════════════════════════════════════ */
function fristbalken(doc, r, y) {
  /* Keine Fläche, keine Kästen: Seite 1 arbeitet durchgehend mit Haarlinien
     und Versal-Labels. Oben steht nur der Zeitverlauf – Inbetriebnahme,
     heute, Fristende. Die Kennwerte der Anlage folgen unter der
     Befundtabelle, wo sie die Hochrechnung belegen. */
  const H = MM(14);

  const rest = Number(r.MONATE_BIS_GW_ENDE);
  const ibn  = parseIso(r.IBN_ISO);
  const gwE  = parseIso(r.GW_ENDE_ISO);
  const bx = L, bw = WIDTH, by = y + MM(6), bh = MM(2.8);

  if (!ibn || !gwE || !Number.isFinite(rest)) {
    doc.font(F_BODY).fontSize(8).fillColor(SLATE)
      .text('Inbetriebnahmedatum nicht hinterlegt – Fristverlauf auf Anfrage.',
        bx, y + MM(2), { width: bw });
    return { unten: y + MM(8), fazit: null };
  }

  const spanne = gwE - ibn;                       // 5 Jahre in ms
  const pos = d => bx + bw * Math.min(1, Math.max(0, (d - ibn) / spanne));
  const heute = new Date();
  const xHeute  = pos(heute);
  const xSaison = pos(SAISON_ENDE);

  doc.rect(bx, by, bw, bh).fill(MIST);
  doc.rect(bx, by, xHeute - bx, bh).fill('#C9D6D3');            // verstrichen
  /* Messfenster dieser Saison: der Zeitraum, in dem gehandelt werden kann */
  const xFensterEnde = Math.min(xSaison, bx + bw);
  if (xFensterEnde > xHeute) doc.rect(xHeute, by, xFensterEnde - xHeute, bh).fill(TEAL);
  /* Danach bis Fristablauf: keine normgerechte Messung mehr möglich */
  if (bx + bw > xFensterEnde) doc.rect(xFensterEnde, by, bx + bw - xFensterEnde, bh).fill(AMBER);

  /* Jahresraster – macht die Skala lesbar, liegt über den Segmenten */
  for (let j = 1; j < 5; j++) {
    const xj = bx + bw * (j / 5);
    doc.moveTo(xj, by).lineTo(xj, by + bh)
      .lineWidth(0.4).strokeColor('#FFFFFF').stroke();
  }

  /* Marker */
  doc.moveTo(xHeute, by - MM(2)).lineTo(xHeute, by + bh + MM(2))
    .lineWidth(1.2).strokeColor(DEEP).stroke();
  if (xSaison > xHeute && xSaison < bx + bw) {
    doc.moveTo(xSaison, by - MM(2)).lineTo(xSaison, by + bh + MM(2))
      .lineWidth(1.2).strokeColor(AMBER).stroke();
  }

  /* Beschriftung: Enden außen, Marker innen */
  doc.font(F_BODY).fontSize(6).fillColor(SLATE)
    .text(`Inbetriebnahme ${r.IBN_MONAT_JAHR}`, bx, by + MM(4.2), { width: bw * 0.4, lineBreak: false });
  doc.font(F_SEMI).fontSize(6).fillColor(AMBER)
    .text(`Frist endet ${r.GW_ENDE_MONAT}`, bx + bw * 0.6, by + MM(4.2),
      { width: bw * 0.4, align: 'right', lineBreak: false });
  doc.font(F_SEMI).fontSize(6).fillColor(DEEP)
    .text('heute', xHeute - MM(9), by - MM(4.2), { width: MM(18), align: 'center', lineBreak: false });
  if (xSaison > xHeute + MM(12) && xSaison < bx + bw - MM(6)) {
    doc.font(F_SEMI).fontSize(6).fillColor(AMBER)
      .text(`Messfenster zu ${SAISON_ENDE_KURZ}`, xSaison - MM(14), by - MM(4.2),
        { width: MM(28), align: 'center', lineBreak: false });
  }

  /* Das Fazit gibt der Balken zurück, statt es selbst zu setzen – es steht
     als Satz darunter, nicht als Diagrammbeschriftung darin. */
  const letzte = String(r.LETZTE_SAISON).toLowerCase() === 'ja';
  const fazit = {
    letzte,
    text: letzte
      ? `Noch ${rest} Monate Frist – nach dem ${SAISON_ENDE_KURZ} gibt es davor keine weitere Messgelegenheit.`
      : `Noch ${rest} Monate Frist – diese Saison oder die nächste ab März.`,
  };

  return { unten: y + H, fazit };
}

/* ══════════════════════════════════════════════════════════════════
   Datenband: die Kennwerte, auf denen die Hochrechnung beruht.
   Steht unter der Befundtabelle – dort belegt es die Zahlen, statt
   oben als Steckbrief den Einstieg zu blockieren.
   ══════════════════════════════════════════════════════════════════ */
function datenband(doc, r, y, jahre) {
  /* Bei sechs Spalten bleiben nur ~26 mm je Feld. Labels und Werte müssen
     deshalb kurz sein – „Freiflächenanlage" und „JAHRESERTRAG CA." passten
     nicht und überdruckten die Nachbarzeile. */
  const bauartKurz = t => /Freifläche/i.test(t) ? 'Freifläche'
    : /Dachanlage/i.test(t) ? 'Dachanlage'
    : /Parkplatz/i.test(t) ? 'Parkplatz'
    : t;

  const felder = [
    ['Leistung', `${fmtKwp(r.LEISTUNG_KWP)} kWp`],
    ['Module',   fmtInt(r.ANZAHL_MODULE)],
  ];
  if (r.ANLAGENTYP) felder.push(['Bauart', bauartKurz(r.ANLAGENTYP)]);
  if (r.AUSRICHTUNG) felder.push(['Ausrichtung', r.AUSRICHTUNG]);
  felder.push(['Ertrag/Jahr', `${fmtInt(Math.round(Number(r.JAHRESERTRAG_KWH) / 1000))} MWh`]);
  if (jahre != null) felder.push(['Einspeisung', `${jahre} Jahre`]);

  regel(doc, y, LINE, 0.4);
  const spalte = WIDTH / felder.length;
  felder.forEach(([k, v], i) => {
    const x = L + i * spalte;
    const nutzbar = spalte - MM(2);
    label(doc, k, x, y + MM(2.2), nutzbar, SLATE);
    doc.font(F_SEMI).fontSize(9).fillColor(INK);
    pruefeBreite(doc, v, nutzbar, 'Datenband');
    doc.text(v, x, y + MM(4.8), { width: nutzbar, lineBreak: false });
  });
  regel(doc, y + MM(10), LINE, 0.4);
  return y + MM(10);
}

/* ── Seite 1 ── */
function seite1(doc, r, imgs) {
  /* Briefkopf – bleibt oberhalb des Anschriftfelds (27 mm) */
  doc.font(F_BOLD).fontSize(13.5).fillColor(TEAL)
    .text('KOLIBRI INSPECT', L, MM(11), { characterSpacing: 0.6 });
  doc.font(F_BODY).fontSize(7).fillColor(SLATE)
    .text('TGA Plöchinger GmbH · Passauer Str. 20 · 94121 Salzweg · info@kolibri-inspect.de', L, MM(18.5));

  /* Rechter Kopfblock – liegt neben dem Anschriftfeld (x > 105 mm) */
  doc.font(F_MED).fontSize(8.5).fillColor(DEEP)
    .text('Drohnen-Thermografie für Photovoltaik', MM(112), MM(30), { width: MM(78), align: 'right' });
  doc.font(F_BODY).fontSize(7).fillColor(SLATE)
    .text('normgerecht nach DIN EN IEC 62446-3', MM(112), MM(34.5), { width: MM(78), align: 'right' })
    .text('www.kolibri-inspect.de', MM(112), MM(38.5), { width: MM(78), align: 'right' });

  /* Rücksendeangabe + Anschrift im Fensterbereich */
  doc.font(F_BODY).fontSize(6).fillColor(SLATE)
    .text(ABSENDER_KURZ, ADR_X, ABSENDER_Y, { width: ADR_W });

  const adrZeilen = [r.FIRMENNAME, r.ANSPRECHPARTNER, r.STRASSE_HAUSNR, `${r.PLZ} ${r.ORT}`].filter(Boolean);
  doc.font(F_BODY).fontSize(10).fillColor(INK);
  adrZeilen.forEach((z, i) => {
    doc.text(String(z), ADR_X, ANSCHRIFT_Y + i * MM(4.6), { width: ADR_W, lineBreak: false });
  });

  /* Datum + Haarlinie unterhalb des Anschriftfelds */
  const yLinie = ADR_Y + ADR_H + MM(4);
  doc.font(F_BODY).fontSize(8).fillColor(SLATE)
    .text(`Salzweg, ${r.DATUM}`, L, yLinie - MM(5), { width: WIDTH, align: 'right' });
  regel(doc, yLinie, LINE, 0.6);

  /* Betreff: erst die Leistung, dann der Anlass */
  let y = yLinie + MM(7);
  doc.font(F_SEMI).fontSize(12).fillColor(INK)
    .text(`Drohnen-Thermografie Ihrer PV-Anlage in ${r.ORT_ANLAGE} `
      + `(${fmtKwp(r.LEISTUNG_KWP)} kWp)`, L, y, { width: WIDTH, lineGap: 1 });
  y = doc.y + MM(1.5);
  doc.font(F_BODY).fontSize(9).fillColor(SLATE)
    .text(`Befund vor Ablauf der Errichter-Mängelhaftung im ${r.GW_ENDE_MONAT}`,
      L, y, { width: WIDTH });

  /* Fließtext – linksbündig, kein Blocksatz: deutsche Komposita reißen
     ohne Silbentrennung sonst sichtbare Löcher in die Zeilen. */
  y = doc.y + MM(6);
  const absatz = (fn, abstand = MM(3)) => { fn(); y = doc.y + abstand; };
  const setz = (t, o = {}) => doc.font(o.font || F_BODY).fontSize(o.size || 9.5)
    .fillColor(o.color || INK).text(t, L, y, { width: WIDTH, lineGap: 1.2, ...o });

  absatz(() => setz(`${r.ANREDE},`));

  /* Absatz 1 – Fakten ohne Vorrede. Die Quelle (Marktstammdatenregister)
     steht in der Fußnote auf Seite 2, nicht mitten im Satz. */
  const bauart = r.ANLAGENTYP ? `Ihre ${r.ANLAGENTYP}` : 'Ihre Anlage';
  absatz(() => absatzMitZahlen(doc, [
    `${bauart} in ${r.ORT_ANLAGE} ist seit ${r.IBN_MONAT_JAHR} in Betrieb. Die Mängelhaftung `
    + `Ihres Errichters (§ 634a Abs. 1 Nr. 2 BGB, fünf Jahre ab Abnahme) endet damit `
    + `voraussichtlich im `,
    { z: r.GW_ENDE_MONAT, farbe: AMBER },
    '. Bis dahin trägt er die Kosten für Modulfehler, die bei Übergabe angelegt waren – '
    + 'danach Sie.',
  ], L, y, WIDTH), MM(5));

  marke('vor Balken', y);
  const fb = fristbalken(doc, r, y);
  y = fb.unten + MM(2);

  /* Fazit als eigener Satz – trägt die Aussage, nicht die Grafik */
  if (fb.fazit) {
    doc.font(F_SEMI).fontSize(9.5).fillColor(fb.fazit.letzte ? AMBER : DEEP)
      .text(fb.fazit.text, L, y, { width: WIDTH });
    y = doc.y + MM(5);
  }
  marke('nach Balken', y);

  /* Leistungsbeschreibung, bauartabhängig. Der frühere Absatz
     „Wir sind Ihre Nachbarn" entfällt – die Begründung der reduzierten
     Anfahrt steht sachlich in der Preistabelle auf Seite 2. */
  const spezifisch = /Freifläche/i.test(r.ANLAGENTYP || '')
    ? 'Bei Freiflächenanlagen typisch: Verschmutzungsbänder an den Unterkanten, '
      + 'Teilverschattung durch aufgewachsene Vegetation.'
    : /Dachanlage|Parkplatz/i.test(r.ANLAGENTYP || '')
      ? 'Bei Dachanlagen typisch: Teilverschattung durch Aufbauten, Hotspots in Feldern, die vom '
        + 'Boden aus nicht beurteilbar sind.'
      : 'Typisch: Hotspots, defekte Bypass-Dioden, Stringausfälle, Verschmutzung.';
  doc.font(F_BODY).fontSize(9.5).fillColor(INK).text(
    `Wir messen im laufenden Betrieb die Oberflächentemperatur jedes Moduls, georeferenziert, `
    + `ohne Anlagenstillstand. ${spezifisch} Was solche Befunde bei Ihrer Anlage kosten:`,
    L, y, { width: WIDTH, lineGap: 1.2 });
  y = doc.y + MM(5);

  /* Befundtabelle steht auf Seite 1: sie ist das Argument, nicht die Anlage. */
  y = befundTabelle(doc, r, imgs, y);

  /* Datenband darunter: die Kennwerte, auf denen die Hochrechnung beruht. */
  y = datenband(doc, r, y + MM(2), restJahre(r.IBN_ISO));

  const ende = doc.y;
  marke('Seite 1 Ende', ende);
  return ende;
}

/* ══════════════════════════════════════════════════════════════════
   Befundtabelle: was ein einzelner Befund bei dieser Anlage kostet.
   Die Thermogramme stehen in der Tabelle, nicht als Bilderstreifen
   daneben – jedes Bild bekommt damit eine Zahl an die Seite.
   ══════════════════════════════════════════════════════════════════ */
function befundTabelle(doc, r, imgs, y) {
  const { posten, summeEur, summeGesamt, jahre } = befundRechnung(r);

  /* Spalten: Thermogramm · Befund + Annahme · €/Jahr · € über Restlaufzeit.
     Die kWh stehen in der Annahmezeile – der Euro-Betrag trägt die Aussage,
     und für zwei Zahlenspalten ist die Restlaufzeit die wichtigere. */
  const cBild = MM(20), cJahr = MM(24), cRest = MM(32);
  const cText = WIDTH - cBild - cJahr - cRest - MM(6);
  const xBild = L, xText = L + cBild + MM(3), xJahr = xText + cText + MM(3), xRest = xJahr + cJahr;

  doc.font(F_SEMI).fontSize(6.5).fillColor(SLATE)
    .text('BEFUND', xText, y, { width: cText, characterSpacing: 0.8 })
    .text('JE JAHR', xJahr, y, { width: cJahr, align: 'right', characterSpacing: 0.8 });
  /* Kurz halten: „BIS ENDE EINSPEISUNG (15 J.)" war 40 mm breit und lief in
     die Jahresspalte. Der Bezug steht im Datenband unter der Tabelle. */
  const kopfRest = jahre != null ? `ÜBER ${jahre} JAHRE` : 'ÜBER DIE LAUFZEIT';
  doc.font(F_SEMI).fontSize(6.5).fillColor(AMBER);
  pruefeBreite(doc, kopfRest, cRest, 'Befundtabelle Kopf', 0.8);
  doc.text(kopfRest, xRest, y, { width: cRest, align: 'right', characterSpacing: 0.8 });
  y += MM(4);
  regel(doc, y, DEEP, 0.8);
  y += MM(2);

  const bildH = cBild * 0.66;
  posten.forEach(p => {
    doc.image(imgs[p.bild], xBild, y, { width: cBild, height: bildH });
    doc.font(F_MED).fontSize(9).fillColor(INK);
    pruefeBreite(doc, p.name, cText, 'Befundtabelle');
    doc.text(p.name, xText, y + MM(0.5), { width: cText, lineBreak: false });
    doc.font(F_BODY).fontSize(7).fillColor(SLATE)
      .text(`${p.annahme} · −${fmtInt(p.kwh)} kWh/Jahr`, xText, y + MM(4.5), { width: cText });
    doc.font(F_BODY).fontSize(9).fillColor(SLATE);
    pruefeBreite(doc, `− ${fmtEur(p.eur)}`, cJahr, 'Befundtabelle');
    doc.text(`− ${fmtEur(p.eur)}`, xJahr, y + MM(1.5), { width: cJahr, align: 'right', lineBreak: false });
    const rest = p.gesamt == null ? '–' : `− ${fmtEur(p.gesamt)}`;
    doc.font(F_SEMI).fontSize(10.5).fillColor(AMBER);
    pruefeBreite(doc, rest, cRest, 'Befundtabelle');
    doc.text(rest, xRest, y + MM(1.2), { width: cRest, align: 'right', lineBreak: false });
    y += Math.max(bildH, MM(9)) + MM(2.5);
    regel(doc, y - MM(1.2), LINE, 0.4);
  });

  /* Summe – die eigentliche Aussage steht in der rechten Spalte */
  doc.font(F_SEMI).fontSize(9.5).fillColor(INK)
    .text('Treten diese Befunde gemeinsam auf', xText, y + MM(1.5), { width: cText, lineBreak: false });
  doc.font(F_BODY).fontSize(9).fillColor(SLATE)
    .text(`− ${fmtEur(summeEur)}`, xJahr, y + MM(1.8), { width: cJahr, align: 'right', lineBreak: false });
  const summeText = summeGesamt == null ? '–' : `− ${fmtEur(summeGesamt)}`;
  doc.font(F_BOLD).fontSize(13).fillColor(AMBER);
  pruefeBreite(doc, summeText, cRest, 'Befundtabelle Summe');
  doc.text(summeText, xRest, y + MM(1), { width: cRest, align: 'right', lineBreak: false });
  y += MM(8);

  /* Der Vorbehalt zur Rechnung steht gesammelt in der Fußnote auf Seite 2.
     Hier bleibt nur der Satz, der den Vergleich schließt. */
  doc.font(F_BODY).fontSize(8).fillColor(SLATE).text(
    `Beispielrechnung mit branchenüblichen Häufigkeiten – die Inspektion Ihrer Anlage kostet `
    + `einmalig ${r.PREIS_NETTO} € netto. Angebot auf der Rückseite.`,
    L, y, { width: WIDTH, lineGap: 0.6 });

  return doc.y + MM(4);
}

/* ── Seite 2 ── */
async function seite2(doc, r) {
  doc.addPage();

  let y = MM(20);
  label(doc, 'Ihr Aktionsangebot', L, y, WIDTH);
  doc.font(F_SEMI).fontSize(15).fillColor(INK)
    .text('Saisonabschluss 2026', L, doc.y + MM(1), { width: WIDTH });
  doc.font(F_BODY).fontSize(8.5).fillColor(SLATE).text(
    `${fmtKwp(r.LEISTUNG_KWP)} kWp · ${fmtInt(r.ANZAHL_MODULE)} Module · Standort ${r.ORT_ANLAGE}`
    + `${r.MASTR_SEE ? ` · ${r.MASTR_SEE}` : ''}`,
    L, doc.y + MM(1), { width: WIDTH });

  /* Preistabelle – Haarlinien statt Vollflächen, Zahlen in Poppins */
  y = doc.y + MM(5);
  const cW = [WIDTH * 0.56, WIDTH * 0.22, WIDTH * 0.22];
  const cX = [L, L + cW[0], L + cW[0] + cW[1]];
  /* lineBreak:false verhindert Umbruch – nötig, damit die Zeilenhöhen fest
     bleiben. Deshalb muss jeder Text in seine Spalte passen; sonst läuft er
     stumm in die Nachbarspalte. Die Prüfung meldet das beim Rendern. */
  const zelle = (i, text, dy, o = {}) => {
    const breite = cW[i] - (i === 0 ? MM(3) : MM(2));
    doc.font(o.font || F_BODY).fontSize(o.size || 9).fillColor(o.color || INK);
    pruefeBreite(doc, text, breite, 'Preistabelle');
    doc.text(text, cX[i] + (i === 0 ? 0 : MM(2)), y + dy, {
      width: breite,
      align: i === 0 ? 'left' : 'right',
      lineBreak: false,
    });
  };

  label(doc, 'Leistung', cX[0], y, cW[0], SLATE);
  doc.font(F_SEMI).fontSize(6.5).fillColor(SLATE)
    .text('LISTENPREIS', cX[1] + MM(2), y, { width: cW[1] - MM(2), align: 'right', characterSpacing: 0.8 });
  doc.font(F_SEMI).fontSize(6.5).fillColor(TEAL)
    .text('AKTION', cX[2] + MM(2), y, { width: cW[2] - MM(2), align: 'right', characterSpacing: 0.8 });
  y += MM(4);
  regel(doc, y, TEAL, 1);
  y += MM(3);

  /* Anfahrt */
  zelle(0, 'Anfahrtspauschale', 0);
  doc.font(F_BODY).fontSize(7).fillColor(SLATE)
    .text('Saisonabschluss · unter 500 kWp 95 €, ab 500 kWp entfällt sie',
      cX[0], y + MM(4.5), { width: cW[0] - MM(3) });
  zelle(1, '190,00 €', 0, { color: SLATE });
  zelle(2, `${r.PAUSCHALE} €`, 0, { font: F_MED, color: TEAL });
  y += MM(9.5);
  regel(doc, y, LINE, 0.5);
  y += MM(3);

  /* Module */
  zelle(0, `Thermografie-Inspektion · ${fmtInt(r.ANZAHL_MODULE)} Module à ${r.PREIS_PRO_MODUL} €`, 0);
  zelle(1, `${r.PREIS_MODULE} €`, 0, { color: SLATE });
  zelle(2, `${r.PREIS_MODULE} €`, 0, { font: F_MED });
  y += MM(6);
  regel(doc, y, LINE, 0.5);
  y += MM(3);

  /* Bericht */
  zelle(0, 'Befundbericht mit Thermogrammen und Handlungsempfehlung', 0, { size: 8.5, color: SLATE });
  zelle(1, 'inklusive', 0, { size: 8.5, color: SLATE });
  zelle(2, 'inklusive', 0, { size: 8.5, color: SLATE });
  y += MM(6);

  /* Gesamt */
  doc.rect(L, y, WIDTH, MM(11)).fill(MIST);
  zelle(0, 'Gesamt netto zzgl. MwSt.', MM(3.4), { font: F_SEMI, size: 10.5 });
  zelle(1, `${r.PREIS_NETTO_LISTE} €`, MM(3.4), { font: F_BODY, size: 10, color: SLATE });
  zelle(2, `${r.PREIS_NETTO} €`, MM(3.2), { font: F_BOLD, size: 11.5, color: TEAL });
  y += MM(11) + MM(3);

  doc.font(F_BODY).fontSize(8.5).fillColor(INK).text(
    `Ersparnis gegenüber Listenpreis ${r.ERSPARNIS} € · Aktion gültig bis ${r.AKTION_BIS}`,
    L, y, { width: WIDTH });
  y = doc.y + MM(6);

  /* ── Bestellblock: QR links, Kurzlink rechts ── */
  const qr = await qrBuffer(r.KURZLINK);
  const boxH = MM(34);
  doc.rect(L, y, WIDTH, boxH).fill(MIST);
  doc.rect(L, y, MM(1.2), boxH).fill(TEAL);
  doc.rect(L, y, WIDTH, boxH).lineWidth(0.6).strokeColor(LINE).stroke();

  const qrSize = MM(26);
  const qrX = L + MM(7), qrY = y + MM(4);
  doc.image(qr, qrX, qrY, { width: qrSize, height: qrSize });

  const tX = qrX + qrSize + MM(8);
  const tW = R - tX - MM(7);
  label(doc, 'Beauftragung', tX, y + MM(5), tW);
  doc.font(F_SEMI).fontSize(10.5).fillColor(INK)
    .text('QR-Code scannen', tX, doc.y + MM(1), { width: tW });
  doc.font(F_BODY).fontSize(8.5).fillColor(INK).text(
    'Leistung, Modulzahl, Standort und Aktionscode sind im Formular bereits eingetragen.',
    tX, doc.y + MM(1.2), { width: tW, lineGap: 0.8 });
  doc.font(F_BODY).fontSize(7.5).fillColor(SLATE)
    .text('oder im Browser aufrufen', tX, doc.y + MM(2), { width: tW });
  doc.font(F_MED).fontSize(11.5).fillColor(TEAL)
    .text(r.KURZLINK.replace(/^https:\/\/www\./, ''), tX, doc.y + MM(0.6), { width: tW });
  doc.font(F_BODY).fontSize(7).fillColor(SLATE)
    .text(`Aktionscode ${r.AKTIONSCODE}`, tX, doc.y + MM(1.2), { width: tW });

  y += boxH + MM(5);

  /* ── Musterbericht: zeigt vor der Beauftragung, was geliefert wird ── */
  const qrMuster = await qrBuffer(MUSTERBERICHT_URL);
  /* 24 mm statt 20: die PDF-URL ergibt QR-Version 5 (37 Module). Bei 20 mm
     wären das 0,44 mm je Modul, unter der Empfehlung von 0,5 mm. */
  const mSize = MM(24);
  doc.image(qrMuster, L, y, { width: mSize, height: mSize });
  const mX = L + mSize + MM(5);
  label(doc, 'Vorab ansehen', mX, y + MM(1.5), WIDTH - mSize - MM(5));
  doc.font(F_SEMI).fontSize(9.5).fillColor(INK)
    .text('Musterbericht als PDF (498 kWp, 6 Seiten)', mX, doc.y + MM(1), { width: WIDTH - mSize - MM(5) });
  doc.font(F_BODY).fontSize(8).fillColor(SLATE).text(
    'Vollständiger Befundbericht mit georeferenzierten Thermogrammen, Schweregrad-Klassifikation '
    + 'und Handlungsempfehlungen — so sieht Ihr Ergebnis aus.',
    mX, doc.y + MM(1), { width: WIDTH - mSize - MM(5), lineGap: 0.6 });
  doc.font(F_MED).fontSize(8).fillColor(TEAL)
    .text(MUSTERBERICHT_KURZ, mX, doc.y + MM(1), { width: WIDTH - mSize - MM(5) });

  y += mSize + MM(4);

  doc.font(F_BODY).fontSize(6.8).fillColor(SLATE).text(
    'Es gelten unsere AGB (www.kolibri-inspect.de/agb.html). Preise netto zzgl. MwSt. · '
    + 'Modul-Staffel: bis 500 Module 0,80 €, bis 1.500 0,70 €, bis 3.000 0,60 €, bis 5.000 0,50 €, '
    + 'darüber 0,40 € je Modul.', L, y, { width: WIDTH, lineGap: 0.6 });
  y = doc.y + MM(6);

  /* Grußformel */
  doc.font(F_BODY).fontSize(9.5).fillColor(INK).text('Mit freundlichen Grüßen', L, y);
  doc.font(F_SEMI).fontSize(9.5).fillColor(INK).text('Dipl.-Ing. Friedrich Plöchinger', L, y + MM(12));
  doc.font(F_BODY).fontSize(8.5).fillColor(SLATE).text('Kolibri Inspect', L, y + MM(16.5));

  label(doc, 'Direkter Draht', MM(120), y + MM(11), MM(70), SLATE);
  doc.font(F_BODY).fontSize(9).fillColor(INK)
    .text('info@kolibri-inspect.de', MM(120), y + MM(14.5), { width: MM(70), align: 'right' })
    .text(TELEFON,                  MM(120), y + MM(19), { width: MM(70), align: 'right' });

  const endeS2 = y + MM(19);
  marke('Seite 2 Grußblock', endeS2);

  /* Fußnoten: Vorbehalte zur Frist- und Ertragsrechnung */
  const nY = PAGE_H - MM(42);
  regel(doc, nY, LINE, 0.5);
  doc.font(F_BODY).fontSize(6.5).fillColor(SLATE).text(
    'Wir liefern die technische Befundgrundlage – keine Rechtsberatung. Die genannte Frist ist aus '
    + 'dem im Marktstammdatenregister hinterlegten Inbetriebnahmedatum errechnet; maßgeblich für '
    + '§ 634a BGB ist die Abnahme, die davon abweichen kann – bitte anhand Ihres Abnahmeprotokolls '
    + 'prüfen. Die Beispielrechnung auf Seite 1 ist auf Leistung und Modulzahl Ihrer Anlage '
    + 'hochgerechnet und trifft keine Aussage über deren tatsächlichen Zustand. Gerechnet mit '
    + '950 kWh je kWp und 8 ct/kWh, Verlustanteile je Fehlerbild nach gängiger Fachliteratur, '
    + 'Anomaliequote 2,8 % aus unserem Musterbericht. Die Hochrechnung unterstellt eine '
    + 'EEG-Einspeisedauer von 20 Jahren ab Inbetriebnahme, einen unverändert fortbestehenden '
    + 'Befund und einen konstanten Strompreis – sie ist eine Größenordnung, keine Prognose. '
    + 'Halten Sie die Zahlen gegen Ihre eigenen.',
    L, nY + MM(2), { width: WIDTH, lineGap: 0.6 });

  /* Footer */
  const fY = PAGE_H - MM(20);
  regel(doc, fY, LINE, 0.5);
  doc.font(F_BODY).fontSize(6.5).fillColor(SLATE)
    .text(FOOTER_ZEILE, L, fY + MM(2.5), { width: WIDTH, align: 'center' });
  doc.font(F_BODY).fontSize(5.8).fillColor(SLATE)
    .text(QUELLEN, L, fY + MM(6.5), { width: WIDTH, align: 'center' });

  /* Ende des Grußblocks zurückgeben – die Hauptschleife prüft, ob er in
     die Fußnote läuft. */
  return { endeS2mm: endeS2 / MM(1), fussnoteAbMm: nY / MM(1) };
}

/* ── Ein Brief ── */
async function briefPdf(r, imgs) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true });
  schriftenLaden(doc);

  doc.info.Title  = `Kolibri Inspect – Angebot ${r.FIRMENNAME}`;
  doc.info.Author = 'TGA Plöchinger GmbH';

  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const fertig = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const endeS1 = seite1(doc, r, imgs);
  const s2 = await seite2(doc, r);

  const seiten = doc.bufferedPageRange().count;
  doc.end();
  return { buf: await fertig, seiten, endeS1mm: endeS1 / MM(1), ...s2 };
}

/* ── Main ── */
(async () => {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`✗ ${XLSX_PATH} fehlt — zuerst scripts/extract-heimat-plz94.js laufen lassen.`);
    process.exit(1);
  }
  if (!HAT_FONTS) {
    console.log('⚠ fonts/print/ fehlt — Brief nutzt Helvetica statt Poppins/Open Sans.');
    console.log('  Beheben mit: node scripts/build-print-fonts.js');
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) { console.error(`✗ Sheet "${SHEET}" nicht gefunden.`); process.exit(1); }

  const head = {};
  ws.getRow(1).eachCell((c, n) => { head[String(c.value)] = n; });

  const rows = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const r = {};
    for (const [k, n] of Object.entries(head)) {
      const v = row.getCell(n).value;
      r[k] = v == null ? '' : (typeof v === 'object' && v.text ? v.text : v);
    }
    if (!r.FIRMENNAME) continue;
    if (ONLY_TOKEN) { if (String(r.TOKEN).toUpperCase() === ONLY_TOKEN) rows.push(r); continue; }
    if (Number(r.WELLE) !== WELLE) continue;
    rows.push(r);
  }

  const auswahl = rows.slice(0, LIMIT);
  if (!auswahl.length) {
    console.error(ONLY_TOKEN ? `✗ Kein Datensatz mit TOKEN ${ONLY_TOKEN}.` : `✗ Keine Zeilen für Welle ${WELLE}.`);
    process.exit(1);
  }

  const imgs = ['Zellfehler.PNG', 'Diodenfehler.PNG', 'Stringfehler.PNG', 'Verschmutzung.PNG']
    .map(f => fs.readFileSync(path.join(BILDER, f)));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Erzeuge ${auswahl.length} Brief(e) → ${OUT_DIR}`);

  /* Satzspiegel-Grenze: LetterXpress druckt die äußeren 3 mm nicht. Alles
     jenseits von SATZ_MAX_MM landet zu dicht am Rand, auch wenn die Seite
     technisch noch nicht umbricht – die Seitenzahl allein reicht als
     Kontrolle also nicht. */
  const SATZ_MAX_MM = 285;

  const index = [];
  let warnungen = 0;
  for (const r of auswahl) {
    const { buf, seiten, endeS1mm, endeS2mm, fussnoteAbMm } = await briefPdf(r, imgs);
    const kurz = String(r.FIRMENNAME).slice(0, 40);
    if (seiten !== 2) {
      console.log(`  ⚠ ${r.TOKEN} ${kurz}: ${seiten} Seiten statt 2 — Layout prüfen.`);
      warnungen++;
    } else if (endeS1mm > SATZ_MAX_MM) {
      console.log(`  ⚠ ${r.TOKEN} ${kurz}: Seite 1 endet bei ${endeS1mm.toFixed(0)} mm `
        + `(Grenze ${SATZ_MAX_MM} mm) — zu dicht am Rand.`);
      warnungen++;
    } else if (endeS2mm > fussnoteAbMm - 3) {
      /* Der Grußblock darf nicht in die Fußnote laufen. */
      console.log(`  ⚠ ${r.TOKEN} ${kurz}: Grußblock endet bei ${endeS2mm.toFixed(0)} mm, `
        + `Fußnote beginnt bei ${fussnoteAbMm.toFixed(0)} mm — Überlappung auf Seite 2.`);
      warnungen++;
    }
    const safe = String(r.FIRMENNAME).replace(/[^\wÄÖÜäöüß -]/g, '').trim().slice(0, 48);
    const datei = path.join(OUT_DIR, `${r.TOKEN}_${safe}.pdf`);
    fs.writeFileSync(datei, buf);
    index.push({
      token: r.TOKEN, firma: r.FIRMENNAME, mastr: r.MASTR_SEE,
      welle: r.WELLE, prio: r.PRIO_RANG, seiten,
      satzende_mm: Math.round(endeS1mm),
      datei: path.relative(ROOT, datei),
      bytes: buf.length,
    });
  }

  /* Index zusammenführen statt ersetzen: ein Nachdruck einzelner Briefe
     (--token / --limit) darf die Liste der übrigen nicht löschen, sonst
     verschickt send-letterxpress.js hinterher nur noch den Nachdruck. */
  const indexPfad = path.join(OUT_DIR, '_index.json');
  let bestand = [];
  if (fs.existsSync(indexPfad)) {
    try { bestand = JSON.parse(fs.readFileSync(indexPfad, 'utf8')); }
    catch (e) { console.log(`⚠ _index.json nicht lesbar (${e.message}) — wird neu angelegt.`); }
  }
  const nachToken = new Map(bestand.map(e => [e.token, e]));
  index.forEach(e => nachToken.set(e.token, e));
  const gesamt = [...nachToken.values()].sort((a, b) => (a.prio || 0) - (b.prio || 0));
  fs.writeFileSync(indexPfad, JSON.stringify(gesamt, null, 2), 'utf8');

  console.log(`\n✓ ${index.length} PDF(s) geschrieben, Index: ${path.relative(ROOT, indexPfad)}`
    + ` (${gesamt.length} Briefe gesamt)`);
  if (warnungen) console.log(`  ${warnungen} Brief(e) auffällig — vor dem Versand einzeln ansehen.`);
  console.log('  Nächster Schritt: node scripts/send-letterxpress.js --dry-run');
})().catch(err => {
  console.error('FEHLER:', err);
  process.exitCode = 1;
});
