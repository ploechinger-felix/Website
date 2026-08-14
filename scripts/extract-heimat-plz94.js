/**
 * Kampagne „Saisonabschluss 2026" (PLZ 94) — Empfängerliste aus MaStR.
 *
 * Postmailing (kein E-Mail-Versand): Pflicht ist eine vollständige Betreiber-
 * Postanschrift, nicht eine E-Mail-Adresse. Deshalb läuft die Extraktion in
 * umgekehrter Reihenfolge zu extract-mastr-plz86.js:
 *
 * 1) Streamt alle EinheitenSolar_*.xml, filtert PV-Anlagen mit
 *      - Postleitzahl 94xxx
 *      - Bruttoleistung >= MIN_KWP
 *    und behält pro Betreiber die größte Anlage.
 *    → liefert eine kleine Menge Betreiber-MaStR-Nummern.
 * 2) Streamt alle Marktakteure_*.xml und zieht nur die Adressen zu genau diesen
 *    Nummern. (Der PLZ-86-Pfad indiziert umgekehrt zuerst alle Akteure — das ging
 *    dort nur, weil der Email-Filter den Index klein hielt. Ohne Email-Filter
 *    wäre dieser Index mehrere Millionen Einträge groß.)
 * 3) Preise nach der Aktions-Staffel rechnen (Spiegel von angebot.html /
 *    api/server.js), Mail-Merge-Felder bauen, nach Gewährleistungs-Restlaufzeit
 *    priorisieren und die ersten WELLE_1_GROESSE Ränge als Welle 1 markieren.
 * 4) Schreibt Sheet „Heimat_PLZ94" in Anschreiben/KolibriInspect_PV_Leads_PLZ94.xlsx.
 *
 * Aufruf:
 *   node scripts/extract-heimat-plz94.js --dry-run     # nur Statistik
 *   node scripts/extract-heimat-plz94.js               # Sheet schreiben
 *   node scripts/extract-heimat-plz94.js --from-cache  # ohne MaStR-Parse
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const sax    = require('sax');
const ExcelJS = require('exceljs');

const ROOT       = path.resolve(__dirname, '..');
const INPUT_DIR  = path.join(ROOT, 'Anschreiben', 'Input');
const XLSX_PATH  = path.join(ROOT, 'Anschreiben', 'KolibriInspect_PV_Leads_PLZ94.xlsx');
const CACHE_JSON = path.join(__dirname, '.cache', 'heimat94-leads.json');
const LINKS_JSON = path.join(ROOT, 'api', 'short-links.json');
const TARGET_SHEET = 'Heimat_PLZ94';

const PLZ_PREFIX = '94';
const MIN_KWP    = 100;          // Nur Anlagen ab 100 kWp (gewerblich relevant)

/* Aktion „Saisonabschluss 2026" — identisch zur bewährten Eichstätt-Kondition.
   Spiegel von api/promo-codes.js → SAISON-94-2026. */
const PAUSCHALE_LISTE = 190;
const PAUSCHALE_KLEIN = 95;      // < 500 kWp: 95 € statt 190 €
const PAUSCHALE_GROSS = 0;       // ≥ 500 kWp: Anfahrt entfällt komplett
const SCHWELLE_GROSS  = 500;
const AKTIONSCODE = 'SAISON-94-2026';
const AKTION_BIS  = '31. Oktober 2026';
const REF_TAG     = 'saison-94-2026';

/* Kurzlink pro Empfänger: https://www.kolibri-inspect.de/a/<TOKEN>
   → 302 auf die vorbefüllte angebot.html (Route in api/server.js).

   Zwei Gründe, den langen Deeplink nicht direkt in den QR zu legen:
   1) Scanbarkeit — die vorbefüllte URL ist ~200 Zeichen (QR-Version 9/10,
      53–57 Module). Bei 26 mm Druckgröße sind das ~0,4 mm pro Modul, unter
      der Empfehlung von 0,5 mm. Der Kurzlink kommt mit ~37 Zeichen aus
      (Version 3, 29 Module) → ~0,7 mm pro Modul.
   2) Der Kurzlink ist abtippbar und liefert pro Brief eine eigene Kennung,
      also eine Response-Messung, die nicht am ?ref-Parameter hängt. */
const SHORT_HOST  = 'https://www.kolibri-inspect.de';
const TOKEN_LEN   = 5;
/* Ohne 0/O/1/I/L — die Verwechslungen beim Abtippen vom Papier. */
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/* Über TOKEN_SALT bleiben Tokens zwischen Läufen stabil; ohne gesetzte
   Umgebungsvariable wird ein Default verwendet — dann sind sie reproduzierbar,
   aber ratbar. Für den Livelauf eine echte Zufallsvariable setzen. */
const TOKEN_SALT  = process.env.TOKEN_SALT || 'kolibri-heimat94';

/* Priorisierung: Anlagen, deren Errichter-Gewährleistung noch läuft, tragen den
   Aufhänger. Innerhalb des Fensters zählt die Anlagengröße. */
const GW_FENSTER_MONATE = 18;    // 0–18 Monate Restlaufzeit = Vorrang
const WELLE_1_GROESSE   = 150;

/* Bestandskunden nicht erneut anschreiben.
   Die Liste steht in der .env, nicht hier: dieses Repository ist öffentlich,
   und wer bei uns Kunde ist, geht niemanden etwas an.
   Format:  EXCLUDE_SEE=SEE123...,SEE456...   ·   EXCLUDE_FIRMA=name1|name2 */
const EXCLUDE_SEE = (process.env.EXCLUDE_SEE || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const EXCLUDE_FIRMA_REGEX = process.env.EXCLUDE_FIRMA
  ? new RegExp(`\\b(${process.env.EXCLUDE_FIRMA})\\b`, 'i')
  : null;

const DRY_RUN    = process.argv.includes('--dry-run');
const FROM_CACHE = process.argv.includes('--from-cache');

// MaStR-Codes
const PERSONENART_NATUERLICH = '518';
const PERSONENART_JURISTISCH = '517';
const BETRIEBSSTATUS_IN_BETRIEB = '35';   // Katalogkategorie 4

/* ── Ertragsabschätzung ──
   Nur für die Größenordnung im Anschreiben. Beide Annahmen stehen als
   Fußnote im Brief, damit der Empfänger sie gegen seine eigenen Zahlen
   halten kann. Bewusst konservativ gewählt. */
const ERTRAG_KWH_PRO_KWP = 950;   // spezifischer Jahresertrag Niederbayern
const STROMWERT_EUR_KWH  = 0.08;  // Einspeisevergütung/Marktwert, konservativ

/* ── Messsaison ──
   DIN EN IEC 62446-3 verlangt ≥ 600 W/m². Daraus ergibt sich das nutzbare
   Fenster; die Daten entscheiden pro Empfänger, ob es die letzte
   Gelegenheit vor Fristablauf ist. */
const SAISON_ENDE            = new Date(2026, 9, 31);   // 31.10.2026
const SAISON_START_NAECHSTE  = new Date(2027, 2, 1);    // 01.03.2027

/* ───────── Hilfen (übernommen aus extract-mastr-plz86.js) ───────── */
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
function gwEndeDatum(ibn) {
  if (!ibn) return null;
  const ende = new Date(ibn);
  ende.setFullYear(ende.getFullYear() + 5);
  return ende;
}
function monateBisGwEnde(ibn, jetzt = new Date()) {
  const ende = gwEndeDatum(ibn);
  if (!ende) return null;
  return Math.round((ende - jetzt) / (1000 * 60 * 60 * 24 * 30.44));
}

/* ── Katalogwerte auflösen ──
   MaStR speichert Anlagentyp, Ausrichtung usw. als Zahlencodes. Die
   Bedeutung steht in Katalogwerte.xml des Gesamtdatenexports – auflösen
   statt Codes im Skript festzuschreiben, sonst veraltet die Zuordnung
   stillschweigend. */
function ladeKatalog() {
  const datei = path.join(INPUT_DIR, 'Katalogwerte.xml');
  if (!fs.existsSync(datei)) {
    console.log('⚠ Katalogwerte.xml fehlt — Anlagentyp und Ausrichtung bleiben leer.');
    return new Map();
  }
  const text = readUtf16(datei);
  const map = new Map();
  for (const m of text.matchAll(/<Katalogwert><Id>(\d+)<\/Id><Wert>([^<]*)<\/Wert>/g)) {
    map.set(m[1], m[2]);
  }
  console.log(`Katalogwerte: ${map.size} Einträge geladen`);
  return map;
}

/* „Bauliche Anlagen (Hausdach, Gebäude und Fassade)" ist im Brief zu sperrig. */
function kurzAnlagentyp(wert) {
  if (!wert) return '';
  if (/^Freifläche/i.test(wert)) return 'Freiflächenanlage';
  if (/Hausdach|Gebäude|Fassade/i.test(wert)) return 'Dachanlage';
  if (/Großparkplatz/i.test(wert)) return 'Parkplatzanlage';
  if (/Gewässer/i.test(wert)) return 'Schwimmende Anlage';
  return wert;
}

function ableitenAnrede(personenart, ansprechpartner) {
  if (ansprechpartner && /^(Herr|Frau)\b/i.test(String(ansprechpartner).trim())) {
    return `Sehr geehrte/r ${ansprechpartner}`;
  }
  return 'Sehr geehrte Damen und Herren';
}

function fmtEur(n) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDateDe(d = new Date()) {
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

/* Deterministischer Token aus der MaStR-Einheitennummer: derselbe Lauf auf
   denselben Daten erzeugt dieselben Tokens, ein Nachdruck einzelner Briefe
   bleibt also gültig. Kollisionen werden beim Aufbau der Map abgefangen. */
function tokenFor(seed, versuch = 0) {
  const h = crypto.createHash('sha256').update(`${TOKEN_SALT}|${seed}|${versuch}`).digest();
  let t = '';
  for (let i = 0; i < TOKEN_LEN; i++) t += TOKEN_ALPHABET[h[i] % TOKEN_ALPHABET.length];
  return t;
}

/* ───────── Preis-Staffel (Spiegel von angebot.html / api/server.js) ───────── */
const PRICE_TIERS = [
  { max: 500,      rate: 0.80 },
  { max: 1500,     rate: 0.70 },
  { max: 3000,     rate: 0.60 },
  { max: 5000,     rate: 0.50 },
  { max: Infinity, rate: 0.40 },
];
function ratePerModule(modules) {
  return PRICE_TIERS.find(t => modules <= t.max).rate;
}

/* Modulanzahl plausibilisieren: unrealistisch kleine Werte über 350 Wp/Modul schätzen */
function fixModule(mod, kwp) {
  let m = Math.round(mod || 0);
  if (m < kwp / 0.6) m = Math.round(kwp * 1000 / 350);
  return Math.max(1, m);
}

/* ───────── SAX-Helper: flacher Record-Parser (aus extract-mastr-plz86.js) ───────── */
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
    parser.onerror = () => { parser.error = null; parser.resume(); /* tolerate */ };
    parser.onend = () => resolve();

    const text = readUtf16(file);
    try {
      const SZ = 1 << 20;
      for (let i = 0; i < text.length; i += SZ) parser.write(text.slice(i, i + SZ));
      parser.close();
    } catch (e) { reject(e); }
  });
}

/* ───────── Pass 1: PV-Anlagen in PLZ 94 ───────── */
async function findePvAnlagen() {
  const files = listInput('EinheitenSolar_');
  if (!files.length) {
    throw new Error(`Keine EinheitenSolar_*.xml in ${INPUT_DIR} — MaStR-Gesamtdatenexport fehlt.`);
  }
  console.log(`EinheitenSolar: ${files.length} Datei(en)`);
  const proBetreiber = new Map();
  let geprueft = 0, plzHit = 0, kwpHit = 0, ohneBetreiber = 0, excludedSee = 0, nichtInBetrieb = 0;

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
      /* Stillgelegte oder erst geplante Anlagen nicht anschreiben. */
      if (r.EinheitBetriebsstatus && r.EinheitBetriebsstatus !== BETRIEBSSTATUS_IN_BETRIEB) {
        nichtInBetrieb++; return;
      }
      const einheitMastr = r.EinheitMastrNummer || '';
      if (EXCLUDE_SEE.includes(einheitMastr)) { excludedSee++; return; }
      const betreiberMastr = r.AnlagenbetreiberMastrNummer;
      if (!betreiberMastr) { ohneBetreiber++; return; }
      p++;
      const eintrag = {
        einheitMastr,
        betreiberMastr,
        ortAnlage:      r.Ort || '',
        plzAnlage:      plz,
        strasseAnlage:  r.Strasse || '',
        gemeinde:       r.Gemeinde || '',
        landkreis:      r.Landkreis || '',
        kwp,
        module:         parseInt(r.AnzahlModule, 10) || 0,
        anlagenname:    r.NameStromerzeugungseinheit || '',
        inbetriebnahme: parseDateIso(r.Inbetriebnahmedatum),
        /* Katalogcodes – werden später über Katalogwerte.xml aufgelöst */
        lageCode:            r.Lage || '',
        ausrichtungCode:     r.Hauptausrichtung || '',
        nutzungsbereichCode: r.Nutzungsbereich || '',
        einspeisungCode:     r.Einspeisungsart || '',
      };
      const prev = proBetreiber.get(betreiberMastr);
      if (!prev || eintrag.kwp > prev.kwp) proBetreiber.set(betreiberMastr, eintrag);
    });
    console.log(`${p} Treffer in PLZ ${PLZ_PREFIX}`);
  }
  console.log(`→ geprüft: ${geprueft} · PLZ ${PLZ_PREFIX}: ${plzHit} · ≥${MIN_KWP} kWp: ${kwpHit}`);
  console.log(`  ausgeschlossen: ${excludedSee} Bestandskunden · ${nichtInBetrieb} nicht in Betrieb `
    + `· ${ohneBetreiber} ohne Betreiber-Nr.`);
  console.log(`→ Eindeutige Betreiber (größte Anlage): ${proBetreiber.size}`);
  return proBetreiber;
}

/* ───────── Pass 2: Adressen zu genau diesen Betreibern ───────── */
async function ladeBetreiberAdressen(mastrNummern) {
  const files = listInput('Marktakteure_');
  if (!files.length) {
    throw new Error(`Keine Marktakteure_*.xml in ${INPUT_DIR} — MaStR-Gesamtdatenexport fehlt.`);
  }
  console.log(`\nMarktakteure: ${files.length} Datei(en) — gesucht: ${mastrNummern.size} Betreiber`);
  const idx = new Map();
  for (const file of files) {
    process.stdout.write(`  ${path.basename(file)} … `);
    let n = 0;
    await streamRecords(file, 'Marktakteur', r => {
      if (!r.MastrNummer || !mastrNummern.has(r.MastrNummer)) return;
      n++;
      idx.set(r.MastrNummer, {
        firma:        (r.Firmenname || '').replace(/＆/g, '&'),
        email:        (r.Email || '').trim().toLowerCase(),
        telefon:      r.Telefon || '',
        webseite:     r.Webseite || '',
        strasse:      r.Strasse || '',
        hausnummer:   r.Hausnummer || '',
        plzBetreiber: r.Postleitzahl || '',
        ortBetreiber: r.Ort || '',
        personenart:  r.Personenart || '',
      });
    });
    console.log(`${n} Treffer`);
  }
  console.log(`→ Adressen gefunden: ${idx.size} von ${mastrNummern.size}`);
  return idx;
}

/* ───────── Zeilen bauen ───────── */
function baueZeilen(anlagen, akteure, katalog) {
  const datum = fmtDateDe();
  const jetzt = new Date();
  const kat = code => (code && katalog.get(String(code))) || '';
  const zaehler = { keinName: 0, anonym: 0, keineAdresse: 0, bestandskunde: 0, keinAkteur: 0 };

  const rows = [];
  for (const a of anlagen.values()) {
    const b = akteure.get(a.betreiberMastr);
    if (!b) { zaehler.keinAkteur++; continue; }
    if (!b.firma) { zaehler.keinName++; continue; }
    if (/^anonym/i.test(b.firma)) { zaehler.anonym++; continue; }
    if (EXCLUDE_FIRMA_REGEX && EXCLUDE_FIRMA_REGEX.test(b.firma)) { zaehler.bestandskunde++; continue; }

    const plzB = (b.plzBetreiber || '').padStart(5, '0');
    if (!b.strasse || !b.ortBetreiber || plzB === '00000') { zaehler.keineAdresse++; continue; }

    const mod   = fixModule(a.module, a.kwp);
    const rate  = ratePerModule(mod);
    const preisModule = Math.round(mod * rate * 100) / 100;
    const pauschaleAktion  = a.kwp >= SCHWELLE_GROSS ? PAUSCHALE_GROSS : PAUSCHALE_KLEIN;
    const preisNetto       = Math.round((pauschaleAktion + preisModule) * 100) / 100;
    const preisNettoListe  = Math.round((PAUSCHALE_LISTE + preisModule) * 100) / 100;
    const ersparnis        = Math.round((preisNettoListe - preisNetto) * 100) / 100;

    const gwEnde  = gwEndeDatum(a.inbetriebnahme);
    const gwMonate = monateBisGwEnde(a.inbetriebnahme, jetzt);

    /* Ertragsgrößenordnung aus der Anlagenleistung – macht den
       Ertragsverlust im Brief zu einer Zahl statt zu einem Adjektiv. */
    const jahresertrag = Math.round(a.kwp * ERTRAG_KWH_PRO_KWP);
    const wertProzent  = Math.round(jahresertrag * 0.01 * STROMWERT_EUR_KWH);

    /* Ist diese Saison die letzte Messgelegenheit vor Fristablauf?
       Ja, wenn die Frist endet, bevor das Messfenster wieder aufgeht. */
    const letzteSaison = gwEnde ? (gwEnde < SAISON_START_NAECHSTE) : false;

    const url = new URL('https://www.kolibri-inspect.de/angebot.html');
    url.searchParams.set('company_name', b.firma);
    url.searchParams.set('kwp', String(Math.round(a.kwp * 100) / 100));
    url.searchParams.set('module_count', String(mod));
    if (a.strasseAnlage) url.searchParams.set('Strasse_Hausnummer', a.strasseAnlage);
    url.searchParams.set('Postleitzahl', a.plzAnlage);
    url.searchParams.set('stadt', a.ortAnlage);
    url.searchParams.set('promo', AKTIONSCODE);
    url.searchParams.set('ref', REF_TAG);

    rows.push({
      FIRMENNAME:        b.firma,
      ANSPRECHPARTNER:   '',
      ANREDE:            ableitenAnrede(b.personenart, ''),
      STRASSE_HAUSNR:    [b.strasse, b.hausnummer].filter(Boolean).join(' ').trim(),
      PLZ:               plzB,
      ORT:               b.ortBetreiber,
      ORT_ANLAGE:        a.ortAnlage || a.gemeinde,
      LEISTUNG_KWP:      Math.round(a.kwp * 100) / 100,
      ANZAHL_MODULE:     mod,
      PREIS_PRO_MODUL:   fmtEur(rate),
      PREIS_MODULE:      fmtEur(preisModule),
      PAUSCHALE:         pauschaleAktion === 0 ? '0,00 (entfällt)' : fmtEur(pauschaleAktion),
      PAUSCHALE_LISTE:   fmtEur(PAUSCHALE_LISTE),
      PREIS_NETTO_LISTE: fmtEur(preisNettoListe),
      PREIS_NETTO:       fmtEur(preisNetto),
      ERSPARNIS:         fmtEur(ersparnis),
      AKTION_TYP:        a.kwp >= SCHWELLE_GROSS ? 'gross' : 'klein',
      IBN_MONAT_JAHR:    fmtMonatJahr(a.inbetriebnahme),
      IBN_ISO:           a.inbetriebnahme ? a.inbetriebnahme.toISOString().slice(0, 10) : '',
      GW_ENDE_MONAT:     fmtMonatJahr(gwEnde),
      GW_ENDE_ISO:       gwEnde ? gwEnde.toISOString().slice(0, 10) : '',
      MONATE_BIS_GW_ENDE: gwMonate == null ? '' : gwMonate,
      LETZTE_SAISON:     letzteSaison ? 'ja' : 'nein',
      /* Stammdaten für die Individualisierung */
      ANLAGENTYP:        kurzAnlagentyp(kat(a.lageCode)),
      AUSRICHTUNG:       kat(a.ausrichtungCode),
      NUTZUNGSBEREICH:   kat(a.nutzungsbereichCode),
      EINSPEISUNGSART:   kat(a.einspeisungCode),
      LANDKREIS:         a.landkreis,
      ANLAGENNAME:       a.anlagenname,
      /* Ertragsgrößenordnung */
      JAHRESERTRAG_KWH:  jahresertrag,
      WERT_1_PROZENT_EUR: wertProzent,
      MASTR_SEE:         a.einheitMastr,
      DATUM:             datum,
      AKTIONSCODE,
      AKTION_BIS,
      BEAUFTRAGEN_URL:   url.toString(),
      _gwMonate:         gwMonate,
    });
  }

  console.log(`\nVerworfen: ${zaehler.keinAkteur} ohne Akteur-Datensatz · ${zaehler.keinName} ohne Firmenname · `
    + `${zaehler.anonym} anonym · ${zaehler.keineAdresse} ohne Postanschrift · ${zaehler.bestandskunde} Bestandskunde`);

  /* Dedup auf die Empfängeranschrift: eine Firma bekommt einen Brief,
     auch wenn sie mehrere Betreiber-Nummern führt (analog Eichstätt). */
  const dedup = new Map();
  for (const r of rows) {
    const key = [r.FIRMENNAME, r.STRASSE_HAUSNR, r.PLZ].join('|').toLowerCase();
    const prev = dedup.get(key);
    if (!prev || r.LEISTUNG_KWP > prev.LEISTUNG_KWP) dedup.set(key, r);
  }
  console.log(`Adress-Dedup: ${rows.length - dedup.size} Duplikate entfernt → ${dedup.size} Briefe möglich`);

  /* Priorisierung: laufende Gewährleistung zuerst (0–18 Monate Restlaufzeit),
     darin nach Anlagengröße. Abgelaufene oder unbekannte Fristen ans Ende —
     für sie trägt der Aufhänger nicht. */
  const sortiert = [...dedup.values()].sort((a, b) => {
    const grp = r => {
      const m = r._gwMonate;
      if (m == null) return 2;                              // IBN unbekannt
      if (m >= 0 && m <= GW_FENSTER_MONATE) return 0;       // im Fenster
      if (m > GW_FENSTER_MONATE) return 1;                  // noch lange Frist
      return 3;                                             // abgelaufen
    };
    const ga = grp(a), gb = grp(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0 && a._gwMonate !== b._gwMonate) return a._gwMonate - b._gwMonate;  // knappste Frist zuerst
    return b.LEISTUNG_KWP - a.LEISTUNG_KWP;
  });

  /* Token erst nach dem Dedup vergeben – ein Token pro tatsächlichem Brief. */
  const vergeben = new Set();
  sortiert.forEach((r, i) => {
    r.PRIO_RANG = i + 1;
    r.WELLE = i < WELLE_1_GROESSE ? 1 : 2;

    let versuch = 0, token = tokenFor(r.MASTR_SEE || r.FIRMENNAME, versuch);
    while (vergeben.has(token)) token = tokenFor(r.MASTR_SEE || r.FIRMENNAME, ++versuch);
    vergeben.add(token);
    r.TOKEN    = token;
    r.KURZLINK = `${SHORT_HOST}/a/${token}`;

    delete r._gwMonate;
  });
  return sortiert;
}

/* Token → Ziel-URL für die Redirect-Route in api/server.js.
   Enthält bewusst nur, was für Weiterleitung und Auswertung nötig ist. */
function schreibeShortLinks(rows) {
  const map = {};
  for (const r of rows) {
    map[r.TOKEN] = {
      url:      r.BEAUFTRAGEN_URL,
      firma:    r.FIRMENNAME,
      mastr:    r.MASTR_SEE,
      kampagne: REF_TAG,
      welle:    r.WELLE,
    };
  }
  fs.mkdirSync(path.dirname(LINKS_JSON), { recursive: true });
  /* Bestehende Einträge anderer Kampagnen erhalten. */
  let vorhanden = {};
  if (fs.existsSync(LINKS_JSON)) {
    try { vorhanden = JSON.parse(fs.readFileSync(LINKS_JSON, 'utf8')); }
    catch (e) { console.log(`⚠ ${path.basename(LINKS_JSON)} nicht lesbar (${e.message}) — wird neu angelegt.`); }
  }
  const fremd = Object.entries(vorhanden).filter(([, v]) => v.kampagne !== REF_TAG);
  const merged = { ...Object.fromEntries(fremd), ...map };
  fs.writeFileSync(LINKS_JSON, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`✓ ${Object.keys(map).length} Kurzlinks in ${LINKS_JSON}`
    + (fremd.length ? ` (${fremd.length} Einträge anderer Kampagnen erhalten)` : ''));
}

/* ───────── Excel schreiben ───────── */
const COLUMNS = [
  { header: 'WELLE',              key: 'WELLE',              width: 7  },
  { header: 'PRIO_RANG',          key: 'PRIO_RANG',          width: 10 },
  { header: 'FIRMENNAME',         key: 'FIRMENNAME',         width: 38 },
  { header: 'ANSPRECHPARTNER',    key: 'ANSPRECHPARTNER',    width: 24 },
  { header: 'ANREDE',             key: 'ANREDE',             width: 30 },
  { header: 'STRASSE_HAUSNR',     key: 'STRASSE_HAUSNR',     width: 28 },
  { header: 'PLZ',                key: 'PLZ',                width: 7  },
  { header: 'ORT',                key: 'ORT',                width: 18 },
  { header: 'ORT_ANLAGE',         key: 'ORT_ANLAGE',         width: 18 },
  { header: 'LEISTUNG_KWP',       key: 'LEISTUNG_KWP',       width: 12 },
  { header: 'ANZAHL_MODULE',      key: 'ANZAHL_MODULE',      width: 12 },
  { header: 'ANLAGENTYP',         key: 'ANLAGENTYP',         width: 18 },
  { header: 'AUSRICHTUNG',        key: 'AUSRICHTUNG',        width: 13 },
  { header: 'NUTZUNGSBEREICH',    key: 'NUTZUNGSBEREICH',    width: 24 },
  { header: 'EINSPEISUNGSART',    key: 'EINSPEISUNGSART',    width: 24 },
  { header: 'LANDKREIS',          key: 'LANDKREIS',          width: 20 },
  { header: 'ANLAGENNAME',        key: 'ANLAGENNAME',        width: 28 },
  { header: 'IBN_MONAT_JAHR',     key: 'IBN_MONAT_JAHR',     width: 16 },
  { header: 'IBN_ISO',            key: 'IBN_ISO',            width: 12 },
  { header: 'GW_ENDE_MONAT',      key: 'GW_ENDE_MONAT',      width: 16 },
  { header: 'GW_ENDE_ISO',        key: 'GW_ENDE_ISO',        width: 12 },
  { header: 'MONATE_BIS_GW_ENDE', key: 'MONATE_BIS_GW_ENDE', width: 18 },
  { header: 'LETZTE_SAISON',      key: 'LETZTE_SAISON',      width: 13 },
  { header: 'JAHRESERTRAG_KWH',   key: 'JAHRESERTRAG_KWH',   width: 17 },
  { header: 'WERT_1_PROZENT_EUR', key: 'WERT_1_PROZENT_EUR', width: 18 },
  { header: 'PREIS_PRO_MODUL',    key: 'PREIS_PRO_MODUL',    width: 14 },
  { header: 'PREIS_MODULE',       key: 'PREIS_MODULE',       width: 14 },
  { header: 'PAUSCHALE',          key: 'PAUSCHALE',          width: 14 },
  { header: 'PAUSCHALE_LISTE',    key: 'PAUSCHALE_LISTE',    width: 14 },
  { header: 'PREIS_NETTO_LISTE',  key: 'PREIS_NETTO_LISTE',  width: 16 },
  { header: 'PREIS_NETTO',        key: 'PREIS_NETTO',        width: 14 },
  { header: 'ERSPARNIS',          key: 'ERSPARNIS',          width: 12 },
  { header: 'AKTION_TYP',         key: 'AKTION_TYP',         width: 11 },
  { header: 'MASTR_SEE',          key: 'MASTR_SEE',          width: 18 },
  { header: 'DATUM',              key: 'DATUM',              width: 12 },
  { header: 'AKTIONSCODE',        key: 'AKTIONSCODE',        width: 18 },
  { header: 'AKTION_BIS',         key: 'AKTION_BIS',         width: 18 },
  { header: 'TOKEN',              key: 'TOKEN',              width: 9  },
  { header: 'KURZLINK',           key: 'KURZLINK',           width: 38 },
  { header: 'BEAUFTRAGEN_URL',    key: 'BEAUFTRAGEN_URL',    width: 60 },
];

async function schreibeExcel(rows) {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(XLSX_PATH)) {
    try {
      await wb.xlsx.readFile(XLSX_PATH);
    } catch (e) {
      console.log(`⚠ Bestehende Datei ${path.basename(XLSX_PATH)} nicht lesbar (${e.code || e.message}) — schreibe neu.`);
    }
  }

  let ws = wb.getWorksheet(TARGET_SHEET);
  if (ws) {
    console.log(`Sheet "${TARGET_SHEET}" existiert — wird ersetzt.`);
    wb.removeWorksheet(ws.id);
  }
  ws = wb.addWorksheet(TARGET_SHEET);
  ws.columns = COLUMNS;

  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF167E74' } };
  hdr.alignment = { vertical: 'middle', horizontal: 'left' };
  hdr.height = 22;

  rows.forEach(r => ws.addRow(r));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  await wb.xlsx.writeFile(XLSX_PATH);
  console.log(`\n✓ ${rows.length} Zeilen ins Sheet "${TARGET_SHEET}" geschrieben.`);
  console.log(`  Datei: ${XLSX_PATH}`);
  console.log(`  Seriendruck in Word auf WELLE = 1 filtern (${rows.filter(r => r.WELLE === 1).length} Briefe).`);
}

/* ───────── Main ───────── */
(async () => {
  console.log(`MaStR-Extraktion PLZ ${PLZ_PREFIX} (≥${MIN_KWP} kWp, Postanschrift Pflicht)`);
  if (DRY_RUN) console.log('[DRY-RUN] – Excel wird nicht geschrieben.\n');

  if (FROM_CACHE) {
    if (!fs.existsSync(CACHE_JSON)) {
      console.error(`✗ Kein Cache: ${CACHE_JSON}`); process.exit(1);
    }
    const rows = JSON.parse(fs.readFileSync(CACHE_JSON, 'utf8'));
    console.log(`Aus Cache geladen: ${rows.length} Zeilen`);
    if (!DRY_RUN) { schreibeShortLinks(rows); await schreibeExcel(rows); }
    return;
  }

  const t0 = Date.now();
  const katalog = ladeKatalog();
  const anlagen = await findePvAnlagen();
  const akteure = await ladeBetreiberAdressen(new Set(anlagen.keys()));
  const rows    = baueZeilen(anlagen, akteure, katalog);

  if (!rows.length) { console.log('Keine Treffer – Abbruch.'); return; }

  /* Verteilung der Gewährleistungs-Restlaufzeit — Grundlage für die Bewertung,
     ob die Welle-1-Größe von ${WELLE_1_GROESSE} passt. */
  const bucket = { 'a 0-6 Mon.': 0, 'b 7-12 Mon.': 0, 'c 13-18 Mon.': 0, 'd >18 Mon.': 0, 'e abgelaufen': 0, 'f unbekannt': 0 };
  for (const r of rows) {
    const m = r.MONATE_BIS_GW_ENDE;
    if (m === '') bucket['f unbekannt']++;
    else if (m < 0) bucket['e abgelaufen']++;
    else if (m <= 6) bucket['a 0-6 Mon.']++;
    else if (m <= 12) bucket['b 7-12 Mon.']++;
    else if (m <= 18) bucket['c 13-18 Mon.']++;
    else bucket['d >18 Mon.']++;
  }
  console.log('\nRestlaufzeit Gewährleistung (§ 634a BGB, IBN + 5 Jahre):');
  console.table(bucket);

  console.log('\nTop-15 nach Priorität:');
  console.table(rows.slice(0, 15).map(r => ({
    Rang: r.PRIO_RANG, GW_Mon: r.MONATE_BIS_GW_ENDE, GW_Ende: r.GW_ENDE_MONAT,
    kWp: r.LEISTUNG_KWP, Mod: r.ANZAHL_MODULE,
    PLZ: r.PLZ, Ort_Anlage: String(r.ORT_ANLAGE).slice(0, 14),
    Firma: String(r.FIRMENNAME).slice(0, 34),
    Netto: r.PREIS_NETTO + ' €',
  })));

  console.log(`\nDauer: ${Math.round((Date.now() - t0) / 1000)} s`);

  fs.mkdirSync(path.dirname(CACHE_JSON), { recursive: true });
  fs.writeFileSync(CACHE_JSON, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`JSON-Cache: ${CACHE_JSON} (${rows.length} Zeilen)`);

  if (DRY_RUN) { console.log('[DRY-RUN] – Excel und Kurzlinks nicht geschrieben.'); return; }
  try {
    schreibeShortLinks(rows);
    await schreibeExcel(rows);
  } catch (e) {
    console.error(`\n✗ Excel-Schreiben fehlgeschlagen: ${e.code || ''} ${e.message}`);
    console.error('  Tipp: Excel-Datei schließen (falls in Office offen) und neu starten mit:');
    console.error('    node scripts/extract-heimat-plz94.js --from-cache');
    process.exit(1);
  }
})().catch(err => {
  console.error('FEHLER:', err);
  process.exitCode = 1;
});
