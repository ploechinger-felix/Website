#!/usr/bin/env node
/**
 * Kolibri Inspect — Kampagnen-Mailversand "Neuanlagen-Erstinspektion"
 *
 * Modi:
 *   node send-neuanlage.js                          → Dry-Run (Default), keine Mails
 *   node send-neuanlage.js --send                   → echter Versand an alle gefilterten Leads
 *   node send-neuanlage.js --send --only=x@y.de     → nur an eine Adresse (Test)
 *   node send-neuanlage.js --send --limit=3         → nur die ersten 3 Leads versenden
 *   node send-neuanlage.js --preview=2              → HTML-Vorschau zu Lead #2 in stdout
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
const CAMPAIGN_REF    = process.env.CAMPAIGN_REF    || 'kampagne-neuanlage';
const PROMO_CODE      = process.env.PROMO_CODE      || 'NEU2026';
const EXCEL_PATH      = process.env.EXCEL_PATH      || '../Anschreiben/KolibriInspect_PV_Leads.xlsx';
const EXCEL_SHEET     = process.env.EXCEL_SHEET     || 'Neuanlage';
const THROTTLE_MS     = parseInt(process.env.THROTTLE_MS || '1000', 10);

// ── CLI-Args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = name => args.includes('--' + name);
const opt  = name => {
  const a = args.find(x => x.startsWith('--' + name + '='));
  return a ? a.slice(name.length + 3) : null;
};
const SEND     = flag('send');
const DRY_RUN  = !SEND;
const ONLY     = opt('only');
const LIMIT    = opt('limit') ? parseInt(opt('limit'), 10) : null;
const PREVIEW  = opt('preview') !== null ? parseInt(opt('preview'), 10) : null;

// ── Preisberechnung (gleiche Logik wie api/server.js) ─────
const PRICE_TIERS = [
  { max: 500,      rate: 0.80 },
  { max: 1500,     rate: 0.70 },
  { max: 3000,     rate: 0.60 },
  { max: 5000,     rate: 0.50 },
  { max: Infinity, rate: 0.40 },
];
const SALZWEG = { lat: 48.5577, lng: 13.4442 };
const ANFAHRT_RATE = 0.50;

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
  } catch (e) { /* fallback: 0 km */ }
  return null;
}

function computePrice(moduleCount, anfahrtZuschlag = 0, promoCode = null) {
  const m = parseInt(moduleCount, 10);
  const tier = PRICE_TIERS.find(t => m <= t.max);
  const modulkosten   = Math.round(m * tier.rate * 100) / 100;
  const nettoVorRabatt = Math.round((190 + modulkosten + anfahrtZuschlag) * 100) / 100;
  const promo  = resolvePromo(promoCode);
  const rabatt = promo ? Math.round(nettoVorRabatt * promo.discount * 100) / 100 : 0;
  const nettoGesamt  = Math.round((nettoVorRabatt - rabatt) * 100) / 100;
  const mwst         = Math.round(nettoGesamt * 0.19 * 100) / 100;
  const brutto       = Math.round((nettoGesamt + mwst) * 100) / 100;
  const bruttoOhne   = Math.round(nettoVorRabatt * 1.19 * 100) / 100;
  return {
    rate: tier.rate, modulkosten, anfahrtZuschlag, nettoVorRabatt,
    rabatt, rabattProzent: promo ? promo.discount : 0, rabattCode: promo ? promo.code : null,
    nettoGesamt, mwst, brutto, bruttoOhne,
  };
}

// ── Excel laden + Lead-Mapping ────────────────────────────
function loadLeads() {
  const filePath = path.resolve(__dirname, EXCEL_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel nicht gefunden: ${filePath}`);
  }
  const wb = xlsx.readFile(filePath);
  const ws = wb.Sheets[EXCEL_SHEET];
  if (!ws) throw new Error(`Sheet "${EXCEL_SHEET}" nicht in ${filePath}`);
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

  // Sheet "Neuanlage" enthält keine Anlagenart-Spalte → Default Schrägdach
  // (statistisch häufigster Fall; Empfänger kann im Formular ändern).
  const DEFAULT_ANLAGE_TYP = 'Schrägdach';

  return rows.map(r => ({
    firmenname:      String(r['Firmenname'] || '').trim(),
    ansprechpartner: String(r['Ansprechpartner'] || '').trim(),
    anrede_raw:      String(r['Anrede'] || '').trim().replace(/[,;]\s*$/, ''),
    email:           String(r['E-Mail'] || '').trim().toLowerCase(),
    plz_anlage:      String(r['PLZ'] || '').trim(),
    ort_anlage:      String(r['Ort (Anlage)'] || r['Ort'] || '').trim(),
    strasse_anlage:  String(r['Straße + Nr.'] || r['Strasse + Nr.'] || '').trim(),
    kwp:             parseFloat(r['Leistung (kWp)']) || null,
    module:          parseInt(r['Module'], 10) || null,
    anlage_typ:      DEFAULT_ANLAGE_TYP,
    inbetriebnahme:  r['Inbetriebnahme'],
  })).filter(l => l.email && l.module && l.kwp);
}

// ── Personalisierung ──────────────────────────────────────
function buildAnrede(lead) {
  // Excel "Anrede" enthält i. d. R. den vollständigen Anredesatz, z. B.
  //   "Sehr geehrte Damen und Herren"  oder  "Sehr geehrter Herr Müller"
  // → 1:1 übernehmen, nur trailing comma/semicolon entfernen.
  const raw = (lead.anrede_raw || '').trim();
  if (raw) return raw;
  return 'Sehr geehrte Damen und Herren';
}

const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
function fmtIBN(value) {
  if (!value && value !== 0) return null;
  let d = null;
  if (typeof value === 'number') {
    d = new Date(Math.round((value - 25569) * 86400 * 1000)); // Excel Serial → JS Date
  } else if (typeof value === 'string') {
    const m = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) d = new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
    else { const t = new Date(value); if (!isNaN(t)) d = t; }
  }
  if (!d || isNaN(d)) return null;
  return `${MONATE[d.getMonth()]} ${d.getFullYear()}`;
}

function buildIbnSatz(lead) {
  const ibn = fmtIBN(lead.inbetriebnahme);
  return ibn ? `im ${ibn} in Betrieb genommen` : 'kürzlich in Betrieb genommen';
}

function fmtKwp(n) {
  if (n == null) return '–';
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(n);
}

function buildCtaUrl(lead, price) {
  const params = new URLSearchParams({
    company_name: lead.firmenname || '',
    kwp: String(lead.kwp),
    module_count: String(lead.module),
    anlage_typ: lead.anlage_typ,
    Strasse_Hausnummer: lead.strasse_anlage,
    Postleitzahl: lead.plz_anlage,
    stadt: lead.ort_anlage,
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
    'Direkt nach Inbetriebnahme ist der ideale Zeitpunkt fuer eine unabhaengige thermografische Erstinspektion --',
    'bevor sich Montage- oder Installationsmaengel zu echten Ertragsverlusten entwickeln.',
    '',
    'Hintergrund:',
    'TUV Rheinland und DB Schenker zeigen, dass 5-10 % aller PV-Module bereits',
    'durch Transport/Handling beschaedigt werden -- meist durch Mikrorisse, die optisch nicht sichtbar sind.',
    'Hinzu kommen typische Installationsfehler (MC4-Steckverbindungen, Uebergangswiderstaende, Verpolungen).',
    '',
    `Ihr Angebot fuer ${vars.module} Module inkl. ${vars.rabatt_prozent}% Erstinspektions-Rabatt:`,
    `${vars.brutto_mit_rabatt} EUR brutto (statt regulaer ${vars.brutto_ohne_rabatt} EUR)`,
    '',
    `Direkt zum vorausgefuellten Angebot (Rabattcode ${vars.promo_code} ist hinterlegt):`,
    vars.cta_url,
    '',
    'Bei Rueckfragen: info@kolibri-inspect.de | +49 179 1599311',
    '',
    'Mit freundlichen Gruessen',
    'Dipl.-Ing. Friedrich Ploechinger',
    'Kolibri Inspect',
    '',
    '--',
    'Kolibri Inspect | TGA Ploechinger GmbH | Passauer Str. 20 | 94121 Salzweg',
    'Impressum: https://kolibri-inspect.de/impressum.html',
    'Wenn Sie keine weiteren Nachrichten wuenschen, antworten Sie bitte mit "Abmelden".',
  ].join('\n');
}

async function buildMailVars(lead) {
  // Distanz für Anfahrtszuschlag
  const coords = await geocode(lead.plz_anlage, lead.ort_anlage);
  const distKm = coords ? Math.round(haversineKm(SALZWEG.lat, SALZWEG.lng, coords.lat, coords.lng)) : 0;
  const extraKm = Math.max(0, distKm - 100);
  const anfahrt = extraKm > 0 ? Math.round(extraKm * ANFAHRT_RATE * 100) / 100 : 0;

  const price = computePrice(lead.module, anfahrt, PROMO_CODE);
  const cta   = buildCtaUrl(lead, price);

  return {
    subject: `Ihre neue PV-Anlage (${fmtKwp(lead.kwp)} kWp): Erstinspektion sichert Ihre Gewährleistung`,
    anrede:  buildAnrede(lead),
    kwp:     fmtKwp(lead.kwp),
    module:  lead.module,
    ort_anlage: lead.ort_anlage || '–',
    ibn_satz: buildIbnSatz(lead),
    rabatt_prozent:    Math.round(price.rabattProzent * 100),
    brutto_mit_rabatt: fmtEUR(price.brutto),
    brutto_ohne_rabatt: fmtEUR(price.bruttoOhne),
    promo_code: PROMO_CODE,
    cta_url: cta,
    distance_km: distKm,
  };
}

// ── Logging ───────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const LOG_PATH = path.join(LOG_DIR, `neuanlage-${today}.log`);
function log(rec) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...rec });
  fs.appendFileSync(LOG_PATH, line + '\n');
  console.log(line);
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'LIVE'}] Kolibri Kampagne Neuanlage — Start`);
  console.log(`Excel: ${EXCEL_PATH} (Sheet: ${EXCEL_SHEET})`);

  let leads = loadLeads();
  console.log(`Geladene Leads mit gültiger E-Mail/Modulanzahl/kWp: ${leads.length}`);

  if (ONLY) leads = leads.filter(l => l.email === ONLY.toLowerCase());
  if (LIMIT) leads = leads.slice(0, LIMIT);
  console.log(`Nach Filter: ${leads.length} Empfänger`);

  if (PREVIEW != null) {
    const lead = leads[PREVIEW];
    if (!lead) { console.error(`Kein Lead an Index ${PREVIEW}.`); process.exit(1); }
    const vars = await buildMailVars(lead);
    const tpl  = fs.readFileSync(path.join(__dirname, 'mail-template.html'), 'utf8');
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

  const tpl = fs.readFileSync(path.join(__dirname, 'mail-template.html'), 'utf8');
  let okCount = 0, failCount = 0;

  for (const lead of leads) {
    try {
      const vars = await buildMailVars(lead);
      const html = renderHtml(tpl, vars);
      const text = buildPlainText(vars);

      if (DRY_RUN) {
        log({ status: 'dry-run', email: lead.email, company: lead.firmenname, brutto: vars.brutto_mit_rabatt, cta: vars.cta_url });
      } else {
        await transporter.sendMail({
          from: `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`,
          to: lead.email,
          replyTo: MAIL_REPLY_TO,
          subject: vars.subject,
          html, text,
          headers: {
            'X-Campaign-Ref': CAMPAIGN_REF,
            'List-Unsubscribe': `<mailto:${MAIL_REPLY_TO}?subject=Abmelden>`,
          },
        });
        log({ status: 'sent', email: lead.email, company: lead.firmenname, brutto: vars.brutto_mit_rabatt });
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
