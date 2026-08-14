/**
 * Serienbrief „Saisonabschluss 2026" (PLZ 94) – Word-Vorlage (.docx)
 *
 * Layout-Klon von scripts/generate-serienbrief-nachbarschaft.js (Farben und Layout,
 * Arial, 4 Fehlerbilder, QR-Codes, Preistabelle). Inhaltlich auf zwei Fristen
 * umgebaut, die der Empfänger nicht verschieben kann:
 *
 *   1) Ende der Errichter-Mängelhaftung (§ 634a Abs. 1 Nr. 2 BGB, 5 Jahre) –
 *      individuell aus dem MaStR-Inbetriebnahmedatum gerechnet.
 *   2) Messfenster der Saison: DIN EN IEC 62446-3 verlangt ≥ 600 W/m²
 *      Einstrahlung, in Niederbayern schließt das Fenster Ende Oktober.
 *
 * Der Nachbarschafts-Satz („wir fliegen ohnehin eine benachbarte Anlage") wird
 * bewusst NICHT übernommen – in PLZ 94 steht kein Auftrag an, die Aussage wäre
 * unwahr. Der Preis-Hebel wird stattdessen mit dem Firmensitz Salzweg begründet.
 *
 * Datenquelle für Word-Mail-Merge: Sheet „Heimat_PLZ94" in
 * Anschreiben/KolibriInspect_PV_Leads_PLZ94.xlsx, gefiltert auf WELLE = 1.
 *
 * Aufruf:  node scripts/generate-serienbrief-heimat94.js
 */

const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, VerticalAlign, PageBreak,
} = require('docx');
const fs     = require('fs');
const path   = require('path');
const QRCode = require('qrcode');

/* Farben wie im PDF-Pfad: Teal der Website (--teal in index.html), nicht
   mehr das alte Forstgrün. Brief und Landingpage sollen zusammenpassen. */
const BRAND     = '167E74';
const LIGHT_GRN = 'EFF5F3';
const GRAY      = '666666';
const DIM       = 'AAAAAA';

const ROOT   = path.resolve(__dirname, '..');
const BILDER = path.join(ROOT, 'Bilder');
const OUT    = path.join(ROOT, 'Anschreiben', 'Serienbrief_Heimat94.docx');

/* Absender – Vertragspartner laut AGB/Impressum */
const ABSENDER_ZEILE = 'Kolibri Inspect · TGA Plöchinger GmbH · Passauer Str. 20 · 94121 Salzweg';
const ABSENDER_FOOT  = 'Kolibri Inspect | TGA Plöchinger GmbH | Passauer Str. 20, 94121 Salzweg | info@kolibri-inspect.de';
const TELEFON        = '+49 179 1599311';
const TELEFON_URI    = 'tel:+491791599311';

const AKTIONSCODE = 'SAISON-94-2026';
const REF_TAG     = 'saison-94-2026';

const NO_BORDER = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};
const NO_BORDER_TABLE = {
  top:    { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left:   { style: BorderStyle.NONE }, right:  { style: BorderStyle.NONE },
  insideH:{ style: BorderStyle.NONE }, insideV:{ style: BorderStyle.NONE },
};

/* Text-Helper */
function T(text, o = {}) {
  return new TextRun({
    text,
    font: 'Arial',
    size:    o.size  || 22,        // 22 half-points = 11pt
    bold:    !!o.bold,
    italics: !!o.italic,
    color:   o.color || '000000',
  });
}
/* Mail-Merge-Feld (Word ersetzt «...» beim Seriendruck) */
function F(name, size) {
  return new TextRun({ text: `«${name}»`, font: 'Arial', size: size || 22, color: BRAND });
}

async function generate() {
  /* QR-Codes – Aktionscode direkt im Deeplink, damit der Rabatt im Formular steht */
  const qrAuftrag = await QRCode.toBuffer(
    `https://www.kolibri-inspect.de/angebot.html?promo=${AKTIONSCODE}&ref=${REF_TAG}`,
    { color: { dark: '#167E74', light: '#FFFFFF' }, width: 600, margin: 4,
      errorCorrectionLevel: 'Q' });
  const qrTel = await QRCode.toBuffer(TELEFON_URI,
    { color: { dark: '#167E74', light: '#FFFFFF' }, width: 600, margin: 4,
      errorCorrectionLevel: 'Q' });

  /* Fehlerbilder */
  const imgZ = fs.readFileSync(path.join(BILDER, 'Zellfehler.PNG'));
  const imgD = fs.readFileSync(path.join(BILDER, 'Diodenfehler.PNG'));
  const imgS = fs.readFileSync(path.join(BILDER, 'Stringfehler.PNG'));
  const imgV = fs.readFileSync(path.join(BILDER, 'Verschmutzung.PNG'));

  function imgCell(data, label) {
    return new TableCell({
      borders: NO_BORDER,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new ImageRun({ data, transformation: { width: 115, height: 78 }, type: 'png' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [T(label, { size: 16, color: GRAY })],
        }),
      ],
    });
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1000, right: 1300, bottom: 1000, left: 1300 } },
      },
      children: [

        /* ══ KOPF ══ */
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: NO_BORDER_TABLE,
          rows: [new TableRow({ children: [
            new TableCell({
              width: { size: 55, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              children: [
                new Paragraph({ children: [T('KOLIBRI INSPECT', { bold: true, color: BRAND, size: 26 })] }),
                new Paragraph({ children: [T('TGA Plöchinger GmbH', { size: 18 })] }),
                new Paragraph({ spacing: { after: 0 }, children: [
                  T('Passauer Str. 20 · 94121 Salzweg · info@kolibri-inspect.de', { size: 16, color: GRAY }),
                ]}),
              ],
            }),
            new TableCell({
              width: { size: 45, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              children: [
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  T('Drohnen-Thermografie', { bold: true, color: BRAND, size: 20 }),
                ]}),
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  T('für Photovoltaikanlagen', { bold: true, color: BRAND, size: 20 }),
                ]}),
                new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  T('www.kolibri-inspect.de', { size: 16, color: GRAY }),
                ]}),
              ],
            }),
          ]})],
        }),

        /* Trennlinie grün */
        new Paragraph({
          spacing: { before: 120, after: 200 },
          border: { bottom: { color: BRAND, space: 4, style: BorderStyle.SINGLE, size: 8 } },
          children: [],
        }),

        /* Absender-Kurzzeile */
        new Paragraph({
          spacing: { after: 60 },
          children: [T(ABSENDER_ZEILE, { size: 16, color: GRAY })],
        }),

        /* ══ EMPFÄNGER ══ */
        new Paragraph({ spacing: { after: 20 }, children: [F('FIRMENNAME')] }),
        new Paragraph({ spacing: { after: 20 }, children: [F('ANSPRECHPARTNER')] }),
        new Paragraph({ spacing: { after: 20 }, children: [F('STRASSE_HAUSNR')] }),
        new Paragraph({ spacing: { after: 300 }, children: [F('PLZ'), T(' '), F('ORT')] }),

        /* Datum rechtsbündig */
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 300 },
          children: [T('Salzweg, ', { size: 18, color: GRAY }), F('DATUM')],
        }),

        /* ══ BETREFF ══ */
        new Paragraph({
          spacing: { after: 0 },
          children: [
            T('Ihre PV-Anlage in ', { bold: true, color: BRAND }),
            F('ORT_ANLAGE'),
            T(' (', { bold: true, color: BRAND }),
            F('LEISTUNG_KWP'),
            T(' kWp): Mängelhaftung endet ', { bold: true, color: BRAND }),
            F('GW_ENDE_MONAT'),
          ],
        }),
        new Paragraph({
          spacing: { after: 300 },
          children: [T('Befund vor Fristablauf – Messfenster der Saison schließt Ende Oktober',
            { bold: true, color: BRAND })],
        }),

        /* Anrede */
        new Paragraph({
          spacing: { after: 180 },
          children: [F('ANREDE'), T(',')],
        }),

        /* ══ ABSATZ 1 – AUFHÄNGER GEWÄHRLEISTUNGSENDE ══ */
        new Paragraph({
          spacing: { after: 120 },
          children: [
            T('nach den Daten des Marktstammdatenregisters wurde Ihre Anlage in '),
            F('ORT_ANLAGE'),
            T(' im '),
            F('IBN_MONAT_JAHR'),
            T(' in Betrieb genommen. Die gesetzliche Mängelhaftung Ihres Errichters ' +
              '(§ 634a Abs. 1 Nr. 2 BGB, fünf Jahre ab Abnahme) endet damit voraussichtlich im '),
            F('GW_ENDE_MONAT'),
            T(' – in rund '),
            F('MONATE_BIS_GW_ENDE'),
            T(' Monaten.'),
          ],
        }),
        new Paragraph({
          spacing: { after: 180 },
          children: [
            T('Bis dahin trägt Ihr Errichter die Kosten für Modulfehler, die bereits bei Übergabe ' +
              'angelegt waren. Danach tragen Sie sie. '),
            T('Wer einen Anspruch geltend machen will, braucht einen Befund, der die Fehler benennt, ' +
              'lokalisiert und datiert – vor Fristablauf.', { bold: true }),
          ],
        }),

        /* ══ ABSATZ 2 – ZWEITE FRIST: MESSFENSTER ══ */
        new Paragraph({
          spacing: { after: 180 },
          children: [
            T('Zweite Frist, technisch bedingt: ', { bold: true, color: BRAND }),
            T('Eine normgerechte Thermografie nach DIN EN IEC 62446-3 setzt mindestens 600 W/m² ' +
              'Einstrahlung voraus. In Niederbayern schließt dieses Messfenster Ende Oktober und ' +
              'öffnet erst im März wieder. Für Anlagen, deren Frist vor dem Frühjahr abläuft, ist ' +
              'diese Saison die letzte Gelegenheit.'),
          ],
        }),

        /* ══ ABSATZ 3 – PREIS-HEBEL HEIMATREGION ══ */
        new Paragraph({
          spacing: { after: 180 },
          children: [
            T('Wir sind Ihre Nachbarn. ', { bold: true, color: BRAND }),
            T('Unser Ingenieurbüro sitzt in Salzweg – Ihre Anlage liegt in unserem Heimatgebiet. ' +
              'Auf die übliche Anfahrtspauschale von 190 € verzichten wir deshalb weitgehend: '),
            T('unter 500 kWp', { bold: true }),
            T(' nur 95 €, '),
            T('ab 500 kWp', { bold: true }),
            T(' entfällt sie vollständig. Die Inspektion erfolgt im laufenden Betrieb – ' +
              'ohne Anlagenstillstand und ohne Ertragsausfall.'),
          ],
        }),

        /* ══ ABSATZ 4 – DATENLAGE BULLETS ══ */
        new Paragraph({
          spacing: { before: 80, after: 80 },
          children: [T('Warum gerade vor Fristablauf:', { bold: true })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 300 },
          children: [
            new TextRun({ text: '› ', color: BRAND, font: 'Arial', size: 19, bold: true }),
            T('IEA PVPS Task 13 (T13-30:2025)', { bold: true, size: 19 }),
            T(': Ca. 5 % aller dokumentierten Moduldefekte gehen auf Transport- und ' +
              'Installationsschäden zurück – ausgewertet aus über 100 Anlagen weltweit. ' +
              'Genau diese Schäden fallen in die Verantwortung des Errichters.', { size: 19 }),
          ],
        }),
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 300 },
          children: [
            new TextRun({ text: '› ', color: BRAND, font: 'Arial', size: 19, bold: true }),
            T('TÜV Rheinland / DB Schenker', { bold: true, size: 19 }),
            T(': 5–10 % der Module wiesen nach Anlieferung Mikrorisse auf (Elektrolumineszenz-Test) – ' +
              'visuell nicht erkennbar, führen unter Betriebslast zu dauerhaftem Ertragsverlust.', { size: 19 }),
          ],
        }),
        new Paragraph({
          spacing: { after: 150 },
          indent: { left: 300 },
          children: [
            new TextRun({ text: '› ', color: BRAND, font: 'Arial', size: 19, bold: true }),
            T('Konkret für Ihre Anlage: Bei ', { size: 19 }),
            F('ANZAHL_MODULE', 19),
            T(' Modulen statistisch mehrere Dutzend potenziell betroffen – ' +
              'verteilt auf viele Strings, im laufenden Betrieb kaum messbar.', { size: 19 }),
          ],
        }),

        /* ══ ABSATZ 5 – Was die Thermografie zeigt ══ */
        new Paragraph({
          spacing: { after: 160 },
          children: [
            T('Unsere Drohne erfasst unter Betriebslast die Oberflächentemperatur jedes einzelnen Moduls. ' +
              'Hotspots, defekte Bypass-Dioden, Stringausfälle und Verschmutzungen werden georeferenziert ' +
              'dokumentiert. Sie erhalten einen Befundbericht (PDF) mit Schweregrad-Klassifikation A/B/C ' +
              'und priorisierten Handlungsempfehlungen – einsetzbar als Grundlage für Mängelansprüche, ' +
              'Versicherungsmeldungen oder Wartungsaufträge.'),
          ],
        }),

        /* ══ FEHLERBILDER (4 Spalten) ══ */
        new Paragraph({
          spacing: { before: 80, after: 80 },
          children: [T('Typische Befunde – nur per Infrarot-Thermografie erkennbar:',
            { bold: true, size: 19, color: BRAND })],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: NO_BORDER_TABLE,
          rows: [new TableRow({ children: [
            imgCell(imgZ, 'Zellfehler / Hot-Spot'),
            imgCell(imgD, 'Defekte Bypass-Diode'),
            imgCell(imgS, 'Stringausfall'),
            imgCell(imgV, 'Lokale Verschmutzung'),
          ]})],
        }),

        /* Hinweis – Fristangabe ist eine Schätzung, keine Rechtsberatung */
        new Paragraph({
          spacing: { before: 100, after: 0 },
          children: [T('Hinweis: Wir liefern die technische Befundgrundlage – keine Rechtsberatung. ' +
            'Die genannte Frist ist aus dem im Marktstammdatenregister hinterlegten ' +
            'Inbetriebnahmedatum errechnet; maßgeblich für § 634a BGB ist die Abnahme, die davon ' +
            'abweichen kann. Bitte prüfen Sie das Datum anhand Ihres Abnahmeprotokolls.',
            { italic: true, size: 16, color: GRAY })],
        }),

        /* ══ SEITE 2 – ANGEBOT ══ */
        new Paragraph({ spacing: { before: 0, after: 0 }, children: [new PageBreak()] }),

        new Paragraph({
          spacing: { after: 160 },
          border: { bottom: { color: BRAND, space: 4, style: BorderStyle.SINGLE, size: 12 } },
          children: [],
        }),

        new Paragraph({
          spacing: { after: 40 },
          children: [T('Ihr Aktionsangebot „Saisonabschluss 2026"', { bold: true, color: BRAND, size: 26 })],
        }),
        new Paragraph({
          spacing: { after: 200 },
          children: [
            F('LEISTUNG_KWP'), T(' kWp  ·  ', { color: GRAY, size: 20 }),
            F('ANZAHL_MODULE'), T(' Module  ·  Standort ', { color: GRAY, size: 20 }),
            F('ORT_ANLAGE', 20),
          ],
        }),

        /* Preistabelle */
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          columnWidths: [5500, 1800, 1800],
          rows: [
            /* Header */
            new TableRow({ tableHeader: true, children: [
              new TableCell({
                shading: { type: ShadingType.SOLID, color: BRAND, fill: BRAND },
                margins: { top: 80, bottom: 80, left: 100, right: 100 },
                children: [new Paragraph({ children: [T('Leistung', { bold: true, color: 'FFFFFF', size: 20 })] })],
              }),
              new TableCell({
                shading: { type: ShadingType.SOLID, color: BRAND, fill: BRAND },
                margins: { top: 80, bottom: 80, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  T('Listenpreis', { bold: true, color: 'FFFFFF', size: 20 })] })],
              }),
              new TableCell({
                shading: { type: ShadingType.SOLID, color: BRAND, fill: BRAND },
                margins: { top: 80, bottom: 80, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  T('Aktion', { bold: true, color: 'FFFFFF', size: 20 })] })],
              }),
            ]}),
            /* Anfahrt */
            new TableRow({ children: [
              new TableCell({ margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [
                new Paragraph({ children: [T('Anfahrtspauschale', { size: 20 })] }),
                new Paragraph({ children: [T('(< 500 kWp: 95 € · ab 500 kWp: 0 €)', { size: 16, color: GRAY, italic: true })] }),
              ] }),
              new TableCell({ margins: { top: 60, bottom: 60, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [T('190,00 €', { size: 20 })] })] }),
              new TableCell({ margins: { top: 60, bottom: 60, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  F('PAUSCHALE', 20), T(' €', { size: 20, bold: true, color: BRAND }),
                ]})] }),
            ]}),
            /* Thermografie */
            new TableRow({ children: [
              new TableCell({ margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [
                T('Thermografie-Inspektion: ', { size: 20 }), F('ANZAHL_MODULE', 20),
                T(' Module à ', { size: 20 }), F('PREIS_PRO_MODUL', 20), T(' €', { size: 20 }),
              ]})] }),
              new TableCell({ margins: { top: 60, bottom: 60, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT,
                  children: [F('PREIS_MODULE', 20), T(' €', { size: 20 })] })] }),
              new TableCell({ margins: { top: 60, bottom: 60, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT,
                  children: [F('PREIS_MODULE', 20), T(' €', { size: 20 })] })] }),
            ]}),
            /* Inkl.-Zeile */
            new TableRow({ children: [
              new TableCell({ margins: { top: 40, bottom: 40, left: 100, right: 100 }, children: [new Paragraph({ children: [
                T('Befundbericht (georef. Thermogramme + Handlungsempfehlung)', { italic: true, size: 18, color: GRAY }),
              ]})] }),
              new TableCell({ margins: { top: 40, bottom: 40, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT,
                  children: [T('inklusive', { italic: true, size: 18, color: GRAY })] })] }),
              new TableCell({ margins: { top: 40, bottom: 40, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT,
                  children: [T('inklusive', { italic: true, size: 18, color: GRAY })] })] }),
            ]}),
            /* Gesamt */
            new TableRow({ children: [
              new TableCell({
                shading: { type: ShadingType.SOLID, color: LIGHT_GRN, fill: LIGHT_GRN },
                margins: { top: 80, bottom: 80, left: 100, right: 100 },
                children: [new Paragraph({ children: [T('Gesamt netto zzgl. MwSt.', { bold: true, size: 22 })] })],
              }),
              new TableCell({
                shading: { type: ShadingType.SOLID, color: LIGHT_GRN, fill: LIGHT_GRN },
                margins: { top: 80, bottom: 80, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  F('PREIS_NETTO_LISTE', 22), T(' €', { bold: true, size: 22 }),
                ]})],
              }),
              new TableCell({
                shading: { type: ShadingType.SOLID, color: LIGHT_GRN, fill: LIGHT_GRN },
                margins: { top: 80, bottom: 80, left: 60, right: 100 },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
                  F('PREIS_NETTO', 22), T(' €', { bold: true, size: 22, color: BRAND }),
                ]})],
              }),
            ]}),
          ],
        }),

        /* Ersparnis */
        new Paragraph({
          spacing: { before: 140, after: 60 },
          children: [
            T('Ihre Ersparnis gegenüber Listenpreis: ', { bold: true, color: BRAND }),
            F('ERSPARNIS'), T(' € ', { bold: true, color: BRAND }),
            T('– Aktion gültig bis ', { color: BRAND }),
            F('AKTION_BIS'), T('.', { color: BRAND }),
          ],
        }),

        /* ══ DIREKT-BEAUFTRAGEN-CTA – Code prominent als Coupon-Block ══ */
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top:    { style: BorderStyle.SINGLE, size: 8,  color: BRAND },
            bottom: { style: BorderStyle.SINGLE, size: 8,  color: BRAND },
            left:   { style: BorderStyle.SINGLE, size: 24, color: BRAND },
            right:  { style: BorderStyle.SINGLE, size: 8,  color: BRAND },
            insideH:{ style: BorderStyle.NONE }, insideV:{ style: BorderStyle.NONE },
          },
          rows: [new TableRow({ children: [new TableCell({
            shading: { type: ShadingType.SOLID, color: 'EFF5F3', fill: 'EFF5F3' },
            margins: { top: 110, bottom: 110, left: 200, right: 200 },
            children: [
              new Paragraph({
                spacing: { after: 80 },
                children: [T('Direkt online beauftragen – mit Aktionscode',
                  { bold: true, color: BRAND, size: 22 })],
              }),
              new Paragraph({
                spacing: { after: 80 },
                alignment: AlignmentType.CENTER,
                children: [
                  T(' ', { size: 26 }),
                  F('AKTIONSCODE', 36),
                  T(' ', { size: 26 }),
                ],
              }),
              new Paragraph({
                spacing: { after: 0 },
                children: [
                  T('Auf ', { size: 18 }),
                  T('www.kolibri-inspect.de/angebot.html', { size: 18, bold: true, color: BRAND }),
                  T(' das Formular in 5 Schritten ausfüllen. In Schritt 4 (Angebots-Vorschau) den ' +
                    'Aktionscode oben eintragen – die Anfahrt wird automatisch reduziert bzw. entfällt. ' +
                    'Über den QR-Code rechts ist er bereits hinterlegt.',
                    { size: 18 }),
                ],
              }),
            ],
          })] })],
        }),

        new Paragraph({
          spacing: { before: 140, after: 240 },
          children: [T(
            'Es gelten unsere AGB (www.kolibri-inspect.de/agb.html). Preise netto zzgl. MwSt. · ' +
            'Modul-Staffel: ≤500 0,80 €/Mod. | ≤1.500 0,70 € | ≤3.000 0,60 € | ≤5.000 0,50 € | >5.000 0,40 €',
            { size: 16, color: DIM })],
        }),

        /* ══ GRUSSFORMEL ══ */
        new Paragraph({ children: [T('Mit freundlichen Grüßen')] }),
        new Paragraph({ spacing: { after: 500 }, children: [] }),
        new Paragraph({ children: [T('Dipl.-Ing. Friedrich Plöchinger', { bold: true })] }),
        new Paragraph({ spacing: { after: 280 }, children: [T('Kolibri Inspect', { color: BRAND })] }),

        /* ══ KONTAKTBLOCK + QR-CODES ══ */
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: NO_BORDER_TABLE,
          rows: [new TableRow({ children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({ spacing: { after: 60 }, children: [T('So erreichen Sie mich:', { bold: true })] }),
                new Paragraph({ spacing: { after: 40 }, children: [T('info@kolibri-inspect.de')] }),
                new Paragraph({ spacing: { after: 40 }, children: [T(TELEFON)] }),
                new Paragraph({ spacing: { after: 0 },  children: [T('Online beauftragen mit Aktionscode '),
                  T(AKTIONSCODE, { bold: true, color: BRAND })] }),
              ],
            }),
            new TableCell({
              width: { size: 25, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              children: [
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [
                  new ImageRun({ data: qrAuftrag, transformation: { width: 75, height: 75 }, type: 'png' }),
                ]}),
                new Paragraph({ alignment: AlignmentType.CENTER,
                  children: [T('Direkt beauftragen', { size: 16, color: GRAY })] }),
              ],
            }),
            new TableCell({
              width: { size: 25, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              children: [
                new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [
                  new ImageRun({ data: qrTel, transformation: { width: 75, height: 75 }, type: 'png' }),
                ]}),
                new Paragraph({ alignment: AlignmentType.CENTER, children: [T('Direkt anrufen', { size: 16, color: GRAY })] }),
              ],
            }),
          ]})],
        }),

        /* Footer */
        new Paragraph({
          spacing: { before: 200 },
          alignment: AlignmentType.CENTER,
          border: { top: { color: DIM, space: 4, style: BorderStyle.SINGLE, size: 4 } },
          children: [T(ABSENDER_FOOT, { size: 14, color: GRAY })],
        }),
        new Paragraph({
          spacing: { before: 60 },
          alignment: AlignmentType.CENTER,
          children: [T('Quellen: IEA PVPS Task 13 Report T13-30:2025; TÜV Rheinland/DB Schenker Logistikstudie PV-Module; ' +
            'DIN EN IEC 62446-3; Inbetriebnahmedaten: Marktstammdatenregister (BNetzA)',
            { italic: true, size: 14, color: DIM })],
        }),

      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buf);
  console.log('✓ Serienbrief erstellt:', OUT);
  console.log('  Datenquelle: Sheet „Heimat_PLZ94" in Anschreiben/KolibriInspect_PV_Leads_PLZ94.xlsx');
  console.log('  Seriendruck in Word auf WELLE = 1 filtern.');
}

generate().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
