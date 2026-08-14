/**
 * Erzeugt: Bestellung_KolibriInspect.docx
 * Einseitige B2B-Bestellung im KolibriInspect-CI mit Verweis auf die AGB.
 *
 * Aufruf:  node scripts/generate-bestellung-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  HeightRule, TabStopType, TabStopPosition, PageOrientation, convertMillimetersToTwip,
} = require('docx');

/* ---------- CI ---------- */
const TEAL    = '167E74';
const TEAL_M  = '1DA897';
const SUN     = 'F0C000';
const TEXT    = '151515';
const MUTED   = '5C6770';
const BORDER  = 'D8DEE2';
const BG_SOFT = 'F2F6F5';

const FONT_HEAD = 'Calibri';   // Poppins-nahe System-Fallback
const FONT_BODY = 'Calibri';

const ROOT = path.resolve(__dirname, '..');
const LOGO = path.join(ROOT, 'Bilder', 'Logo', 'Logo.png');
const OUT  = path.join(ROOT, 'Bestellung_KolibriInspect.docx');

/* ---------- Helpers ---------- */
const noBorders = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const lineBorders = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
  insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: BORDER },
};

function txt(text, opts = {}) {
  return new TextRun({
    text,
    font: opts.font || FONT_BODY,
    size: opts.size || 18,           // halb-points (18 = 9pt)
    bold: !!opts.bold,
    italics: !!opts.italic,
    color: opts.color || TEXT,
    allCaps: !!opts.caps,
    characterSpacing: opts.tracking,
  });
}

function p(children, opts = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align,
    spacing: { before: opts.before || 0, after: opts.after || 0, line: opts.line || 240 },
    indent: opts.indent,
  });
}

function sectionTitle(text) {
  return p(
    [txt(text, { font: FONT_HEAD, size: 16, bold: true, color: TEAL, caps: true, tracking: 30 })],
    { before: 140, after: 60 }
  );
}

function fieldCell(label, opts = {}) {
  return new TableCell({
    width: { size: opts.width || 50, type: WidthType.PERCENTAGE },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: { type: ShadingType.CLEAR, fill: 'FFFFFF' },
    children: [
      p([txt(label, { size: 13, bold: true, color: MUTED, caps: true, tracking: 20 })], { after: 10 }),
      p([txt(' ', { size: 18 })], { after: 0 }),
    ],
  });
}

function fieldRow(cells) {
  return new TableRow({
    height: { value: 600, rule: HeightRule.ATLEAST },
    children: cells,
  });
}

function fieldsTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: lineBorders,
    rows,
  });
}

/* ---------- Header (Logo + Markenzeile + Bestellnummer-Box) ---------- */
function buildHeader() {
  const logoBuf = fs.readFileSync(LOGO);

  const left = new TableCell({
    width: { size: 60, type: WidthType.PERCENTAGE },
    borders: noBorders,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new ImageRun({
            data: logoBuf,
            transformation: { width: 130, height: 38 },
          }),
        ],
      }),
      p([txt('Drohnen-Thermografie · KI-Auswertung · DGUV-konform',
        { size: 14, color: MUTED })]),
    ],
  });

  const right = new TableCell({
    width: { size: 40, type: WidthType.PERCENTAGE },
    borders: noBorders,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    shading: { type: ShadingType.CLEAR, fill: BG_SOFT },
    children: [
      p([txt('Bestellung', { font: FONT_HEAD, size: 26, bold: true, color: TEAL })],
        { align: AlignmentType.RIGHT }),
      p([txt('Einmalige Drohnen-Thermografie-Inspektion',
        { size: 14, color: MUTED })], { align: AlignmentType.RIGHT, after: 60 }),
      p([
        txt('Bestell-Nr.: ', { size: 13, color: MUTED }),
        txt('______________   ', { size: 13, bold: true }),
        txt('Datum: ', { size: 13, color: MUTED }),
        txt('___________', { size: 13, bold: true }),
      ], { align: AlignmentType.RIGHT }),
    ],
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [new TableRow({ children: [left, right] })],
  });
}

/* ---------- Aufbau Dokument ---------- */
const headerTable = buildHeader();

const intro = p(
  [txt(
    'Hiermit beauftragen wir die TGA Plöchinger GmbH (handelnd unter „KolibriInspect", Geschäftsführer: Dipl.-Ing. (FH) Friedrich Plöchinger) verbindlich mit der einmaligen Drohnen-Thermografie-Inspektion der nachfolgend benannten PV-Anlage zum vereinbarten Nettopreis zzgl. gesetzl. MwSt.',
    { size: 17, color: TEXT }
  )],
  { before: 160, after: 100, line: 280 }
);

/* Auftraggeber / Rechnungsadresse */
const auftraggeber = fieldsTable([
  fieldRow([fieldCell('Firma / Auftraggeber'), fieldCell('Ansprechpartner')]),
  fieldRow([fieldCell('Straße & Hausnr. (Rechnungsadresse)'), fieldCell('PLZ / Ort')]),
  fieldRow([fieldCell('USt-IdNr. / Steuer-Nr.'), fieldCell('Telefon')]),
  fieldRow([fieldCell('E-Mail (für Rechnung & Bericht)'), fieldCell('Abweich. Lieferadresse (optional)')]),
]);

/* Anlagendaten */
const anlage = fieldsTable([
  fieldRow([fieldCell('Anlagenstandort – Straße & Hausnr.'), fieldCell('PLZ / Ort')]),
  fieldRow([fieldCell('Leistung (kWp)', { width: 33 }), fieldCell('Anzahl Module', { width: 33 }), fieldCell('Anlagentyp (Schräg-/Flach-/Freifläche/Fassade)', { width: 34 })]),
  fieldRow([fieldCell('Modul-Hersteller / -Typ (optional)'), fieldCell('Inbetriebnahme-Jahr (optional)')]),
  fieldRow([fieldCell('Wunschtermin / Zeitfenster'), fieldCell('Zugang / Besonderheiten (optional)')]),
]);

/* Konditionen-Tabelle */
const konditionen = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: lineBorders,
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: TEAL },
          margins: { top: 60, bottom: 60, left: 110, right: 110 },
          children: [p([txt('Leistung', { size: 14, bold: true, color: 'FFFFFF', caps: true, tracking: 30 })])],
        }),
        new TableCell({
          width: { size: 30, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: TEAL },
          margins: { top: 60, bottom: 60, left: 110, right: 110 },
          children: [p([txt('Netto', { size: 14, bold: true, color: 'FFFFFF', caps: true, tracking: 30 })],
            { align: AlignmentType.RIGHT })],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          margins: { top: 50, bottom: 50, left: 110, right: 110 },
          children: [
            p([txt('Anfahrtspauschale (bis 100 km Luftlinie ab 94121 Salzweg)', { size: 17 })]),
            p([txt('darüber hinaus: 0,50 €/km Aufschlag', { size: 13, color: MUTED, italic: true })]),
          ],
        }),
        new TableCell({
          margins: { top: 50, bottom: 50, left: 110, right: 110 },
          children: [p([txt('190,00 €', { size: 17, bold: true })], { align: AlignmentType.RIGHT })],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          margins: { top: 50, bottom: 50, left: 110, right: 110 },
          children: [
            p([txt('Inspektion & KI-Auswertung – Preis je Modul nach Staffel', { size: 17 })]),
            p([txt('≤500: 0,80 €  ·  ≤1.500: 0,70 €  ·  ≤3.000: 0,60 €  ·  ≤5.000: 0,50 €  ·  >5.000: 0,40 €',
              { size: 13, color: MUTED, italic: true })]),
          ],
        }),
        new TableCell({
          margins: { top: 50, bottom: 50, left: 110, right: 110 },
          children: [p([txt('______ €', { size: 17, bold: true })], { align: AlignmentType.RIGHT })],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: BG_SOFT },
          margins: { top: 60, bottom: 60, left: 110, right: 110 },
          children: [p([txt('Auftragssumme netto (zzgl. 19 % MwSt.)',
            { size: 17, bold: true, color: TEAL })])],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: BG_SOFT },
          margins: { top: 60, bottom: 60, left: 110, right: 110 },
          children: [p([txt('______ €', { size: 19, bold: true, color: TEAL })],
            { align: AlignmentType.RIGHT })],
        }),
      ],
    }),
  ],
});

/* AGB-Hinweis-Box */
const agbBox = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top:    { style: BorderStyle.SINGLE, size: 4,  color: SUN },
    bottom: { style: BorderStyle.SINGLE, size: 4,  color: SUN },
    left:   { style: BorderStyle.SINGLE, size: 24, color: SUN },
    right:  { style: BorderStyle.SINGLE, size: 4,  color: SUN },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  },
  rows: [
    new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: 'FFFBE6' },
          margins: { top: 80, bottom: 80, left: 160, right: 160 },
          children: [
            p([
              txt('Mit der Unterschrift erkennt der Auftraggeber die ', { size: 14 }),
              txt('Allgemeinen Geschäftsbedingungen (AGB) ', { size: 14, bold: true }),
              txt('der KolibriInspect an. Diese sind abrufbar unter ', { size: 14 }),
              txt('www.kolibri-inspect.de/agb.html', { size: 14, bold: true, color: TEAL }),
              txt(' und werden auf Wunsch kostenfrei in Textform übermittelt. Der Auftrag erfolgt ausschließlich auf Grundlage dieser AGB; entgegenstehende Bedingungen des Auftraggebers werden nicht Vertragsinhalt.',
                { size: 14 }),
            ], { line: 260 }),
          ],
        }),
      ],
    }),
  ],
});

/* Unterschriftenzeile */
const sigRow = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: noBorders,
  rows: [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: {
            ...noBorders,
            top: { style: BorderStyle.SINGLE, size: 6, color: TEXT },
          },
          margins: { top: 60, bottom: 0, left: 0, right: 200 },
          children: [p([txt('Ort, Datum', { size: 13, color: MUTED })])],
        }),
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          borders: {
            ...noBorders,
            top: { style: BorderStyle.SINGLE, size: 6, color: TEXT },
          },
          margins: { top: 60, bottom: 0, left: 200, right: 0 },
          children: [p([
            txt('Rechtsverbindliche Unterschrift / Stempel', { size: 13, color: MUTED }),
            txt('   (B2B – § 14 BGB)', { size: 12, color: MUTED, italic: true }),
          ])],
        }),
      ],
    }),
  ],
});

/* Footer */
const footer = new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 180, after: 0, line: 220 },
  children: [
    txt('KolibriInspect · TGA Plöchinger GmbH · Passauer Str. 20 · 94121 Salzweg', { size: 12, color: MUTED }),
    new TextRun({ break: 1 }),
    txt('Tel.: +49 179 1599311   ·   info@kolibri-inspect.de   ·   www.kolibri-inspect.de',
      { size: 12, color: MUTED, font: FONT_BODY }),
    new TextRun({ break: 1 }),
    txt('Bitte ausgefüllt und unterzeichnet zurück per E-Mail an info@kolibri-inspect.de',
      { size: 12, color: TEAL, italic: true, font: FONT_BODY }),
  ],
});

/* ---------- Dokument zusammensetzen ---------- */
const doc = new Document({
  creator: 'KolibriInspect',
  title: 'Bestellung – KolibriInspect',
  description: 'Einseitige B2B-Bestellung für die einmalige Drohnen-Thermografie-Inspektion',
  styles: {
    default: {
      document: { run: { font: FONT_BODY, size: 18, color: TEXT } },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top:    convertMillimetersToTwip(14),
          bottom: convertMillimetersToTwip(12),
          left:   convertMillimetersToTwip(16),
          right:  convertMillimetersToTwip(16),
        },
        size: { orientation: PageOrientation.PORTRAIT },
      },
    },
    children: [
      headerTable,
      intro,
      sectionTitle('1 · Auftraggeber / Rechnungsadresse'),
      auftraggeber,
      sectionTitle('2 · Anlagendaten / Standort der PV-Anlage'),
      anlage,
      sectionTitle('3 · Beauftragte Leistung & Konditionen'),
      konditionen,
      p([txt('Im Preis enthalten: Drohnen-Thermografie der Module, KI-gestützte Auswertung, schriftlicher Befundbericht (PDF) inkl. Empfehlungen, sichere Datenübertragung. Zahlungsziel: 14 Tage netto nach Berichtsübergabe.',
        { size: 13, color: MUTED, italic: true })], { before: 60, after: 80, line: 240 }),
      sectionTitle('4 · Verbindliche Auftragserteilung'),
      agbBox,
      p([txt(' ', { size: 14 })], { before: 100, after: 0 }),
      sigRow,
      footer,
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('Bestellung erstellt:', OUT);
});
