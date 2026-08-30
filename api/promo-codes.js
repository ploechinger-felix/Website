const PROMO_CODES = {
  NEU2026: {
    type: 'percent',
    discount: 0.10,
    validUntil: '2026-09-30',
    label: 'Erstinspektions-Rabatt 10 %',
  },
  'NACHBAR-EI-2026': {
    type: 'pauschale-override',
    pauschaleUnter500: 95,            // < 500 kWp: Anfahrt 95 € statt 190 €
    pauschaleAb500:    0,             // ≥ 500 kWp: Anfahrt entfällt komplett
    freikilometer:     200,           // 200 km Anreise frei (statt 100 km)
    schwelleKwp:       500,
    validUntil:        '2026-09-30',
    label:             'Aktion „Nachbarschaft Eichstätt"',
  },
  'NACHBAR-86-2026': {
    type: 'pauschale-override',
    pauschaleUnter500: 95,
    pauschaleAb500:    0,
    freikilometer:     200,
    schwelleKwp:       500,
    validUntil:        '2026-09-30',
    label:             'Aktion „Schwaben/PLZ 86 — Gewährleistungsfrist"',
  },
  'SAISON-94-2026': {
    type: 'pauschale-override',
    pauschaleUnter500: 95,            // < 500 kWp: Anfahrt 95 € statt 190 €
    pauschaleAb500:    0,             // ≥ 500 kWp: Anfahrt entfällt komplett
    freikilometer:     200,
    schwelleKwp:       500,
    // Saisonabschluss: das Messfenster nach DIN EN IEC 62446-3 (≥ 600 W/m²)
    // schließt Ende Oktober. Wir bündeln die letzten Termine der Saison und
    // geben die eingesparte Anfahrt weiter.
    validUntil:        '2026-10-31',
    label:             'Aktion „Saisonabschluss 2026"',
  },
  /* Gleiche Kondition wie SAISON-94-2026, aber für die E-Mail-Kampagne in
     PLZ 83/84/85. Eigener Code nur zur Trennung der Antwortwege: so ist an
     jeder Anfrage ablesbar, ob sie aus dem Brief oder aus dem Mailing kommt. */
  'SAISON-2026': {
    type: 'pauschale-override',
    pauschaleUnter500: 95,
    pauschaleAb500:    0,
    freikilometer:     200,
    schwelleKwp:       500,
    validUntil:        '2026-10-31',
    label:             'Aktion „Saisonabschluss 2026"',
  },
};

function resolvePromo(code) {
  if (!code) return null;
  const entry = PROMO_CODES[String(code).trim().toUpperCase()];
  if (!entry) return null;
  if (entry.validUntil && new Date(entry.validUntil) < new Date()) return null;
  return { code: String(code).trim().toUpperCase(), type: 'percent', ...entry };
}

module.exports = { PROMO_CODES, resolvePromo };
