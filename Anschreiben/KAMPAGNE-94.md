# Kampagne „Saisonabschluss 2026" (PLZ 94)

> Für den reinen Versandablauf gibt es eine eigene Schritt-für-Schritt-Anleitung:
> [VERSAND-ANLEITUNG.md](VERSAND-ANLEITUNG.md)

Aufhänger: Ende der Errichter-Mängelhaftung (§ 634a BGB, 5 J.) + Messfenster
der Saison (IEC 62446-3, ≥ 600 W/m², schließt Ende Oktober).
Preis-Hebel: Saisonabschluss — die letzten Termine der Messsaison werden
gebündelt, die eingesparte Anfahrt wird weitergegeben: < 500 kWp 95 €,
ab 500 kWp 0 €. Aktionscode `SAISON-94-2026`, gültig bis 31.10.2026.

## Voraussetzungen

1. Node.js 24 LTS ist installiert (winget, User-Scope), `npm install` ist
   im Projektwurzelverzeichnis und in `api/` gelaufen. Die PATH-Änderung
   greift erst in einer **neu geöffneten** Shell.
2. MaStR-Gesamtdatenexport nach `Anschreiben/Input/` entpackt.
   Gebraucht werden `Marktakteure_*.xml` und `EinheitenSolar_*.xml` —
   die derzeit vorhandenen `Netzanschlusspunkte_*.xml` reichen nicht.
3. `.env.example` nach `.env` kopieren und ausfüllen (`LXP_USER`,
   `LXP_APIKEY`, `TOKEN_SALT`).
4. Briefschriften einmalig erzeugen:
   ```bash
   node scripts/build-print-fonts.js
   ```
   Entpackt Poppins und Open Sans aus `fonts/*.woff2` nach `fonts/print/*.ttf`,
   damit pdfkit sie einbetten kann. Ohne diesen Schritt fällt der Brief auf
   Helvetica zurück und sieht anders aus als die Website.

## Ablauf

```bash
node scripts/extract-heimat-plz94.js --dry-run
```
Trefferzahl und Verteilung der Gewährleistungs-Restlaufzeit prüfen. Dann ohne
`--dry-run` wiederholen → schreibt `KolibriInspect_PV_Leads_PLZ94.xlsx`
(Sheet `Heimat_PLZ94`) und `api/short-links.json`.

```bash
node scripts/generate-briefe-heimat94.js --limit 3
```
Drei Probebriefe nach `Anschreiben/Briefe_Heimat94/`. Prüfen: Anschrift im
Fensterbereich, Preise, Fristverlauf in der Messkarte, QR mit dem Handy scannen.

Das Skript warnt bei einer Seitenzahl ≠ 2 **und** wenn Seite 1 hinter 285 mm
endet — LetterXpress druckt die äußeren 3 mm nicht, ein technisch noch
passender Brief kann also trotzdem angeschnitten sein. Die gemessene Höhe
steht als `satzende_mm` in `_index.json`. Ursache finden mit `DEBUG_LAYOUT=1`.

Zusätzlich wird geprüft, ob der Grußblock auf Seite 2 in die Fußnote läuft.

Getestet über fünf Datensätze inkl. Randfällen (fehlendes
Inbetriebnahmedatum, abgelaufene Frist, sehr lange Firmen- und Ortsnamen):
Seite 1 endet bei 244–261 mm, alle zweiseitig, keine Warnung.

**Aufbau:** Seite 1 trägt das Argument — kompakte Messkarte mit Fristverlauf,
darunter die Befundtabelle mit Eurobeträgen. Seite 2 ist das Angebot: Preis,
Beauftragung, Fußnoten. Die Beispielrechnung in `befundRechnung()` rechnet
vier typische Befunde auf Leistung und Modulzahl der jeweiligen Anlage hoch;
alle Annahmen stehen als Konstanten im Skript und gesammelt in der Fußnote
auf Seite 2.

Ein Nachdruck einzelner Briefe (`--token`) ergänzt `_index.json`, statt es zu
ersetzen — die übrigen Briefe bleiben für den Versand erhalten.

Dann die volle Welle:
```bash
node scripts/generate-briefe-heimat94.js
```

```bash
node scripts/send-letterxpress.js --dry-run
node scripts/send-letterxpress.js --limit 1
```
Der zweite Aufruf reicht **einen** Brief im Testmodus ein — er landet im
LXP-Warenkorb, wird nicht produziert und nach 7 Tagen gelöscht. Dort die
Vorschau öffnen und die Adressposition gegen das Kuvertfenster prüfen.

Das Versandprotokoll wird pro Token **und Modus** geführt; ein Testlauf
blockiert den späteren Livelauf also nicht.

Für Layout-Tests ohne echte Leadliste: `--xlsx`/`--out` beim Generator und
`--dir` beim Versandskript zeigen auf ein beliebiges Verzeichnis.

Erst danach:
```bash
node scripts/send-letterxpress.js --live
```

## Kurzlinks scharfschalten

Der QR-Code zeigt auf `kolibri-inspect.de/a/<TOKEN>`. Damit das greift:

- `api/short-links.json` muss im API-Container liegen → `docker compose build api`
  nach jeder Extraktion, dann `docker compose up -d`.
- Der Traefik-Router `kolibri-short` in `docker-compose.yml` leitet `/a/` an die
  API. Ohne ihn landet der Scan beim Static-Container.
- Test nach dem Deploy: `curl -I https://www.kolibri-inspect.de/a/<TOKEN>`
  muss `302` mit `Location:` auf die vorbefüllte `angebot.html` liefern.

## Response messen

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://www.kolibri-inspect.de/api/kurzlink-hits
```
Liefert Aufrufe gesamt und die Zahl eindeutiger Briefe. Vergleichsmaßstab
Eichstätt: 43 Briefe → 2 Aufträge.

Welle 1 auswerten, bevor Welle 2 gedruckt wird
(`generate-briefe-heimat94.js --welle 2`).

## Kosten

LetterXpress, 2 Seiten A4 Farbe duplex, national: 1,00 € netto pro Brief
inkl. Material, Druck, Kuvertierung und Porto → 150 Briefe ≈ 150 € netto.
Preis vor dem Livelauf gegen die aktuelle Nettopreisliste prüfen.
