/**
 * Versand der Kampagne „Saisonabschluss 2026" (PLZ 94) über die LetterXpress-API (v3).
 *
 * Liest die von generate-briefe-heimat94.js erzeugten PDFs und reicht sie
 * einzeln ein. Spezifikation: A4, Farbe, duplex, national → 1 Blatt duplex
 * fällt in die Standardbrief-Kategorie.
 *
 * Sicherungen:
 *   - Standardmodus ist `test`. Aufträge landen dort im Warenkorb und werden
 *     nicht produziert. Live nur mit --live.
 *   - Ein Zustandsprotokoll (_versand.json) verhindert, dass ein Brief bei
 *     einem zweiten Lauf erneut eingereicht wird.
 *   - --dry-run reicht nichts ein, sondern zeigt nur, was passieren würde.
 *
 * Zugangsdaten ausschließlich über Umgebungsvariablen:
 *   LXP_USER    Benutzername
 *   LXP_APIKEY  API-Key aus dem Kundenbereich
 *
 * Aufruf:
 *   node scripts/send-letterxpress.js --dry-run     # nur anzeigen
 *   node scripts/send-letterxpress.js               # Testmodus (Warenkorb)
 *   node scripts/send-letterxpress.js --live        # echter Versand
 *   node scripts/send-letterxpress.js --limit 1 --live
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const API_BASE = process.env.LXP_API_BASE || 'https://api.letterxpress.de/v3';
const USER     = process.env.LXP_USER   || '';
const APIKEY   = process.env.LXP_APIKEY || '';

const argv  = process.argv.slice(2);
const argOf = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

/* --dir passt zum --out des Brief-Generators (Probeläufe außerhalb des Projekts). */
const OUT_DIR = argOf('--dir') || path.join(ROOT, 'Anschreiben', 'Briefe_Heimat94');
const INDEX   = path.join(OUT_DIR, '_index.json');
const STATE   = path.join(OUT_DIR, '_versand.json');
const DRY_RUN = argv.includes('--dry-run');
const LIVE    = argv.includes('--live');
const LIMIT   = argOf('--limit') ? parseInt(argOf('--limit'), 10) : Infinity;
const MODE    = LIVE ? 'live' : 'test';

/* Standardbrief, beidseitig, farbig, Inlandsversand.
   color "4" = Farbe, "1" = schwarz/weiß. */
const SPEC = { color: '4', mode: 'duplex', shipping: 'national' };

/* LetterXpress begrenzt auf 120 Requests/Minute — 600 ms Abstand hält
   deutlich Abstand dazu und ist bei 150 Briefen ~90 s Gesamtlaufzeit. */
const PAUSE_MS = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ladeState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function speichereState(s) {
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2), 'utf8');
}

async function sendeBrief(pdfPfad) {
  const buf = fs.readFileSync(pdfPfad);
  const base64 = buf.toString('base64');
  const checksum = crypto.createHash('md5').update(base64).digest('hex');

  const res = await fetch(`${API_BASE}/printjobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth: { username: USER, apikey: APIKEY, mode: MODE },
      letter: {
        base64_file: base64,
        base64_file_checksum: checksum,
        specification: SPEC,
      },
    }),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Fehlertext unverändert durchreichen */ }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  /* LXP meldet Fehler auch mit HTTP 200 im Body. */
  if (json && json.status && String(json.status).toLowerCase() !== 'success') {
    throw new Error(`API: ${json.message || text.slice(0, 300)}`);
  }
  return json || { raw: text.slice(0, 300) };
}

(async () => {
  if (!fs.existsSync(INDEX)) {
    console.error(`✗ ${INDEX} fehlt — zuerst scripts/generate-briefe-heimat94.js laufen lassen.`);
    process.exit(1);
  }
  if (!DRY_RUN && (!USER || !APIKEY)) {
    console.error('✗ LXP_USER und LXP_APIKEY nicht gesetzt.');
    console.error('  PowerShell:  $env:LXP_USER="…"; $env:LXP_APIKEY="…"');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const state = ladeState();

  /* Zustand pro Modus führen: ein Testlauf darf den späteren Livelauf nicht
     als „schon erledigt" blockieren. */
  const key = token => `${token}:${MODE}`;

  const offen = index.filter(e => !state[key(e.token)]?.ok).slice(0, LIMIT);
  const fertig = index.length - index.filter(e => !state[key(e.token)]?.ok).length;

  console.log(`Briefe gesamt: ${index.length} · bereits eingereicht: ${fertig} · jetzt: ${offen.length}`);
  console.log(`Modus: ${DRY_RUN ? 'DRY-RUN (nichts wird gesendet)' : MODE.toUpperCase()}`
    + `  ·  Spezifikation: ${SPEC.color === '4' ? 'Farbe' : 's/w'}, ${SPEC.mode}, ${SPEC.shipping}`);

  const abweichend = offen.filter(e => e.seiten !== 2);
  if (abweichend.length) {
    console.log(`⚠ ${abweichend.length} Brief(e) haben nicht 2 Seiten — Portoklasse prüfen.`);
  }

  if (!offen.length) { console.log('Nichts zu tun.'); return; }

  if (LIVE && !DRY_RUN) {
    console.log('\n*** LIVE-MODUS: diese Briefe werden gedruckt und frankiert. ***\n');
  }

  let ok = 0, fehler = 0;
  for (const e of offen) {
    const pfad = path.join(ROOT, e.datei);
    const kb = Math.round(e.bytes / 1024);
    if (DRY_RUN) {
      console.log(`  [dry] ${e.token}  ${String(e.firma).slice(0, 40).padEnd(40)} ${e.seiten} S. ${kb} KB`);
      continue;
    }
    try {
      const antwort = await sendeBrief(pfad);
      state[key(e.token)] = {
        ok: true, mode: MODE, zeitpunkt: new Date().toISOString(),
        firma: e.firma, antwort,
      };
      ok++;
      console.log(`  ✓ ${e.token}  ${String(e.firma).slice(0, 40)}`);
    } catch (err) {
      state[key(e.token)] = {
        ok: false, mode: MODE, zeitpunkt: new Date().toISOString(),
        firma: e.firma, fehler: err.message,
      };
      fehler++;
      console.log(`  ✗ ${e.token}  ${String(e.firma).slice(0, 40)} — ${err.message}`);
    }
    speichereState(state);
    await sleep(PAUSE_MS);
  }

  if (DRY_RUN) { console.log('\n[DRY-RUN] Nichts eingereicht.'); return; }

  console.log(`\nFertig: ${ok} eingereicht, ${fehler} Fehler. Protokoll: ${path.relative(ROOT, STATE)}`);
  if (MODE === 'test') {
    console.log('Testmodus — die Aufträge liegen im LXP-Warenkorb und werden nach 7 Tagen gelöscht.');
    console.log('Dort Vorschau und Adressposition prüfen, dann mit --live wiederholen.');
  }
})().catch(err => {
  console.error('FEHLER:', err);
  process.exitCode = 1;
});
