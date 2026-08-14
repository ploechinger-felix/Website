/**
 * Musterbericht als PDF rendern.
 *
 * Der QR-Code im Anschreiben zeigt auf eine PDF-Datei statt auf eine
 * Landingpage: ein Empfänger, der vom Papier scannt, will den Bericht sehen,
 * nicht eine weitere Webseite. Die Datei liegt unter musterbericht.pdf im
 * Webroot und wird per FTP mit ausgeliefert.
 *
 * Quelle ist musterbericht.html – die Seite bringt bereits @media-print-Regeln
 * mit (Navigation, Kopf und Fuß ausgeblendet, weißer Grund).
 *
 * Aufruf:  node scripts/build-musterbericht-pdf.js
 */

const fs   = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT   = path.resolve(__dirname, '..');
const QUELLE = path.join(ROOT, 'musterbericht.html');
const ZIEL   = path.join(ROOT, 'musterbericht.pdf');

(async () => {
  if (!fs.existsSync(QUELLE)) {
    console.error(`✗ ${QUELLE} fehlt – ohne die Vorlage lässt sich das PDF nicht erzeugen.`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto('file://' + QUELLE.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
    /* Druckstil erzwingen, sonst rendert Chrome den Bildschirmzustand. */
    await page.emulateMediaType('print');
    await page.pdf({
      path: ZIEL,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:7pt;color:#666;padding:0 10mm;'
        + 'font-family:Arial,sans-serif;display:flex;justify-content:space-between">'
        + '<span>KolibriInspect · TGA Plöchinger GmbH · Musterbericht</span>'
        + '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }

  const kb = Math.round(fs.statSync(ZIEL).size / 1024);
  console.log(`✓ ${path.relative(ROOT, ZIEL)} erzeugt (${kb} KB)`);
  console.log('  Vor dem Versand einmal öffnen und die Seitenumbrüche prüfen.');
})().catch(e => { console.error('FEHLER:', e); process.exitCode = 1; });
