const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE   || '/data/anfragen.json';
const N8N  = process.env.N8N_WEBHOOK || '';
const TOKEN = process.env.ADMIN_TOKEN || 'changeme';

// ── Middleware ─────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://kolibri-inspect.de',
    'https://www.kolibri-inspect.de',
    'http://localhost'           // Entwicklung
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

app.listen(PORT, () => console.log(`Kolibri API läuft auf Port ${PORT}`));
