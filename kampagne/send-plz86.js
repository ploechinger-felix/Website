#!/usr/bin/env node
/**
 * Kolibri Inspect — Kampagne "PLZ 86 / Schwaben — Gewährleistungsfrist"
 *
 * Aufhänger: § 634a BGB — 5 Jahre Gewährleistung des Errichters.
 * Pro Empfänger wird die Rest-Gewährleistungszeit berechnet und in
 * Betreff/Body eingebaut. Aktion analog Eichstätt: Anfahrt < 500 kWp
 * = 95 €, ≥ 500 kWp = 0 € (Promo-Code NACHBAR-86-2026).
 *
 * Modi:
 *   node send-plz86.js                          → Dry-Run (Default)
 *   node send-plz86.js --send                   → echter Versand
 *   node send-plz86.js --send --only=x@y.de     → nur eine Adresse
 *   node send-plz86.js --send --limit=5         → erste 5 Leads
 *   node send-plz86.js --preview=0              → HTML/Plain-Vorschau Lead #0
 *   node send-plz86.js --skip-expired           → nur Empfänger mit GW-Restzeit > 0
 */

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const xlsx       = require('xlsx');
const nodemailer = require('nodemailer');
const { resolvePromo } = require('../api/promo-codes');

// ── Konfiguration ─────────────────────────────────────────
const SMTP_HOST       = process.env.SMTP_HOST       || 'smtp.hostinger.com';
const SMTP_PORT       = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE     = process.env.SMTP_SECURE !== 'false';
const SMTP_USER       = process.env.SMTP_USER       || '';
const SMTP_PASS       = process.env.SMTP_PASS       || '';
const MAIL_FROM       = process.env.MAIL_FROM       || SMTP_USER;
const MAIL_FROM_NAME  = process.env.MAIL_FROM_NAME  || 'Kolibri Inspect';
const MAIL_REPLY_TO   = process.env.MAIL_REPLY_TO   || 'info@kolibri-inspect.de';
const CAMPAIGN_BASE   = process.env.CAMPAIGN_BASE_URL || 'https://kolibri-inspect.de/angebot.html';
const MUSTERBERICHT_URL = process.env.MUSTERBERICHT_URL || 'https://kolibri-inspect.de/musterbericht.pdf';
const CAMPAIGN_REF    = 'kampagne-plz86-gewaehrleistung';
const PROMO_CODE      = 'NACHBAR-86-2026';
const AKTION_BIS      = '30. September 2026';
const MIN_KWP_FILTER  = parseFloat(process.env.MIN_KWP_FILTER || '100');  // nur Anlagen ≥100 kWp
const EXCEL_PATH      = process.env.EXCEL_PATH      || '../Anschreiben/KolibriInspect_PV_Leads_PLZ86.xlsx';
const EXCEL_SHEET     = process.env.EXCEL_SHEET     || 'PLZ_86_Mail';
const THROTTLE_MS     = parseInt(process.env.THROTTLE_MS || '1500', 10);

// ── CLI-Args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);
const opt  = name => {
  const a = args.find(x => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : null;
};
const SEND        = flag('send');
const DRY_RUN     = !SEND;
const ONLY        = opt('only');
const LIMIT       = opt('limit') ? parseInt(opt('limit'), 10) : null;
const PREVIEW     = opt('preview') !== null ? parseInt(opt('preview'), 10) : null;
const SKIP_EXPIRED = flag('skip-expired');

// ── Preis-Staffel (Spiegel von api/server.js + angebot.html) ────
const PRICE_TIERS = [
  { max: 500,      rate: 0.80 },
  { max: 1500,     rate: 0.70 },
  { max: 3000,     rate: 0.60 },
  { max: 5000,     rate: 0.50 },
  { max: Infinity, rate: 0.40 },
];
const SALZWEG = { lat: 48.5577, lng: 13.4442 };
const ANFAHRT_RATE = 0.50;
const PAUSCHALE_LISTE = 190;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function geocode(plz, ort) {
  const q = encodeURIComponent(`${plz} ${ort}, Deutschland`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'KolibriInspect-Kampagne/1.0' } });
    const data = await res.json();
    if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) { /* fallback */ }
  return null;
}

/* ── Excel laden ── */
function loadLeads() {
  const filePath = path.resolve(__dirname, EXCEL_PATH);
  if (!fs.existsSync(filePath)) throw new Error(`Excel nicht gefunden: ${filePath}`);
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[EXCEL_SHEET];
  if (!ws) throw new Error(`Sheet "${EXCEL_SHEET}" nicht in ${filePath}`);
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  return rows.map(r => ({
    firmenname:      String(r['Firmenname'] || '').trim(),
    ansprechpartner: String(r['Ansprechpartner'] || '').trim(),
    anrede_raw:      String(r['Anrede'] || '').trim().replace(/[,;]\s*$/, ''),
    email:           String(r['E-Mail'] || '').trim().toLowerCase(),
    plz:             String(r['PLZ'] || '').trim(),
    ort:             String(r['Ort'] || '').trim(),
    strasse:         String(r['Straße + Nr.'] || r['Strasse + Nr.'] || '').trim(),
    plz_anlage:      String(r['PLZ (Anlage)'] || r['PLZ'] || '').trim(),
    ort_anlage:      String(r['Ort (Anlage)'] || r['Ort'] || '').trim(),
    kwp:             parseFloat(r['Leistung (kWp)']) || null,
    module:          parseInt(r['Module'], 10) || null,
    inbetriebnahme:  r['Inbetriebnahme'],
    gw_monate_sheet: r['Monate bis GW-Ende'],
  })).filter(l => l.email && l.module && l.kwp && l.kwp >= MIN_KWP_FILTER);
}

/* ── Inline-Bilder als cid-Attachments ── */
const BILDER_DIR = path.resolve(__dirname, '..', 'Bilder');
const INLINE_IMAGES = [
  { cid: 'img_zellfehler',     filename: 'Zellfehler.PNG' },
  { cid: 'img_diodenfehler',   filename: 'Diodenfehler.PNG' },
  { cid: 'img_stringfehler',   filename: 'Stringfehler.PNG' },
  { cid: 'img_verschmutzung',  filename: 'Verschmutzung.PNG' },
];
function buildAttachments() {
  return INLINE_IMAGES.map(i => ({
    filename: i.filename,
    path: path.join(BILDER_DIR, i.filename),
    cid: i.cid,
    contentDisposition: 'inline',
  }));
}

/* ── Subject-Rotation (Anti-Spam) ────────────────────────────
   Pro Empfänger eine Variante deterministisch ableiten — verhindert
   identische Massen-Subjects (Spam-Heuristik) und bleibt reproduzierbar
   für spätere Nachfass-Mails (kein erneutes Versenden mit gleichem Wortlaut).
*/
function pickSubject(lead, vars) {
  const variants = (gw) => {
    const ort = vars.ort_anlage;
    const kwp = vars.kwp;
    const m   = vars.gewaehr_monate_rest;
    if (gw === 'expired') {
      return [
        `PV-Anlage ${ort} (${kwp} kWp) — Bestandsdokumentation nach Ablauf der Errichter-Frist`,
        `Ihre PV-Anlage in ${ort}: technische Bestandsaufnahme nach Gewährleistungs-Ablauf`,
        `Thermografie-Bestandsaufnahme für Ihre Anlage in ${ort} (${kwp} kWp)`,
      ];
    }
    if (m <= 12) {
      return [
        `${ort}: Hinweis zur Errichter-Gewährleistung Ihrer PV-Anlage (§ 634a BGB)`,
        `Ihre PV-Anlage in ${ort} — Fristhinweis zur 5-Jahres-Gewährleistung`,
        `Fristhinweis ${ort} (${kwp} kWp): Gewährleistungs-Frist Ihrer Anlage`,
      ];
    }
    return [
      `Ihre PV-Anlage in ${ort} (${kwp} kWp) — Hinweis zur Gewährleistung nach § 634a BGB`,
      `${ort}: technische Bestandsaufnahme Ihrer PV-Anlage vor Fristablauf`,
      `PV-Anlage ${ort} (${kwp} kWp): Hinweis zur Errichter-Gewährleistung`,
    ];
  };
  const gw = gewaehrleistung(lead);
  const list = variants(gw && gw.abgelaufen ? 'expired' : (gw && gw.monateRest <= 12 ? 'soon' : 'normal'));
  // deterministischer Index aus E-Mail-Hash
  let h = 0;
  for (let i = 0; i < lead.email.length; i++) h = ((h << 5) - h + lead.email.charCodeAt(i)) | 0;
  return list[Math.abs(h) % list.length];
}

/* ── Anrede + IBN-Formatierung ── */
function buildAnrede(lead) {
  const raw = (lead.anrede_raw || '').trim();
  return raw || 'Sehr geehrte Damen und Herren';
}

const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
function parseAnyDate(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') return new Date(Math.round((value - 25569) * 86400 * 1000));
  if (typeof value === 'string') {
    const m1 = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m1) return new Date(parseInt(m1[3]), parseInt(m1[2])-1, parseInt(m1[1]));
    const m2 = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2])-1, parseInt(m2[3]));
    const t = new Date(value); if (!isNaN(t)) return t;
  }
  return null;
}
function fmtMonatJahr(d) { return d ? `${MONATE[d.getMonth()]} ${d.getFullYear()}` : ''; }
function buildIbnSatz(lead) {
  const d = parseAnyDate(lead.inbetriebnahme);
  return d ? `im ${fmtMonatJahr(d)} in Betrieb genommen` : 'vor einigen Jahren in Betrieb genommen';
}

/* ── Gewährleistungs-Logik ── */
function gewaehrleistung(lead) {
  const ibn = parseAnyDate(lead.inbetriebnahme);
  if (!ibn) return null;
  const ende = new Date(ibn); ende.setFullYear(ende.getFullYear() + 5);
  let monateRest;
  if (lead.gw_monate_sheet !== '' && Number.isFinite(parseFloat(lead.gw_monate_sheet))) {
    monateRest = Math.round(parseFloat(lead.gw_monate_sheet));
  } else {
    monateRest = Math.round((ende - new Date()) / (1000*60*60*24*30.44));
  }
  return { ibn, ende, monateRest, abgelaufen: monateRest <= 0 };
}

function buildGewaehrTexte(gw) {
  if (!gw) {
    return {
      gewaehr_kurz: 'Bestandsdokumentation',
      gewaehr_status_html: 'liegt das genaue Datum der Abnahme nicht vor — auf jeden Fall ist eine unabhängige Bestandsaufnahme sinnvoll',
      gewaehr_status_text: 'liegt das genaue Datum der Abnahme nicht vor',
      gewaehr_ende_datum: 'unbekannt',
      gewaehr_monate_rest: '?',
      betreff_zusatz: 'unabhängige Bestandsaufnahme',
    };
  }
  const m = gw.monateRest;
  let kurz, statusHtml, statusText, betreff;
  if (gw.abgelaufen) {
    kurz       = 'Bestandsdokumentation nach Ablauf';
    statusHtml = 'ist die Errichter-Gewährleistung bereits abgelaufen — eine Bestandsdokumentation dient Versicherung, Wartungsverträgen und einem späteren Anlagenverkauf';
    statusText = 'ist die Errichter-Gewährleistung bereits abgelaufen';
    betreff    = 'Bestandsdokumentation für Versicherung & Wartung';
  } else if (m <= 12) {
    kurz       = `noch ${m} Monate bis Fristablauf`;
    statusHtml = `<strong>nur noch ${m} Monate</strong> — Beweissicherung jetzt noch fristwahrend möglich`;
    statusText = `nur noch ${m} Monate — Beweissicherung jetzt`;
    betreff    = `nur noch ${m} Monate bis Ablauf der Gewährleistung`;
  } else if (m <= 24) {
    kurz       = `${m} Monate bis Fristablauf`;
    statusHtml = `nur noch <strong>${m} Monate</strong>`;
    statusText = `nur noch ${m} Monate`;
    betreff    = `${m} Monate bis Ablauf der Gewährleistung`;
  } else {
    kurz       = `${m} Monate bis Fristablauf`;
    statusHtml = `noch <strong>${m} Monate</strong>`;
    statusText = `noch ${m} Monate`;
    betreff    = `${m} Monate bis Ablauf der Gewährleistung`;
  }
  return {
    gewaehr_kurz: kurz,
    gewaehr_status_html: statusHtml,
    gewaehr_status_text: statusText,
    gewaehr_ende_datum: fmtMonatJahr(gw.ende),
    gewaehr_monate_rest: m,
    betreff_zusatz: betreff,
  };
}

/* ── CTA-URL ── */
function buildCtaUrl(lead) {
  const params = new URLSearchParams({
    company_name: lead.firmenname || '',
    kwp: String(lead.kwp),
    module_count: String(lead.module),
    anlage_typ: 'Schrägdach',
    Strasse_Hausnummer: lead.strasse,
    Postleitzahl: lead.plz_anlage || lead.plz,
    stadt: lead.ort_anlage || lead.ort,
    contact_name: lead.ansprechpartner,
    email: lead.email,
    promo: PROMO_CODE,
    ref: CAMPAIGN_REF,
    utm_source: 'email',
    utm_medium: 'campaign',
    utm_campaign: CAMPAIGN_REF,
  });
  return `${CAMPAIGN_BASE}?${params.toString()}`;
}

const fmtEUR = n => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtKwp = n => n == null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(n);

function renderHtml(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] != null ? String(vars[k]) : '');
}

function buildPlainText(vars) {
  return [
    vars.subject,
    '',
    vars.anrede + ',',
    '',
    `Ihre Photovoltaikanlage in ${vars.ort_anlage} wurde ${vars.ibn_satz}.`,
    `Nach § 634a BGB endet die Gewährleistung des Errichters fünf Jahre nach Abnahme --`,
    `in Ihrem Fall ${vars.gewaehr_status_text} (voraussichtlich ${vars.gewaehr_ende_datum}).`,
    'Ab diesem Zeitpunkt liegen Mängelbeseitigung und Ertragsausfälle wirtschaftlich bei Ihnen.',
    '',
    'Aus ingenieurfachlicher Sicht ist es sinnvoll, vor Fristablauf eine unabhängige',
    'thermografische Bestandsaufnahme zu haben -- als belastbaren Mängelnachweis,',
    'falls später Ertragsabweichungen oder Folgeschäden auftreten.',
    '',
    'Konkret für Ihre Anlage:',
    `Bei ${vars.module} Modulen sind nach Studie von TÜV Rheinland und DB Schenker`,
    `statistisch ${vars.betroffene_module_min}-${vars.betroffene_module_max} Module bereits durch Transport/Handling`,
    'mit Mikrorissen vorbelastet -- visuell nicht erkennbar, unter Betriebslast aber',
    'Ursache dauerhafter Ertragsverluste.',
    '',
    `Musterbericht: ${vars.musterbericht_url}`,
    '',
    `Ihr Angebot (Aktion "Schwaben/PLZ 86"):`,
    `- Anfahrtspauschale: ${vars.pauschale_aktion_label} (Listenpreis 190,00 EUR)`,
    `- Thermografie ${vars.module} Module à ${vars.preis_pro_modul} EUR/Mod. = ${vars.preis_module} EUR`,
    `- Gesamt netto: ${vars.preis_netto} EUR (statt regulär ${vars.preis_netto_liste} EUR), zzgl. MwSt.`,
    '',
    `Aktion gültig bis ${vars.aktion_bis}. Vorausgefülltes Angebot, Aktionscode ${vars.promo_code} hinterlegt:`,
    vars.cta_url,
    '',
    'Bei Rückfragen: info@kolibri-inspect.de | +49 179 1599311',
    '',
    'Mit freundlichen Grüßen',
    'Dipl.-Ing. Friedrich Plöchinger',
    'TGA Plöchinger GmbH | Kolibri Inspect',
    '',
    '--',
    'TGA Plöchinger GmbH | Passauer Str. 20 | 94121 Salzweg | USt-IdNr. DE 322 015 971',
    'Impressum: https://kolibri-inspect.de/impressum.html | Datenschutz: https://kolibri-inspect.de/datenschutz.html',
    'Sie erhalten diese E-Mail als Betreiber einer im Marktstammdatenregister gelisteten PV-Anlage.',
    'Wenn Sie keine weiteren Nachrichten wünschen, antworten Sie bitte mit "Abmelden".',
  ].join('\n');
}

async function buildMailVars(lead) {
  const coords = await geocode(lead.plz_anlage || lead.plz, lead.ort_anlage || lead.ort);
  const distKm = coords ? Math.round(haversineKm(SALZWEG.lat, SALZWEG.lng, coords.lat, coords.lng)) : 0;

  // Für computePrice: pauschale-override schaltet anhand kWp, daher kWp statt module übergeben
  // (wir übernehmen denselben Ansatz wie angebot.html: Schwelle auf kWp).
  const m = lead.module;
  const promo = resolvePromo(PROMO_CODE);
  const tier  = PRICE_TIERS.find(t => m <= t.max);
  const preisModule = Math.round(m * tier.rate * 100) / 100;

  // Anfahrt-Zuschlag (für sehr weite Anfahrten — bei 200 km Freikilometer i. d. R. 0)
  const freikmAktion = promo?.freikilometer || 100;
  const zuschlagAktion = distKm > freikmAktion ? Math.round((distKm - freikmAktion) * ANFAHRT_RATE * 100) / 100 : 0;
  const zuschlagListe  = distKm > 100         ? Math.round((distKm - 100)          * ANFAHRT_RATE * 100) / 100 : 0;

  let pauschaleAktion;
  if (promo && promo.type === 'pauschale-override') {
    pauschaleAktion = lead.kwp >= (promo.schwelleKwp || 500) ? promo.pauschaleAb500 : promo.pauschaleUnter500;
  } else {
    pauschaleAktion = PAUSCHALE_LISTE;
  }

  const nettoListe  = Math.round((PAUSCHALE_LISTE  + preisModule + zuschlagListe)  * 100) / 100;
  const nettoAktion = Math.round((pauschaleAktion  + preisModule + zuschlagAktion) * 100) / 100;

  const gw = gewaehrleistung(lead);
  const gwTxt = buildGewaehrTexte(gw);

  const pauschaleAktionLabel = pauschaleAktion === 0
    ? '0,00 € (entfällt)'
    : `${fmtEUR(pauschaleAktion)} €`;

  // TÜV/DB Schenker: 5-10 % der Module mit Mikrorissen
  const betroffenMin = Math.max(1, Math.round(m * 0.05));
  const betroffenMax = Math.max(betroffenMin + 1, Math.round(m * 0.10));

  const vars = {
    anrede:  buildAnrede(lead),
    kwp:     fmtKwp(lead.kwp),
    module:  m,
    ort_anlage: lead.ort_anlage || lead.ort || '–',
    ibn_satz: buildIbnSatz(lead),
    ...gwTxt,
    promo_code: PROMO_CODE,
    aktion_bis: AKTION_BIS,
    preis_pro_modul: fmtEUR(tier.rate),
    preis_module:    fmtEUR(preisModule),
    pauschale_aktion_label: pauschaleAktionLabel,
    preis_netto:       fmtEUR(nettoAktion),
    preis_netto_liste: fmtEUR(nettoListe),
    cta_url: buildCtaUrl(lead),
    musterbericht_url: MUSTERBERICHT_URL,
    betroffene_module_min: betroffenMin,
    betroffene_module_max: betroffenMax,
    distance_km: distKm,
  };
  vars.subject = pickSubject(lead, vars);
  return vars;
}

// ── Logging ───────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const LOG_PATH = path.join(LOG_DIR, `plz86-${today}.log`);
function log(rec) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...rec });
  fs.appendFileSync(LOG_PATH, line + '\n');
  console.log(line);
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'LIVE'}] Kampagne PLZ 86 — Gewährleistung — Start`);
  console.log(`Excel: ${EXCEL_PATH} (Sheet: ${EXCEL_SHEET})`);

  let leads = loadLeads();
  console.log(`Geladene Leads mit Email/kWp/Module: ${leads.length}`);

  if (SKIP_EXPIRED) {
    const before = leads.length;
    leads = leads.filter(l => {
      const gw = gewaehrleistung(l);
      return gw && !gw.abgelaufen;
    });
    console.log(`--skip-expired: ${before - leads.length} Empfänger ohne laufende Gewährleistung übersprungen → ${leads.length} verbleiben`);
  }
  if (ONLY)  leads = leads.filter(l => l.email === ONLY.toLowerCase());
  if (LIMIT) leads = leads.slice(0, LIMIT);
  console.log(`Nach Filter: ${leads.length} Empfänger`);

  if (PREVIEW != null) {
    const lead = leads[PREVIEW];
    if (!lead) { console.error(`Kein Lead an Index ${PREVIEW}.`); process.exit(1); }
    const vars = await buildMailVars(lead);
    const tpl  = fs.readFileSync(path.join(__dirname, 'mail-template-plz86.html'), 'utf8');
    console.log('\n──── Empfänger ────');
    console.log(`${lead.firmenname} <${lead.email}> · ${lead.kwp} kWp · ${lead.module} Mod. · IBN ${lead.inbetriebnahme}`);
    console.log('\n──── HTML-Preview ────\n' + renderHtml(tpl, vars));
    console.log('\n──── Plaintext ────\n' + buildPlainText(vars));
    console.log('\n──── CTA-URL ────\n' + vars.cta_url);
    return;
  }

  if (!DRY_RUN && (!SMTP_USER || !SMTP_PASS)) {
    console.error('FEHLER: SMTP_USER / SMTP_PASS fehlen in kampagne/.env'); process.exit(1);
  }

  const transporter = DRY_RUN ? null : nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  if (transporter) {
    try { await transporter.verify(); console.log('SMTP-Verbindung verifiziert.'); }
    catch (e) { console.error('SMTP-Verifikation fehlgeschlagen:', e.message); process.exit(1); }
  }

  const tpl = fs.readFileSync(path.join(__dirname, 'mail-template-plz86.html'), 'utf8');
  let okCount = 0, failCount = 0;

  for (const lead of leads) {
    try {
      const vars = await buildMailVars(lead);
      const html = renderHtml(tpl, vars);
      const text = buildPlainText(vars);

      if (DRY_RUN) {
        log({ status: 'dry-run', email: lead.email, company: lead.firmenname,
              kwp: lead.kwp, gw_mon: vars.gewaehr_monate_rest,
              netto: vars.preis_netto, cta: vars.cta_url });
      } else {
        await transporter.sendMail({
          from: `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`,
          to: lead.email,
          replyTo: MAIL_REPLY_TO,
          subject: vars.subject,
          html, text,
          attachments: buildAttachments(),
          headers: {
            'X-Campaign-Ref': CAMPAIGN_REF,
            'List-Unsubscribe': `<mailto:${MAIL_REPLY_TO}?subject=Abmelden>`,
          },
        });
        log({ status: 'sent', email: lead.email, company: lead.firmenname,
              kwp: lead.kwp, gw_mon: vars.gewaehr_monate_rest, netto: vars.preis_netto });
      }
      okCount++;
      if (THROTTLE_MS > 0 && !DRY_RUN) await new Promise(r => setTimeout(r, THROTTLE_MS));
    } catch (e) {
      log({ status: 'error', email: lead.email, company: lead.firmenname, error: e.message });
      failCount++;
    }
  }

  console.log(`\nFertig. ${DRY_RUN ? 'DRY-RUN — nichts versendet.' : `Versendet: ${okCount}, Fehler: ${failCount}`}`);
  console.log(`Log: ${LOG_PATH}`);
}

main().catch(e => { console.error('Fataler Fehler:', e); process.exit(1); });
