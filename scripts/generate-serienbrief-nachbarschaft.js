/**
 * Serienbrief „Nachbarschaft Eichstätt" – Word-Vorlage (.docx)
 *
 * 1:1 Layout-Klon von Drohne/Serienbrief_Gewaehrleistung_NEU.docx
 * (Brand-Grün #1B5E20, Arial, 4 Fehlerbilder, QR-Codes), inhaltlich umgebaut
 * auf den Nachbarschafts-Aufhänger:
 *   < 500 kWp → Anfahrtspauschale 95 € statt 190 €
 *   ≥ 500 kWp → Anfahrt entfällt komplett (0 €)
 *
 * Datenquelle für Word-Mail-Merge: Sheet „Nachbarschaft_Eichstaett" in
 * Anschreiben/KolibriInspect_PV_Leads.xlsx.
 *
 * Aufruf:  node scripts/generate-serienbrief-nachbarschaft.js
 */

const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, VerticalAlign, PageBreak,
} = require('docx');
const fs     = require('fs');
const path   = require('path');
const QRCode = require('qrcode');

const BRAND     = '1B5E20';                      // dunkles Kolibri-Grün
const LIGHT_GRN = 'C6E0B4';
const SUN       = 'F0C000';
const SUN_BG    = 'FFFBE6';
const GRAY      = '666666';
const DIM       = 'AAAAAA';

const ROOT   = path.resolve(__dirname, '..');
const BILDER = path.join(ROOT, 'Bilder');
const OUT    = path.join(ROOT, 'Anschreiben', 'Serienbrief_Nachbarschaft.docx');

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
  /* QR-Codes – direkt auf Bestell-Formular */
  const qrAuftrag = await QRCode.toBuffer(
    'https://www.kolibri-inspect.de/angebot.html',
    { color: { dark: '#1B5E20', light: '#FFFFFF' }, width: 160, margin: 1 });
  const qrTel = await QRCode.toBuffer('tel:+491791599311',
    { color: { dark: '#1B5E20', light: '#FFFFFF' }, width: 160, margin: 1 });

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
          children: [T('Kolibri Inspect · TGA Plöchinger GmbH · Passauer Str. 20 · 94121 Salzweg', { size: 16, color: GRAY })],
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
            T('Drohnen-Thermografie für Ihre PV-Anlage in ', { bold: true, color: BRAND }),
            F('ORT_ANLAGE'),
            T(' (', { bold: true, color: BRAND }),
            F('LEISTUNG_KWP'),
            T(' kWp)', { bold: true, color: BRAND }),
          ],
        }),
        new Paragraph({
          spacing: { after: 300 },
          children: [T('Aktion „Nachbarschaft Eichstätt" – wir sind ohnehin in Ihrer Region',
            { bold: true, color: BRAND })],
        }),

        /* Anrede */
        new Paragraph({
          spacing: { after: 180 },
          children: [F('ANREDE'), T(',')],
        }),

        /* ══ ABSATZ 1 – AUFHÄNGER NACHBARSCHAFT ══ */
        new Paragraph({
          spacing: { after: 120 },
          children: [
            T('als Ingenieurbetrieb für Drohnen-Thermografie führen wir im Aktionszeitraum eine ' +
              'planmäßige Befliegung in Eichstätt durch. Ihre Anlage in '),
            F('ORT_ANLAGE'),
            T(' ('),
            F('LEISTUNG_KWP'),
            T(' kWp) liegt im direkten Einsatzradius unseres Piloten – wir wären ohnehin mit ' +
              'vollständiger Mess-Ausstattung in Ihrer Nachbarschaft vor Ort.'),
          ],
        }),
        new Paragraph({
          spacing: { after: 180 },
          children: [
            T('Anfahrt sparen – wir fliegen bei Ihnen mit. ', { bold: true, color: BRAND }),
            T('Auf die übliche Anfahrtspauschale von 190 € verzichten wir für Ihre Anlage im Rahmen ' +
              'der Aktion „Nachbarschaft Eichstätt": '),
            T('< 500 kWp', { bold: true }),
            T(' nur 95 €, '),
            T('ab 500 kWp', { bold: true }),
            T(' entfällt die Anfahrt vollständig. Die Inspektion erfolgt im laufenden Betrieb – ' +
              'ohne Anlagenstillstand und ohne Ertragsausfall.'),
          ],
        }),

        /* ══ ABSATZ 3 – DATENLAGE BULLETS ══ */
        new Paragraph({
          spacing: { before: 80, after: 80 },
          children: [T('Warum eine Inspektion sinnvoll ist – unabhängig vom Anlagenalter:', { bold: true })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          indent: { left: 300 },
          children: [
            new TextRun({ text: '› ', color: BRAND, font: 'Arial', size: 19, bold: true }),
            T('IEA PVPS Task 13 (T13-30:2025)', { bold: true, size: 19 }),
            T(': Ca. 5 % aller dokumentierten Moduldefekte gehen auf Transport- und ' +
              'Installationsschäden zurück – ausgewertet aus über 100 Anlagen weltweit.', { size: 19 }),
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

        /* ══ ABSATZ 4 – Was die Thermografie zeigt ══ */
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

        /* Hinweis */
        new Paragraph({
          spacing: { before: 100, after: 0 },
          children: [T('Hinweis: Wir liefern die technische Befundgrundlage – keine Rechtsberatung. ' +
            'Bei Anlagen innerhalb der Errichter-Gewährleistung kann der Befund unmittelbar als ' +
            'Mängelnachweis verwendet werden.',
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
          children: [T('Ihr Aktionsangebot „Nachbarschaft Eichstätt"', { bold: true, color: BRAND, size: 26 })],
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
            shading: { type: ShadingType.SOLID, color: 'F2F8EE', fill: 'F2F8EE' },
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
                    'Aktionscode oben eintragen – die Anfahrt wird automatisch reduziert bzw. entfällt.',
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
                new Paragraph({ spacing: { after: 40 }, children: [T('0151 / 560 549 11')] }),
                new Paragraph({ spacing: { after: 0 },  children: [T('Online beauftragen mit Aktionscode '),
                  T('NACHBAR-EI-2026', { bold: true, color: BRAND })] }),
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
          children: [T('Kolibri Inspect | TGA Plöchinger GmbH | Passauer Str. 20, 94121 Salzweg | info@kolibri-inspect.de',
            { size: 14, color: GRAY })],
        }),
        new Paragraph({
          spacing: { before: 60 },
          alignment: AlignmentType.CENTER,
          children: [T('Quellen: IEA PVPS Task 13 Report T13-30:2025; TÜV Rheinland/DB Schenker Logistikstudie PV-Module',
            { italic: true, size: 14, color: DIM })],
        }),

      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buf);
  console.log('✓ Serienbrief erstellt:', OUT);
  console.log('  Datenquelle: Sheet „Nachbarschaft_Eichstaett" in Anschreiben/KolibriInspect_PV_Leads.xlsx');
}

generate().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
