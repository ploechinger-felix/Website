const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');

const app   = express();
const PORT  = process.env.PORT         || 3000;
const DATA  = process.env.DATA_FILE    || '/data/anfragen.json';
const N8N   = process.env.N8N_WEBHOOK  || '';
const TOKEN = process.env.ADMIN_TOKEN  || 'changeme';

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

function load()        { return JSON.parse(fs.readFileSync(DATA)); }
function save(entries) { fs.writeFileSync(DATA, JSON.stringify(entries, null, 2)); }

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
