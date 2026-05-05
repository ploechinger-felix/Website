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
};

function resolvePromo(code) {
  if (!code) return null;
  const entry = PROMO_CODES[String(code).trim().toUpperCase()];
  if (!entry) return null;
  if (entry.validUntil && new Date(entry.validUntil) < new Date()) return null;
  return { code: String(code).trim().toUpperCase(), type: 'percent', ...entry };
}

module.exports = { PROMO_CODES, resolvePromo };
