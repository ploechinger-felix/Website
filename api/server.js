const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');

const app          = express();
const PORT         = process.env.PORT          || 3000;
const DATA         = process.env.DATA_FILE     || '/data/anfragen.json';
const ANGEBOTE_DATA = process.env.ANGEBOTE_FILE || '/data/angebote.json';
const N8N          = process.env.N8N_WEBHOOK   || '';
const TOKEN        = process.env.ADMIN_TOKEN   || 'changeme';

// ── E-Mail-Konfiguration (IONOS) ───────────────────────────
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_TO   = process.env.MAIL_TO   || 'info@kolibri-inspect.de';

const transporter = SMTP_USER ? nodemailer.createTransport({
  host: 'smtp.ionos.de',
  port: 587,
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
}) : null;

async function sendMail(entry) {
  if (!transporter) return;
  const a = entry;
  const text = `
Neue Anfrage über kolibri-inspect.de

Anfrage-ID:     ${a.anfrage_id || '–'}
Empfangen:      ${a.empfangen_am}

── Anlage ──────────────────────
Unternehmen:    ${a.company_name || '–'}
Leistung:       ${a.kwp || '–'} kWp
Module:         ${a.module_count || '–'}
Anlagentyp:     ${a.anlage_typ || '–'}
Inspektionstyp: ${a.inspektionstyp || '–'}
Standort:       ${a.volladresse || [a.Strasse_Hausnummer, a.Postleitzahl, a.stadt].filter(Boolean).join(', ')}
Wunschtermin:   ${a.wunschtermin || '–'}
Anmerkungen:    ${a.anmerkungen || '–'}

── Kontakt ─────────────────────
Name:           ${a.contact_name || '–'}
E-Mail:         ${a.email || '–'}
Telefon:        ${a.phone || '–'}
`.trim();

  await transporter.sendMail({
    from:    `"Kolibri Inspect Website" <${SMTP_USER}>`,
    to:      MAIL_TO,
    subject: `Neue Anfrage ${a.anfrage_id || ''} – ${a.company_name || 'unbekannt'} (${a.kwp || '?'} kWp)`,
    text,
  });
  console.log(`[✉] E-Mail gesendet an ${MAIL_TO}`);
}

// ── Middleware ─────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://kolibri-inspect.de',
    'https://www.kolibri-inspect.de',
    'http://localhost',
  ]
}));
app.use(express.json());

// ── Datenspeicher initialisieren ───────────────────────────
const dir = path.dirname(DATA);
if (!fs.existsSync(dir))  fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(DATA)) fs.writeFileSync(DATA, '[]');
if (!fs.existsSync(ANGEBOTE_DATA)) fs.writeFileSync(ANGEBOTE_DATA, '[]');

function load()              { return JSON.parse(fs.readFileSync(DATA)); }
function save(entries)       { fs.writeFileSync(DATA, JSON.stringify(entries, null, 2)); }
function loadAngebote()      { return JSON.parse(fs.readFileSync(ANGEBOTE_DATA)); }
function saveAngebote(list)  { fs.writeFileSync(ANGEBOTE_DATA, JSON.stringify(list, null, 2)); }

// ── Preisberechnung (Einmalinspektion) ─────────────────────
const PRICE_TIERS = [
  { max: 500,      rate: 0.80 },
  { max: 1500,     rate: 0.70 },
  { max: 3000,     rate: 0.60 },
  { max: 5000,     rate: 0.50 },
  { max: Infinity, rate: 0.40 },
];
function computePrice(moduleCount, anfahrtZuschlag = 0) {
  const m = parseInt(moduleCount, 10);
  const tier = PRICE_TIERS.find(t => m <= t.max);
  const modulkosten  = Math.round(m * tier.rate * 100) / 100;
  const nettoGesamt  = Math.round((190 + modulkosten + anfahrtZuschlag) * 100) / 100;
  const mwstBetrag   = Math.round(nettoGesamt * 0.19 * 100) / 100;
  const bruttoGesamt = Math.round((nettoGesamt + mwstBetrag) * 100) / 100;
  return { pauschale: 190, ratePerModule: tier.rate, modulkosten, anfahrtZuschlag, nettoGesamt, mwstBetrag, bruttoGesamt };
}

// ── PDF-Generierung ────────────────────────────────────────
function generatePDF(entry) {
  return new Promise((resolve, reject) => {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const p   = entry.preisdetails;
    const w   = entry.willenserklarung;
    const L   = 50;
    const R   = 545;
    const VX  = 400;
    const fmt = n => n.toFixed(2).replace('.', ',') + ' EUR';
    const fmtDate = iso => new Date(iso).toLocaleDateString('de-DE',
      { day: '2-digit', month: '2-digit', year: 'numeric' });
    const fmtDateTime = iso => {
      const d = new Date(iso);
      return fmtDate(iso) + ', ' +
        d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' Uhr';
    };

    // Header
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#167e74').text('KolibriInspect', L, 50);
    doc.fontSize(9).font('Helvetica').fillColor('#8a9aa8')
      .text('Drohnen-Thermografie & KI-Auswertung für PV-Anlagen', L, 74)
      .text('Dipl. Ing. Friedrich Plöchinger', L, 85)
      .text('Eichenweg 8, 94121 Salzweg', L, 96)
      .text('info@kolibri-inspect.de | +49 151 56054911', L, 107);

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#222628')
      .text('Angebot-Nr.:', 380, 50).text('Datum:', 380, 63);
    doc.fontSize(9).font('Helvetica').fillColor('#222628')
      .text(entry.angebot_id, 460, 50).text(fmtDate(entry.empfangen_am), 460, 63);

    doc.moveTo(L, 125).lineTo(R, 125).strokeColor('#167e74').lineWidth(1.5).stroke();

    // Titel
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#222628').text('AUFTRAGSBESTÄTIGUNG', L, 138);
    doc.fontSize(10).font('Helvetica').fillColor('#8a9aa8')
      .text('Einmalige Drohnen-Thermografie-Inspektion', L, 159);

    // Auftraggeber
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#167e74').text('AUFTRAGGEBER', L, 185);
    doc.fontSize(10).font('Helvetica').fillColor('#222628')
      .text(entry.company_name || '-', L, 197)
      .text(entry.contact_name || '-', L, 210)
      .text(entry.volladresse  || '-', L, 223)
      .text(entry.email        || '-', L, 236);
    let nextY = entry.phone ? 262 : 249;
    if (entry.phone) doc.text(entry.phone, L, 249);

    // Leistung
    const dT = nextY + 15;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#167e74').text('LEISTUNG', L, dT);
    doc.fontSize(10).font('Helvetica').fillColor('#222628')
      .text('Einmalige Drohnen-Thermografie-Inspektion nach IEC 62446-3', L, dT + 14)
      .text(`Standort: ${entry.volladresse || '-'}`, L, dT + 28)
      .text(`Anlagentyp: ${entry.anlage_typ || '-'}`, L, dT + 42)
      .text(`Anlagenleistung: ${entry.kwp || '-'} kWp  |  Modulanzahl: ca. ${entry.module_count} Module`, L, dT + 56);

    // Preisaufstellung
    const pT = dT + 85;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#167e74').text('PREISAUFSTELLUNG', L, pT);

    let y = pT + 18;
    const priceRow = (label, value, bold = false) => {
      doc.fontSize(10).font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(bold ? '#222628' : '#6a7a88').text(label, L, y, { width: 340 });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#222628')
        .text(value, VX, y, { width: 145, align: 'right' });
      y += 16;
    };

    priceRow(`Anfahrtspauschale (bis 100 km Luftlinie)`, fmt(p.pauschale));
    if (p.anfahrtZuschlag > 0) {
      const extraKm = Math.round(p.anfahrtZuschlag / 0.50);
      priceRow(`Anfahrtszuschlag (${extraKm} km × 0,50 EUR/km)`, fmt(p.anfahrtZuschlag));
    }
    priceRow(`Modulinspektion (${entry.module_count} Module × ${p.ratePerModule.toFixed(2).replace('.', ',')} EUR/Modul)`, fmt(p.modulkosten));

    y += 4;
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#444').lineWidth(0.5).stroke();
    y += 10;

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#222628')
      .text('Nettobetrag', L, y).text(fmt(p.nettoGesamt), VX, y, { width: 145, align: 'right' });
    y += 20;
    doc.fontSize(9).font('Helvetica').fillColor('#8a9aa8')
      .text('zzgl. Umsatzsteuer 19 %', L, y).text(fmt(p.mwstBetrag), VX, y, { width: 145, align: 'right' });
    y += 15;
    doc.text('(Bruttobetrag inkl. MwSt.)', L, y)
      .text(`(${fmt(p.bruttoGesamt)})`, VX, y, { width: 145, align: 'right' });
    y += 30;

    // Willenserklärung
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#167e74').lineWidth(1.5).stroke();
    y += 15;

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#167e74')
      .text('DIGITALE AUFTRAGSERTEILUNG (Willenserklärung gemäß § 126b BGB)', L, y);
    y += 18;

    doc.fontSize(10).font('Helvetica').fillColor('#222628')
      .text(`Ich, ${w.getippter_name}, beauftrage KolibriInspect verbindlich mit der oben beschriebenen`, L, y)
      .text('Inspektion zu den genannten Konditionen und Preisen.', L, y + 13);
    y += 38;

    const wRows = [
      ['Digitale Unterschrift:', w.getippter_name],
      ['Zeitstempel (Server):',  fmtDateTime(entry.empfangen_am)],
      ['IP-Adresse:',            entry.ip || '-'],
      ['E-Mail:',                entry.email || '-'],
      ['AGB akzeptiert:',        w.agb_akzeptiert ? 'Ja' : 'Nein'],
      ['Datenschutz akzeptiert:', w.dsgvo_akzeptiert ? 'Ja' : 'Nein'],
    ];
    wRows.forEach(([label, value]) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#8a9aa8').text(label, L, y, { width: 150 });
      doc.fontSize(9).font('Helvetica').fillColor('#222628').text(value, 210, y, { width: 335 });
      y += 14;
    });

    y += 10;
    doc.fontSize(7.5).font('Helvetica').fillColor('#8a9aa8').text(
      'Rechtshinweis: Diese Erklärung wurde in Textform gemäß § 126b BGB abgegeben und ist rechtsverbindlich. ' +
      'Diese Auftragsbestätigung dient als Nachweis der digitalen Auftragserteilung.',
      L, y, { width: R - L }
    );

    doc.end();
  });
}

// ── E-Mail Angebot ─────────────────────────────────────────
async function sendAngebotMails(entry, pdfBuffer) {
  if (!transporter) return;
  const e = entry;
  const p = e.preisdetails;
  const fmt = n => n.toFixed(2).replace('.', ',') + ' EUR';

  const attachments = pdfBuffer ? [{
    filename: `Auftragsbestaetigung-${e.angebot_id}.pdf`,
    content: pdfBuffer,
    contentType: 'application/pdf',
  }] : [];

  const bodyKunde = `Sehr geehrte/r ${e.contact_name},

vielen Dank für Ihren Auftrag! Im Anhang finden Sie Ihre Auftragsbestätigung als PDF-Dokument.

Angebot-Nr.:    ${e.angebot_id}
Datum:          ${new Date(e.empfangen_am).toLocaleDateString('de-DE')}
Leistung:       Einmalige Drohnen-Thermografie-Inspektion
Standort:       ${e.volladresse || '-'}
Nettobetrag:    ${fmt(p.nettoGesamt)}
Bruttobetrag:   ${fmt(p.bruttoGesamt)}

Wir werden uns innerhalb eines Werktages bei Ihnen melden, um den Inspektionstermin abzustimmen.

Mit freundlichen Grüßen
Friedrich Plöchinger
KolibriInspect
info@kolibri-inspect.de | +49 151 56054911`.trim();

  const bodyOp = `Neuer digitaler Auftrag über kolibri-inspect.de

Angebot-ID:   ${e.angebot_id}
Empfangen:    ${e.empfangen_am}
IP:           ${e.ip}

── Anlage ───────────────────────────────────────
Unternehmen:  ${e.company_name}
Leistung:     ${e.kwp} kWp
Module:       ${e.module_count}
Anlagentyp:   ${e.anlage_typ}

── Standort ─────────────────────────────────────
Adresse:      ${e.volladresse}

── Kontakt ──────────────────────────────────────
Name:         ${e.contact_name}
E-Mail:       ${e.email}
Telefon:      ${e.phone || '–'}

── Preis ────────────────────────────────────────
Pauschale:    ${fmt(p.pauschale)}${p.anfahrtZuschlag > 0 ? `\nAnfahrtszuschlag: ${fmt(p.anfahrtZuschlag)} (Luftlinie: ${e.distance_km} km)` : ''}
Modulkosten:  ${e.module_count} × ${p.ratePerModule.toFixed(2)} EUR = ${fmt(p.modulkosten)}
Netto:        ${fmt(p.nettoGesamt)}
MwSt. 19 %:  ${fmt(p.mwstBetrag)}
Brutto:       ${fmt(p.bruttoGesamt)}

── Willenserklärung ─────────────────────────────
Getippter Name: ${e.willenserklarung.getippter_name}
Server-Zeit:    ${e.willenserklarung.server_zeitstempel}
AGB:            ${e.willenserklarung.agb_akzeptiert ? 'Ja' : 'Nein'}
Datenschutz:    ${e.willenserklarung.dsgvo_akzeptiert ? 'Ja' : 'Nein'}`.trim();

  await Promise.all([
    transporter.sendMail({
      from:    `"KolibriInspect" <${SMTP_USER}>`,
      to:      e.email,
      subject: `Ihre Auftragsbestätigung – ${e.angebot_id} · KolibriInspect`,
      text:    bodyKunde,
      attachments,
    }),
    transporter.sendMail({
      from:    `"Kolibri Inspect Website" <${SMTP_USER}>`,
      to:      MAIL_TO,
      subject: `[NEUER AUFTRAG] ${e.angebot_id} – ${e.company_name} (${e.module_count} Module / ${fmt(p.bruttoGesamt)} brutto)`,
      text:    bodyOp,
      attachments,
    }),
  ]);
  console.log(`[✉] Angebot-Mails: Kunde (${e.email}) + Betreiber (${MAIL_TO})`);
}

// ── POST /anfrage ──────────────────────────────────────────
app.post('/anfrage', async (req, res) => {
  try {
    const entry = {
      ...req.body,
      empfangen_am: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    };

    // Speichern
    const list = load();
    list.push(entry);
    save(list);
    console.log(`[+] Anfrage gespeichert: ${entry.anfrage_id || '–'}`);

    // E-Mail (nicht-blockierend)
    sendMail(entry).catch(e => console.error('[✉] E-Mail Fehler:', e.message));

    // n8n Webhook (nicht-blockierend)
    if (N8N) {
      fetch(N8N, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(e => console.error('n8n-Webhook Fehler:', e.message));
    }

    res.json({ ok: true, anfrage_id: entry.anfrage_id });
  } catch (e) {
    console.error('POST /anfrage Fehler:', e.message);
    res.status(500).json({ ok: false, error: 'Interner Fehler' });
  }
});

// ── POST /angebot ──────────────────────────────────────────
app.post('/angebot', async (req, res) => {
  try {
    const b = req.body;

    // Pflichtfelder
    for (const f of ['angebot_id', 'company_name', 'contact_name', 'email', 'module_count', 'sig_name']) {
      if (!b[f] || String(b[f]).trim() === '')
        return res.status(400).json({ ok: false, error: `Pflichtfeld fehlt: ${f}` });
    }
    if (b.agb_akzeptiert   !== 'on') return res.status(400).json({ ok: false, error: 'AGB nicht akzeptiert' });
    if (b.dsgvo_akzeptiert !== 'on') return res.status(400).json({ ok: false, error: 'DSGVO nicht akzeptiert' });
    if (b.b2b_check        !== 'on') return res.status(400).json({ ok: false, error: 'B2B-Bestätigung fehlt' });

    // Preisverifikation
    const clientAnfahrt = Math.max(0, parseFloat(b.anfahrt_zuschlag) || 0);
    const serverPrice   = computePrice(b.module_count, clientAnfahrt);
    const clientNetto   = parseFloat(b.netto_gesamt);
    if (isNaN(clientNetto) || Math.abs(serverPrice.nettoGesamt - clientNetto) > 0.01)
      return res.status(400).json({ ok: false, error: 'Preisberechnung konnte nicht verifiziert werden.' });

    const serverTs = new Date().toISOString();
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

    const entry = {
      angebot_id:   b.angebot_id,
      typ:          'digitaler_auftrag',
      company_name: b.company_name,
      kwp:          b.kwp,
      module_count: b.module_count,
      anlage_typ:   b.anlage_typ,
      inspektionstyp: 'Einmalig',
      Strasse_Hausnummer: b.Strasse_Hausnummer,
      Postleitzahl: b.Postleitzahl,
      stadt:        b.stadt,
      volladresse:  b.volladresse,
      contact_name: b.contact_name,
      email:        b.email,
      phone:        b.phone || '',
      distance_km:  parseInt(b.distance_km, 10) || 0,
      preisdetails: serverPrice,
      willenserklarung: {
        getippter_name:     b.sig_name.trim(),
        client_zeitstempel: b.client_zeitstempel || '',
        server_zeitstempel: serverTs,
        agb_akzeptiert:     true,
        dsgvo_akzeptiert:   true,
      },
      empfangen_am:           serverTs,
      ip,
      user_agent:             req.headers['user-agent'] || '',
      email_kunde_gesendet:   false,
      email_operator_gesendet: false,
    };

    const list = loadAngebote();
    list.push(entry);
    saveAngebote(list);
    console.log(`[+] Angebot gespeichert: ${entry.angebot_id}`);

    // PDF generieren
    try {
      const pdfBuffer = await generatePDF(entry);
      const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
      list[list.length - 1].pdf_hash_sha256 = hash;
      saveAngebote(list);

      // E-Mails
      await sendAngebotMails(entry, pdfBuffer);
      list[list.length - 1].email_kunde_gesendet    = true;
      list[list.length - 1].email_operator_gesendet = true;
      saveAngebote(list);
    } catch (innerErr) {
      console.error('[Angebot] PDF/Mail Fehler:', innerErr.message);
    }

    res.json({ ok: true, angebot_id: entry.angebot_id });
  } catch (e) {
    console.error('POST /angebot Fehler:', e.message);
    res.status(500).json({ ok: false, error: 'Interner Fehler' });
  }
});

// ── GET /anfragen (Admin, Bearer-Token) ────────────────────
app.get('/anfragen', (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (auth.replace('Bearer ', '') !== TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const list = load();
  res.json({ count: list.length, anfragen: list });
});

// ── Health-Check ───────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Kolibri API läuft auf Port ${PORT}`);
  console.log(`E-Mail: ${transporter ? `aktiviert (${SMTP_USER} → ${MAIL_TO})` : 'deaktiviert (SMTP_USER nicht gesetzt)'}`);
});
