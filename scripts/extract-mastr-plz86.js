/**
 * Kampagne "PLZ 86 — Gewährleistungsfrist" — Empfängerliste aus MaStR.
 *
 * 1) Liest alle Marktakteure_*.xml ein → Map<MastrNummer, {firma, email, anschrift, ...}>
 *    Nur Akteure mit Email werden behalten (Mail-Kampagne).
 * 2) Streamt alle EinheitenSolar_*.xml, filtert PV-Anlagen mit
 *      - Postleitzahl 86xxx
 *      - Bruttoleistung >= MIN_KWP
 *      - AnlagenbetreiberMastrNummer ist ein bekannter Marktakteur mit Email
 *    und holt AnzahlModule, Inbetriebnahmedatum, Postleitzahl.
 * 3) Pro Betreiber wird die größte Anlage behalten (Dedup).
 * 4) Schreibt Sheet "PLZ_86_Mail" in Anschreiben/KolibriInspect_PV_Leads.xlsx
 *    mit denselben Spalten wie das Sheet "Neuanlage" (E-Mail-Kampagne).
 *
 * Aufruf:
 *   node scripts/extract-mastr-plz86.js --dry-run    # nur Statistik
 *   node scripts/extract-mastr-plz86.js              # Sheet schreiben
 */

const fs   = require('fs');
const path = require('path');
const sax  = require('sax');
const ExcelJS = require('exceljs');

const ROOT      = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'Anschreiben', 'Input');
// Eigene Datei (vermeidet Konflikte, wenn das Haupt-Excel in Office offen ist)
const XLSX_PATH = path.join(ROOT, 'Anschreiben', 'KolibriInspect_PV_Leads_PLZ86.xlsx');
const CACHE_JSON = path.join(__dirname, '.cache', 'plz86-leads.json');
const TARGET_SHEET = 'PLZ_86_Mail';

const PLZ_PREFIX = '86';
const MIN_KWP    = 100;         // Nur Anlagen ab 100 kWp (gewerblich relevant)
const DRY_RUN    = process.argv.includes('--dry-run');
const FROM_CACHE = process.argv.includes('--from-cache');  // JSON-Cache statt MaStR-Parse

// MaStR-Codes
const MARKTFUNKTION_ANLAGENBETREIBER = '2';   // wir filtern später optional
const PERSONENART_NATUERLICH         = '518';
const PERSONENART_JURISTISCH         = '517';

/* ───────── Hilfen ───────── */
function listInput(prefix) {
  return fs.readdirSync(INPUT_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.xml'))
    .sort()
    .map(f => path.join(INPUT_DIR, f));
}

function readUtf16(file) {
  // MaStR-XMLs sind UTF-16 LE mit BOM
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  return buf.toString('utf16le');
}

function parseDateIso(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
function fmtMonatJahr(d) {
  if (!d) return '';
  return `${MONATE[d.getMonth()]} ${d.getFullYear()}`;
}
function monateBisGwEnde(ibn, jetzt = new Date()) {
  if (!ibn) return null;
  const ende = new Date(ibn); ende.setFullYear(ende.getFullYear() + 5);
  return Math.round((ende - jetzt) / (1000 * 60 * 60 * 24 * 30.44));
}

function ableitenAnrede(personenart, ansprechpartner) {
  if (ansprechpartner && /^(Herr|Frau)\b/i.test(String(ansprechpartner).trim())) {
    return `Sehr geehrte/r ${ansprechpartner}`;
  }
  return 'Sehr geehrte Damen und Herren';
}

/* ───────── SAX-Helper: Einfach-Record-Parser ─────────
   MaStR-XMLs sind flach: Wurzelelement + viele identische Children mit
   einfachen Text-Knoten. Wir liefern jeden Child-Record als Objekt
   {feld: text, …} per Callback. */
function streamRecords(file, recordTag, onRecord) {
  return new Promise((resolve, reject) => {
    const parser = sax.parser(true, { trim: true });
    let current = null;
    let currentTag = null;
    let textBuf = '';
    parser.onopentag = node => {
      if (node.name === recordTag) { current = {}; currentTag = null; return; }
      if (current) { currentTag = node.name; textBuf = ''; }
    };
    parser.ontext = t => { if (current && currentTag) textBuf += t; };
    parser.oncdata = t => { if (current && currentTag) textBuf += t; };
    parser.onclosetag = name => {
      if (name === recordTag) { onRecord(current); current = null; currentTag = null; return; }
      if (current && name === currentTag) { current[name] = textBuf; currentTag = null; textBuf = ''; }
    };
    parser.onerror = e => { parser.error = null; parser.resume(); /* tolerate */ };
    parser.onend = () => resolve();

    const text = readUtf16(file);
    try {
      // sax-Parser akzeptiert Chunks; in 1-MB-Stücken füttern
      const SZ = 1 << 20;
      for (let i = 0; i < text.length; i += SZ) parser.write(text.slice(i, i + SZ));
      parser.close();
    } catch (e) { reject(e); }
  });
}

/* ───────── Pass 1: Marktakteure-Index ───────── */
async function indexMarktakteure() {
  const files = listInput('Marktakteure_');
  console.log(`Marktakteure: ${files.length} Datei(en)`);
  const idx = new Map();
  let total = 0, withEmail = 0;
  for (const file of files) {
    process.stdout.write(`  ${path.basename(file)} … `);
    let n = 0, e = 0;
    await streamRecords(file, 'Marktakteur', r => {
      total++; n++;
      if (!r.Email || !r.MastrNummer) return;
      if (!/@/.test(r.Email)) return;
      withEmail++; e++;
      idx.set(r.MastrNummer, {
        firma:        r.Firmenname || '',
        email:        r.Email.trim().toLowerCase(),
        telefon:      r.Telefon || '',
        webseite:     r.Webseite || '',
        strasse:      r.Strasse || '',
        hausnummer:   r.Hausnummer || '',
        plzBetreiber: r.Postleitzahl || '',
        ortBetreiber: r.Ort || '',
        personenart:  r.Personenart || '',
        marktfunktion: r.Marktfunktion || '',
      });
    });
    console.log(`${n} Records, ${e} mit Email`);
  }
  console.log(`→ Index: ${idx.size} Marktakteure mit Email (von insgesamt ${total})`);
  return idx;
}

/* ───────── Pass 2: EinheitenSolar in PLZ 86 ───────── */
async function findePvAnlagenPlz86(marktakteure) {
  const files = listInput('EinheitenSolar_');
  console.log(`\nEinheitenSolar: ${files.length} Datei(en)`);
  // pro Betreiber die größte Anlage (Bruttoleistung)
  const proBetreiber = new Map();
  let geprueft = 0, plzHit = 0, kwpHit = 0, matched = 0;
  for (const file of files) {
    process.stdout.write(`  ${path.basename(file)} … `);
    let p = 0;
    await streamRecords(file, 'EinheitSolar', r => {
      geprueft++;
      const plz = (r.Postleitzahl || '').padStart(5, '0');
      if (!plz.startsWith(PLZ_PREFIX)) return;
      plzHit++;
      const kwp = parseFloat(String(r.Bruttoleistung || '').replace(',', '.'));
      if (!Number.isFinite(kwp) || kwp < MIN_KWP) return;
      kwpHit++;
      const betreiberMastr = r.AnlagenbetreiberMastrNummer;
      if (!betreiberMastr || !marktakteure.has(betreiberMastr)) return;
      matched++; p++;
      const ibn = parseDateIso(r.Inbetriebnahmedatum);
      const eintrag = {
        einheitMastr: r.EinheitMastrNummer || '',
        betreiberMastr,
        ortAnlage:   r.Ort || '',
        plzAnlage:   plz,
        gemeinde:    r.Gemeinde || '',
        landkreis:   r.Landkreis || '',
        kwp,
        module:      parseInt(r.AnzahlModule, 10) || 0,
        anlagenname: r.NameStromerzeugungseinheit || '',
        inbetriebnahme: ibn,
      };
      const prev = proBetreiber.get(betreiberMastr);
      if (!prev || eintrag.kwp > prev.kwp) proBetreiber.set(betreiberMastr, eintrag);
    });
    console.log(`${p} Treffer in PLZ ${PLZ_PREFIX} mit Email-Betreiber`);
  }
  console.log(`→ EinheitenSolar geprüft: ${geprueft}, PLZ ${PLZ_PREFIX}: ${plzHit}, ≥${MIN_KWP} kWp: ${kwpHit}, Email-match: ${matched}`);
  console.log(`→ Eindeutige Betreiber (größte Anlage): ${proBetreiber.size}`);
  return proBetreiber;
}

/* ───────── Plausibilisierung Modulanzahl ───────── */
function fixModule(mod, kwp) {
  let m = Math.round(mod || 0);
  if (m < kwp / 0.6) m = Math.round(kwp * 1000 / 350);   // Schätzung 350 Wp/Modul
  return Math.max(1, m);
}

/* ───────── Excel schreiben ───────── */
async function schreibeExcel(rows) {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(XLSX_PATH)) {
    try {
      await wb.xlsx.readFile(XLSX_PATH);
    } catch (e) {
      console.log(`⚠ Bestehende Datei ${path.basename(XLSX_PATH)} konnte nicht gelesen werden (${e.code || e.message}) — schreibe komplett neu.`);
    }
  }

  let ws = wb.getWorksheet(TARGET_SHEET);
  if (ws) {
    console.log(`Sheet "${TARGET_SHEET}" existiert — wird ersetzt.`);
    wb.removeWorksheet(ws.id);
  }
  ws = wb.addWorksheet(TARGET_SHEET);

  // Spalten kompatibel zu kampagne/send-plz86.js (siehe loadLeads dort)
  ws.columns = [
    { header: 'Firmenname',       key: 'Firmenname',       width: 38 },
    { header: 'Ansprechpartner',  key: 'Ansprechpartner',  width: 22 },
    { header: 'Anrede',           key: 'Anrede',           width: 30 },
    { header: 'Straße + Nr.',     key: 'StrasseNr',        width: 26 },
    { header: 'PLZ',              key: 'PLZ',              width: 7  },
    { header: 'Ort',              key: 'Ort',              width: 18 },
    { header: 'E-Mail',           key: 'EMail',            width: 32 },
    { header: 'Telefon',          key: 'Telefon',          width: 18 },
    { header: 'Webseite',         key: 'Webseite',         width: 24 },
    { header: 'Leistung (kWp)',   key: 'kWp',              width: 12 },
    { header: 'Module',           key: 'Module',           width: 10 },
    { header: 'Inbetriebnahme',   key: 'IBN',              width: 14 },
    { header: 'Monate bis GW-Ende', key: 'GwMonate',       width: 18 },
    { header: 'Ort (Anlage)',     key: 'OrtAnlage',        width: 18 },
    { header: 'PLZ (Anlage)',     key: 'PLZAnlage',        width: 12 },
    { header: 'Personenart',      key: 'Personenart',      width: 16 },
    { header: 'Einheit-MaStR-Nr.', key: 'EinheitMastr',    width: 18 },
    { header: 'Betreiber-MaStR-Nr.', key: 'BetreiberMastr', width: 18 },
  ];
  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF167E74' } };
  hdr.alignment = { vertical: 'middle', horizontal: 'left' };
  hdr.height = 22;

  rows.forEach(r => ws.addRow(r));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  await wb.xlsx.writeFile(XLSX_PATH);
  console.log(`\n✓ ${rows.length} Zeilen ins Sheet "${TARGET_SHEET}" geschrieben.`);
  console.log(`  Datei: ${XLSX_PATH}`);
}

/* ───────── Main ───────── */
(async () => {
  console.log(`MaStR-Extraktion PLZ ${PLZ_PREFIX} (≥${MIN_KWP} kWp, Email-Betreiber)`);
  if (DRY_RUN) console.log('[DRY-RUN] – Excel wird nicht geschrieben.\n');

  if (FROM_CACHE) {
    if (!fs.existsSync(CACHE_JSON)) {
      console.error(`✗ Kein Cache: ${CACHE_JSON}`); process.exit(1);
    }
    const rows = JSON.parse(fs.readFileSync(CACHE_JSON, 'utf8'));
    console.log(`Aus Cache geladen: ${rows.length} Zeilen`);
    if (!DRY_RUN) await schreibeExcel(rows);
    return;
  }

  const t0 = Date.now();
  const akteure = await indexMarktakteure();
  const anlagen = await findePvAnlagenPlz86(akteure);

  // Reihen bauen
  const personenartLabel = c =>
    c === PERSONENART_JURISTISCH ? 'Juristische Person'
    : c === PERSONENART_NATUERLICH ? 'Natürliche Person'
    : c || '';

  let rows = [...anlagen.values()].map(a => {
    const b = akteure.get(a.betreiberMastr);
    const module = fixModule(a.module, a.kwp);
    const gwMon = monateBisGwEnde(a.inbetriebnahme);
    return {
      Firmenname:      b.firma,
      Ansprechpartner: '',
      Anrede:          ableitenAnrede(b.personenart, ''),
      StrasseNr:       [b.strasse, b.hausnummer].filter(Boolean).join(' ').trim(),
      PLZ:             (b.plzBetreiber || a.plzAnlage || '').padStart(5, '0'),
      Ort:             b.ortBetreiber || a.ortAnlage || '',
      EMail:           b.email,
      Telefon:         b.telefon || '',
      Webseite:        b.webseite || '',
      kWp:             Math.round(a.kwp * 100) / 100,
      Module:          module,
      IBN:             a.inbetriebnahme ? a.inbetriebnahme.toISOString().slice(0, 10) : '',
      GwMonate:        gwMon == null ? '' : gwMon,
      OrtAnlage:       a.ortAnlage,
      PLZAnlage:       a.plzAnlage,
      Personenart:     personenartLabel(b.personenart),
      EinheitMastr:    a.einheitMastr,
      BetreiberMastr:  a.betreiberMastr,
    };
  })
  .filter(r => r.Firmenname);                             // nur mit Firmennamen

  // Email-Dedup: pro E-Mail nur die größte Anlage behalten
  // (Konzern-Mails wie info@anumar.de stehen sonst zigfach im Verteiler)
  const emailDedup = new Map();
  for (const r of rows) {
    const key = r.EMail.toLowerCase();
    const prev = emailDedup.get(key);
    if (!prev || r.kWp > prev.kWp) emailDedup.set(key, r);
  }
  const dedupedDropped = rows.length - emailDedup.size;
  rows = [...emailDedup.values()].sort((a, b) => b.kWp - a.kWp);
  console.log(`Email-Dedup: ${dedupedDropped} Konzern-Duplikate entfernt → ${rows.length} eindeutige Empfänger`);

  console.log(`\nFinale Zeilen: ${rows.length}`);
  const future = rows.filter(r => Number.isFinite(r.GwMonate) && r.GwMonate > 0);
  console.log(`  mit laufender Gewährleistung (>0 Mon.): ${future.length}`);
  console.log(`  abgelaufen / unbekannt:                  ${rows.length - future.length}`);

  console.log('\nTop-10 nach kWp:');
  console.table(rows.slice(0, 10).map(r => ({
    Firma: r.Firmenname.slice(0, 36),
    PLZ_Betr: r.PLZ, Ort_Betr: r.Ort.slice(0, 14),
    PLZ_Anl: r.PLZAnlage, kWp: r.kWp,
    Mod: r.Module, GW: r.GwMonate, Email: r.EMail.slice(0, 32),
  })));

  console.log(`\nDauer: ${Math.round((Date.now() - t0) / 1000)} s`);

  // JSON-Cache immer schreiben (für späteren --from-cache Re-Run ohne 14-Min-Parse)
  fs.mkdirSync(path.dirname(CACHE_JSON), { recursive: true });
  fs.writeFileSync(CACHE_JSON, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`\nJSON-Cache: ${CACHE_JSON} (${rows.length} Zeilen)`);

  if (DRY_RUN) { console.log('[DRY-RUN] – Excel nicht geschrieben.'); return; }
  try {
    await schreibeExcel(rows);
  } catch (e) {
    console.error(`\n✗ Excel-Schreiben fehlgeschlagen: ${e.code || ''} ${e.message}`);
    console.error('  Tipp: Excel-Datei schließen (falls offen in Office) und neu starten mit:');
    console.error('    node scripts/extract-mastr-plz86.js --from-cache');
    process.exit(1);
  }
})().catch(err => {
  console.error('FEHLER:', err);
  process.exitCode = 1;
});
