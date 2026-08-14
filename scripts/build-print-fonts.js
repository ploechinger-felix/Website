/**
 * woff2 → ttf für die Brief-PDFs.
 *
 * Die Website hostet ihre Schriften als woff2 (fonts/). pdfkit kann woff2
 * nicht einbetten, deshalb werden die benötigten Schnitte einmalig nach
 * fonts/print/ dekomprimiert. Damit tragen Brief und Landingpage dieselben
 * Schriften — und die PDFs haben eingebettete Fonts, wie es der
 * Druckdienstleister verlangt.
 *
 * Poppins und Open Sans stehen unter der SIL Open Font License; das
 * Einbetten in Dokumente ist ausdrücklich gestattet.
 *
 * Aufruf:  node scripts/build-print-fonts.js
 */

const fs   = require('fs');
const path = require('path');
const { decompress } = require('wawoff2');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'fonts');
const OUT  = path.join(SRC, 'print');

const DATEIEN = [
  ['opensans-latin.woff2', 'OpenSans-Regular.ttf'],
  ['poppins-400.woff2',    'Poppins-Regular.ttf'],
  ['poppins-500.woff2',    'Poppins-Medium.ttf'],
  ['poppins-600.woff2',    'Poppins-SemiBold.ttf'],
  ['poppins-700.woff2',    'Poppins-Bold.ttf'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [quelle, ziel] of DATEIEN) {
    const q = path.join(SRC, quelle);
    if (!fs.existsSync(q)) { console.log(`⚠ ${quelle} fehlt — übersprungen.`); continue; }
    const ttf = Buffer.from(await decompress(fs.readFileSync(q)));
    fs.writeFileSync(path.join(OUT, ziel), ttf);
    console.log(`✓ ${ziel.padEnd(24)} ${Math.round(ttf.length / 1024)} KB`);
  }
  console.log(`\nZiel: ${OUT}`);
})().catch(e => { console.error('FEHLER:', e); process.exitCode = 1; });
