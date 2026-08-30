#!/usr/bin/env node
/**
 * Empfängerliste PLZ 94 für die E-Mail-Kampagne.
 *
 * Eigenes Skript statt einer Erweiterung von
 * scripts/extract-heimat-plz94.js: dessen Ergebnis liegt der bereits
 * gedruckten und versandten Briefwelle zugrunde. Wer daran schraubt,
 * riskiert, dass ein späterer Lauf eine andere Liste erzeugt als die, die
 * in der Post war. Die Parser-Hilfen sind von dort übernommen — sie sind
 * gegen genau dieses Exportformat erprobt (UTF-16 LE mit BOM, flache
 * Records).
 *
 * Unterschied zur Briefliste, und der Grund für ein zweites Skript:
 *   - Pflichtfeld ist die E-Mail-Adresse, nicht die Postanschrift. Ein
 *     Betreiber ohne Straße, aber mit Adresse, ist hier brauchbar.
 *   - Wer den Brief schon bekommen hat, fliegt raus (siehe unten).
 *
 * Ausgabe ist bewusst das Spaltenschema des Sheets „Alle Leads", damit
 * saison-leads.js unverändert damit arbeiten kann:
 *   SAISON_XLSX=… SAISON_SHEET=PLZ94_Mail SAISON_PLZ=94 node send-saison.js --vorbereiten
 *
 * Aufruf:
 *   node extract-plz94-mail.js --input "C:/Users/…/Gesamtdatenexport_20260821_26.1"
 *   node extract-plz94-mail.js --dry-run      # nur zählen, nichts schreiben
 */

const fs   = require('fs');
const path = require('path');
const sax  = require('sax');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');

const argv  = process.argv.slice(2);
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const DRY_RUN = argv.includes('--dry-run');

const INPUT_DIR = path.resolve(argOf('input') || process.env.MASTR_INPUT
  || 'C:/Users/ploec/Downloads/Gesamtdatenexport_20260821_26.1');
const XLSX_PATH  = path.join(ROOT, 'Anschreiben', 'KolibriInspect_PV_Leads_PLZ94_Mail.xlsx');
const SHEET      = 'PLZ94_Mail';
const CACHE_JSON = path.join(__dirname, '.state', 'plz94-mail-leads.json');
const BRIEF_SEE  = path.join(__dirname, '.state', 'brief-empfaenger-see.json');

const PLZ_PREFIX = '94';
const MIN_KWP    = 100;
const BETRIEBSSTATUS_IN_BETRIEB = '35';

/* Bestandskunden und Einzelausschlüsse wie im Briefpfad. */
const EXCLUDE_SEE = (process.env.EXCLUDE_SEE || '').split(',').map(s => s.trim()).filter(Boolean);
const EXCLUDE_FIRMA_REGEX = process.env.EXCLUDE_FIRMA
  ? new RegExp('\\b(' + process.env.EXCLUDE_FIRMA + ')\\b', 'i')
  : null;

/* ── Hilfen (übernommen aus scripts/extract-heimat-plz94.js) ── */
function listInput(prefix) {
  return fs.readdirSync(INPUT_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.xml'))
    .sort()
    .map(f => path.join(INPUT_DIR, f));
}

function readUtf16(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  return buf.toString('utf16le');
}

function parseDateIso(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])) : null;
}

function ladeKatalog() {
  const datei = path.join(INPUT_DIR, 'Katalogwerte.xml');
  if (!fs.existsSync(datei)) {
    console.log('Katalogwerte.xml fehlt — Anlagenart und Einspeisungsart bleiben leer.');
    return new Map();
  }
  const map = new Map();
  for (const m of readUtf16(datei).matchAll(/<Katalogwert><Id>(\d+)<\/Id><Wert>([^<]*)<\/Wert>/g)) {
    map.set(m[1], m[2]);
  }
  console.log('Katalogwerte: ' + map.size + ' Einträge');
  return map;
}

function kurzAnlagentyp(wert) {
  if (!wert) return '';
  if (/^Freifläche/i.test(wert)) return 'Freiflächenanlage';
  if (/Hausdach|Gebäude|Fassade/i.test(wert)) return 'Aufdachanlage';
  if (/Großparkplatz/i.test(wert)) return 'Parkplatzanlage';
  if (/Gewässer/i.test(wert)) return 'Schwimmende Anlage';
  return wert;
}

/* Fehlende oder unplausible Modulzahl aus der Leistung schätzen — sonst
   steht in der Mail eine Stückzahl, die der Empfänger sofort widerlegt. */
function fixModule(mod, kwp) {
  let m = Math.round(mod || 0);
  if (m < kwp / 0.6) m = Math.round(kwp * 1000 / 350);
  return Math.max(1, m);
}

function streamRecords(file, recordTag, onRecord) {
  return new Promise((resolve, reject) => {
    const parser = sax.parser(true, { trim: true });
    let current = null, currentTag = null, textBuf = '';
    parser.onopentag = node => {
      if (node.name === recordTag) { current = {}; currentTag = null; return; }
      if (current) { currentTag = node.name; textBuf = ''; }
    };
    parser.ontext  = t => { if (current && currentTag) textBuf += t; };
    parser.oncdata = t => { if (current && currentTag) textBuf += t; };
    parser.onclosetag = name => {
      if (name === recordTag) { onRecord(current); current = null; currentTag = null; return; }
      if (current && name === currentTag) { current[name] = textBuf; currentTag = null; textBuf = ''; }
    };
    parser.onerror = () => { parser.error = null; parser.resume(); };
    parser.onend = () => resolve();
    const text = readUtf16(file);
    try {
      const SZ = 1 << 20;
      for (let i = 0; i < text.length; i += SZ) parser.write(text.slice(i, i + SZ));
      parser.close();
    } catch (e) { reject(e); }
  });
}

/* ── Wer den Brief schon hat, bekommt keine Mail ──
   Die Briefwelle ging am 21.08.2026 an 150 Betreiber. Ein zweiter
   unaufgeforderter Kontakt über einen anderen Kanal, neun Tage später,
   wäre die Art von Zudringlichkeit, aus der Beschwerden entstehen — und
   der Brief hat den stärkeren Auftritt, er soll wirken dürfen. */
function ladeBriefEmpfaenger() {
  try {
    const l = JSON.parse(fs.readFileSync(BRIEF_SEE, 'utf8'));
    console.log('Briefempfänger (nicht anmailen): ' + l.length);
    return new Set(l);
  } catch {
    console.log('Keine Briefempfängerliste gefunden — es wird nichts ausgeschlossen.');
    return new Set();
  }
}

/* ── Pass 1: PV-Anlagen in PLZ 94 ── */
async function findePvAnlagen() {
  const files = listInput('EinheitenSolar_');
  if (!files.length) throw new Error('Keine EinheitenSolar_*.xml in ' + INPUT_DIR);
  console.log('EinheitenSolar: ' + files.length + ' Dateien');

  const proBetreiber = new Map();
  const z = { geprueft: 0, plz: 0, kwp: 0, nichtInBetrieb: 0, ohneBetreiber: 0, excl: 0 };

  for (const file of files) {
    process.stdout.write('  ' + path.basename(file) + ' … ');
    let treffer = 0;
    await streamRecords(file, 'EinheitSolar', r => {
      z.geprueft++;
      const plz = (r.Postleitzahl || '').padStart(5, '0');
      if (!plz.startsWith(PLZ_PREFIX)) return;
      z.plz++;
      const kwp = parseFloat(String(r.Bruttoleistung || '').replace(',', '.'));
      if (!Number.isFinite(kwp) || kwp < MIN_KWP) return;
      z.kwp++;
      if (r.EinheitBetriebsstatus && r.EinheitBetriebsstatus !== BETRIEBSSTATUS_IN_BETRIEB) {
        z.nichtInBetrieb++; return;
      }
      const see = r.EinheitMastrNummer || '';
      if (EXCLUDE_SEE.includes(see)) { z.excl++; return; }
      const betreiber = r.AnlagenbetreiberMastrNummer;
      if (!betreiber) { z.ohneBetreiber++; return; }
      treffer++;

      const eintrag = {
        see, betreiber,
        plzAnlage: plz,
        ortAnlage: r.Ort || '',
        strasseAnlage: r.Strasse || '',
        landkreis: r.Landkreis || '',
        kwp,
        module: parseInt(r.AnzahlModule, 10) || 0,
        inbetriebnahme: parseDateIso(r.Inbetriebnahmedatum),
        lageCode: r.Lage || '',
        einspeisungCode: r.Einspeisungsart || '',
      };
      const prev = proBetreiber.get(betreiber);
      if (!prev || eintrag.kwp > prev.kwp) proBetreiber.set(betreiber, eintrag);
    });
    console.log(treffer + ' Treffer');
  }

  console.log('→ geprüft ' + z.geprueft + ' · PLZ ' + PLZ_PREFIX + ': ' + z.plz
    + ' · ab ' + MIN_KWP + ' kWp: ' + z.kwp);
  console.log('  aussortiert: ' + z.nichtInBetrieb + ' nicht in Betrieb · '
    + z.ohneBetreiber + ' ohne Betreiber-Nr. · ' + z.excl + ' Bestandskunden');
  console.log('→ eindeutige Betreiber (größte Anlage): ' + proBetreiber.size);
  return proBetreiber;
}

/* ── Pass 2: Adressen zu genau diesen Betreibern ── */
async function ladeBetreiber(nummern) {
  const files = listInput('Marktakteure_');
  if (!files.length) throw new Error('Keine Marktakteure_*.xml in ' + INPUT_DIR);
  console.log('\nMarktakteure: ' + files.length + ' Dateien — gesucht: ' + nummern.size);

  const idx = new Map();
  for (const file of files) {
    process.stdout.write('  ' + path.basename(file) + ' … ');
    let n = 0;
    await streamRecords(file, 'Marktakteur', r => {
      if (!r.MastrNummer || !nummern.has(r.MastrNummer)) return;
      n++;
      idx.set(r.MastrNummer, {
        firma: (r.Firmenname || '').replace(/＆/g, '&'),
        email: (r.Email || '').trim().toLowerCase(),
        personenart: r.Personenart || '',
      });
    });
    console.log(n + ' Treffer');
  }
  console.log('→ gefunden: ' + idx.size + ' von ' + nummern.size);
  return idx;
}

/* ── Zeilen im Schema „Alle Leads" ── */
function baueZeilen(anlagen, akteure, katalog, briefEmpfaenger) {
  const kat = c => (c && katalog.get(String(c))) || '';
  const z = { keinAkteur: 0, keinName: 0, anonym: 0, keineMail: 0, bestandskunde: 0, brief: 0 };
  const rows = [];

  for (const a of anlagen.values()) {
    const b = akteure.get(a.betreiber);
    if (!b) { z.keinAkteur++; continue; }
    if (!b.firma) { z.keinName++; continue; }
    if (/^anonym/i.test(b.firma)) { z.anonym++; continue; }
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(b.email)) { z.keineMail++; continue; }
    if (EXCLUDE_FIRMA_REGEX && EXCLUDE_FIRMA_REGEX.test(b.firma)) { z.bestandskunde++; continue; }
    if (briefEmpfaenger.has(a.see)) { z.brief++; continue; }

    rows.push({
      'Firmenname': b.firma,
      'Ansprechpartner': '',
      'Anrede': 'Sehr geehrte Damen und Herren',
      'E-Mail': b.email,
      'Straße (Anlage)': a.strasseAnlage,
      'PLZ (Anlage)': a.plzAnlage,
      'Ort (Anlage)': a.ortAnlage,
      'Landkreis': a.landkreis,
      'Leistung (kWp)': Math.round(a.kwp * 100) / 100,
      'Module': fixModule(a.module, a.kwp),
      'Anlagenart': kurzAnlagentyp(kat(a.lageCode)),
      'Einspeisungsart': kat(a.einspeisungCode),
      'Inbetriebnahme': a.inbetriebnahme,
      'Einheit-MaStR-Nr.': a.see,
    });
  }

  console.log('\naussortiert beim Zusammenbauen:');
  console.log('  ohne Marktakteur-Datensatz: ' + z.keinAkteur);
  console.log('  ohne Firmenname: ' + z.keinName + ' · anonymisiert: ' + z.anonym);
  console.log('  ohne E-Mail-Adresse: ' + z.keineMail);
  console.log('  Bestandskunden: ' + z.bestandskunde);
  console.log('  hat den Brief bereits bekommen: ' + z.brief);
  return rows;
}

async function schreibeExcel(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET);
  ws.columns = Object.keys(rows[0]).map(k => ({
    header: k, key: k,
    width: k === 'Firmenname' ? 38 : k === 'E-Mail' ? 32 : 16,
  }));
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(XLSX_PATH);
  console.log('\nExcel: ' + XLSX_PATH + ' (Sheet ' + SHEET + ', ' + rows.length + ' Zeilen)');
}

(async () => {
  const t0 = Date.now();
  console.log('Empfängerliste PLZ ' + PLZ_PREFIX + ' für die E-Mail-Kampagne');
  console.log('Export: ' + INPUT_DIR + '\n');

  const katalog = ladeKatalog();
  const briefEmpfaenger = ladeBriefEmpfaenger();
  const anlagen = await findePvAnlagen();
  const akteure = await ladeBetreiber(new Set(anlagen.keys()));
  const rows = baueZeilen(anlagen, akteure, katalog, briefEmpfaenger);

  if (!rows.length) { console.log('Keine Treffer.'); return; }

  const mitFrist = rows.filter(r => {
    if (!r.Inbetriebnahme) return false;
    const ende = new Date(r.Inbetriebnahme.getFullYear() + 5, r.Inbetriebnahme.getMonth(), 1);
    return ende > new Date();
  }).length;
  console.log('\n→ ' + rows.length + ' Empfänger mit E-Mail-Adresse');
  console.log('  Mängelhaftung läuft noch: ' + mitFrist + ' · abgelaufen: ' + (rows.length - mitFrist));
  console.log('Dauer: ' + Math.round((Date.now() - t0) / 1000) + ' s');

  fs.mkdirSync(path.dirname(CACHE_JSON), { recursive: true });
  fs.writeFileSync(CACHE_JSON, JSON.stringify(rows, null, 2), 'utf8');
  console.log('Cache: ' + CACHE_JSON);

  if (DRY_RUN) { console.log('[Trockenlauf] Excel nicht geschrieben.'); return; }
  await schreibeExcel(rows);
})().catch(e => { console.error('FEHLER:', e); process.exitCode = 1; });
