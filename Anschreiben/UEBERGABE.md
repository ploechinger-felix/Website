# Übergabe: Kampagne „Saisonabschluss 2026" (PLZ 94)

Stand 14.08.2026. Dieses Dokument beschreibt, wo das Projekt steht, was auf
einem frischen Rechner fehlt und wie es weitergeht.

---

## Worum es geht

TGA Plöchinger GmbH (Marke „KolibriInspect") bietet Drohnen-Thermografie für
PV-Anlagen an. Ein Postmailing an 43 Betreiber im Raum Eichstätt hat im Mai
2026 **zwei Aufträge** erzeugt (≈ 4,7 % Response). Diese Mechanik wird jetzt
auf PLZ 94 übertragen.

**Aufhänger:** Ende der Errichter-Mängelhaftung (§ 634a Abs. 1 Nr. 2 BGB,
5 Jahre) kombiniert mit dem Messfenster der Saison (DIN EN IEC 62446-3
verlangt ≥ 600 W/m², schließt Ende Oktober). Beide Fristen sind echt und pro
Empfänger aus dem Marktstammdatenregister gerechnet.

**Rabatt:** Aktionscode `SAISON-94-2026` — Anfahrt 95 € statt 190 €, ab
500 kWp entfällt sie. Gültig bis 31.10.2026.

Details: [KAMPAGNE-94.md](KAMPAGNE-94.md) · Versandablauf:
[VERSAND-ANLEITUNG.md](VERSAND-ANLEITUNG.md)

---

## Was fertig und live ist

| | |
|---|---|
| GitHub | `ploechinger-felix/Website`, Commit `4396003` |
| `/musterbericht.pdf` | 200, `application/pdf` |
| `/a/:token` | 302 auf vorbefüllte `angebot.html` |
| `/api/kurzlink-hits` | 401 ohne Token |
| `/api/anfragen` mit `changeme` | 401 (war offen, ist behoben) |

VPS: Hostinger, Repo unter `/docker/kolibri_inspect`, Deploy per
`git pull && docker compose build web api && docker compose up -d`.

Lokal fertig und getestet: Leadextraktion, Briefgenerator (PDF je Empfänger),
LetterXpress-Versandskript, Musterbericht-PDF-Renderer, Schrift-Konverter.

---

## ⚠ Das Repository ist ÖFFENTLICH

`ploechinger-felix/Website` ist auf GitHub öffentlich lesbar, und der
web-Container baut mit `COPY . /usr/share/nginx/html` — alles im Repo landet
im Webroot. Niemals committen:

- `.env` (Zugangsdaten)
- `api/short-links.json` (Empfänger-Firmennamen)
- `Anschreiben/*` außer den drei `.md`-Dateien (Leadlisten, MaStR-Export)
- `Bestellungen/`, ausgelieferte Kundenberichte, Honorarrechnungen
- Skripte mit Kundennamen im Quelltext

`.gitignore` und `.dockerignore` decken das ab. Bei neuen Dateien vorher
`git status` prüfen.

---

## Was auf einem frischen Rechner fehlt

Der Klon enthält den Code, aber nicht die Daten und Zugangsdaten.

### 1. Node.js

Node 24 LTS. Auf dem Ursprungsrechner per `winget install OpenJS.NodeJS.LTS`
installiert (User-Scope, PATH erst in neuer Shell aktiv).

```bash
npm install
cd api && npm install && cd ..
```

### 2. Druckschriften

Nicht im Repo, werden erzeugt:

```bash
node scripts/build-print-fonts.js
```

Entpackt Poppins und Open Sans aus `fonts/*.woff2` nach `fonts/print/*.ttf`
(pdfkit kann kein woff2). Fehlt das Verzeichnis, fällt der Brief auf
Helvetica zurück und sieht anders aus als die Website.

### 3. `.env`

`.env.example` nach `.env` kopieren und ausfüllen:

| Schlüssel | Quelle |
|---|---|
| `LXP_USER`, `LXP_APIKEY` | LetterXpress-Kundenbereich |
| `TOKEN_SALT` | frei wählbar, muss konstant bleiben (siehe unten) |
| `EXCLUDE_SEE`, `EXCLUDE_FIRMA` | Bestandskunden, die nicht angeschrieben werden |

`TOKEN_SALT` bestimmt die Kurzlink-Tokens. Ändert er sich, ändern sich alle
Tokens — bereits gedruckte Briefe zeigen dann ins Leere. Einmal setzen,
sichern, nie mehr anfassen.

### 4. MaStR-Gesamtdatenexport — **das fehlt noch komplett**

Von marktstammdatenregister.de laden, entpacken nach `Anschreiben/Input/`.
Gebraucht werden `Marktakteure_*.xml`, `EinheitenSolar_*.xml` und
`Katalogwerte.xml`. Aktuell liegen dort nur `Netzanschlusspunkte_*.xml`, die
das Skript nicht verwendet.

Format: UTF-16 LE mit BOM, flache Records — die Parser erwarten das so.

---

## Nächste Schritte

```bash
node scripts/extract-heimat-plz94.js --dry-run
```

Trefferzahl und Verteilung der Gewährleistungs-Restlaufzeit prüfen, dann ohne
`--dry-run` wiederholen. Erzeugt `KolibriInspect_PV_Leads_PLZ94.xlsx`
(Sheet `Heimat_PLZ94`) und `api/short-links.json`.

```bash
node scripts/generate-briefe-heimat94.js --limit 3
```

Drei Probebriefe. **Warnungen ernst nehmen** — das Skript prüft Seitenzahl,
Satzspiegel und Spaltenbreiten. Ohne Warnung ist der Satz geprüft.

Dann Vollauflage, `short-links.json` per `docker compose cp` ins
`/data`-Volume des API-Containers, LetterXpress-Guthaben aufladen (steht auf
**0,00 €**), Testbrief einreichen, Vorschau prüfen, `--live`.

Reihenfolge und Befehle im Detail: [VERSAND-ANLEITUNG.md](VERSAND-ANLEITUNG.md).

---

## Aufbau der Briefe

Zwei Seiten A4, Farbe, beidseitig. Seite 1 trägt das Argument, Seite 2 das
Angebot.

**Seite 1:** Betreff („Drohnen-Thermografie Ihrer PV-Anlage in ORT (kWp)") ·
Absatz zur Frist · Zeitbalken Inbetriebnahme → heute → Fristende mit dem
Messfenster als zweitem Marker · Fazitsatz, der aus den Daten kommt („letzte
Messgelegenheit" oder „diese Saison oder die nächste") · bauartabhängiger
Absatz zur Messung · **Befundtabelle** mit vier Thermogrammen, Euro je Jahr
und hochgerechnet auf die Restlaufzeit der Einspeisung · Datenband mit den
Kennwerten, auf denen die Rechnung beruht.

**Seite 2:** Preistabelle · Bestellblock mit QR auf den Kurzlink ·
QR auf den Musterbericht · Grußformel · Fußnoten mit allen Annahmen.

Gestaltung folgt der Website: Poppins + Open Sans, Teal `#167E74`. Die
Schriften sind als Subset eingebettet, wie der Druckdienstleister es verlangt.

### Eingebaute Kontrollen

Diese Prüfungen sind aus echten Fehlern entstanden — nicht entfernen:

- **Seitenzahl ≠ 2** → Layout übergelaufen
- **Satzspiegel > 285 mm** → zu dicht am nicht bedruckbaren 3-mm-Rand; die
  Seitenzahl allein reicht als Kontrolle nicht, ein Brief kann technisch
  passen und trotzdem angeschnitten sein
- **Spaltenbreiten** in beiden Tabellen und allen Labels → `lineBreak: false`
  lässt zu breite Texte stumm in die Nachbarspalte laufen; umbrechende Labels
  überdrucken den Wert darunter
- `DEBUG_LAYOUT=1` gibt die Zwischenhöhen von Seite 1 aus

Getestet über fünf Datensätze inklusive Randfällen (fehlendes
Inbetriebnahmedatum, abgelaufene Frist, sehr lange Firmen- und Ortsnamen):
255–284 mm, alle zweiseitig.

---

## Rechnerische Annahmen

Stehen als Konstanten in `scripts/generate-briefe-heimat94.js` und als Fußnote
im Brief:

- 950 kWh je kWp und Jahr (Niederbayern, konservativ)
- 8 ct/kWh Strompreis
- 20 Jahre EEG-Einspeisedauer ab Inbetriebnahme
- Anomaliequote 2,8 % der Module (aus dem eigenen Musterbericht)
- Verlustanteile je Fehlerbild aus `index.html`

**Wichtig:** Die Prozentsätze je Fehlerbild (Zelldefekt bis 15 %,
Bypassdiode 11–26 %, Stringfehler bis 25 %) gelten **je betroffenem Modul**,
nicht für die Anlage. Gerechnet wird über Häufigkeit × Einzelverlust auf
Anlagenebene. Den Jahresertrag direkt mit 15 % zu multiplizieren wäre um
Größenordnungen zu hoch.

---

## Offene Entscheidungen

**Strompreis nach Einspeisungsart staffeln.** 8 ct/kWh passt für
Volleinspeisung. Bei hohem Eigenverbrauch wären 20–25 ct realistisch, was die
Beträge im Brief verdreifacht. Das Feld `EINSPEISUNGSART` liegt bereits in der
Leadliste — der Betreiber muss entscheiden, ob er das für belastbar hält.

**`scripts/ftp_*.py`** liegen lokal und enthalten ein Klartext-Passwort eines
anderen Kunden (NES Raumgestaltung). Sie sind gitignored, gehören aber
gelöscht; das Passwort sollte unabhängig davon gewechselt werden.

**Zugangsdaten rotieren.** LetterXpress-Key und der VPS-`ADMIN_TOKEN` wurden
im Chat übertragen und sollten neu erzeugt werden.

**`musterbericht.html`** sollte laut Auftrag gelöscht werden, existiert aber
noch — sie ist die einzige Quelle, aus der `musterbericht.pdf` erzeugt werden
kann (`node scripts/build-musterbericht-pdf.js`). Vor dem Löschen klären.

---

## Fallen, die schon zugeschlagen haben

- **Der lokale Klon war älter als `origin/master`** und hatte einen ungeborenen
  HEAD. Vor Änderungen immer `git log --oneline -1` und `git status` prüfen.
- **`git checkout -- .` setzt alle getrackten Dateien zurück**, nicht nur die
  gewünschten. Einzelne Pfade benennen.
- **Dateien fehlten lokal**, die im Remote existierten (u. a. das Logo, das
  jede HTML-Seite als Favicon referenziert) — vermutlich OneDrive-Sync. Ein
  Commit hätte sie von der Website gelöscht.
- **Der QR-Code muss vor dem Druck live sein.** Kurzlinks brauchen die
  Traefik-Regel `kolibri-short` und `short-links.json` im `/data`-Volume.
- **BOM in JSON.** Unter Windows erzeugte Dateien haben oft einen; der Server
  entfernt ihn beim Laden von `short-links.json` und protokolliert
  Parse-Fehler, statt sie zu schlucken.
