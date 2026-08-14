# Anschreiben digital rausschicken, physisch zustellen

Du lädst PDFs über eine Schnittstelle hoch, ein Dienstleister druckt, kuvertiert,
frankiert und gibt bei der Deutschen Post ein. Kein Drucker, kein Briefmarken-
kauf, kein Gang zum Briefkasten.

**Kosten:** 1,00 € netto je Brief (2 Seiten A4, Farbe, beidseitig, Inland,
inkl. Material, Druck, Kuvertierung und Porto). 150 Briefe ≈ 150 € netto.

**Laufzeit:** Einlieferung am Folgewerktag nach Freigabe, Zustellung wie
Standardbrief.

---

## Einmalig einrichten

### 1. Konto bei LetterXpress

Auf letterxpress.de registrieren (Geschäftskunde, TGA Plöchinger GmbH).
Keine Vertragslaufzeit, keine Grundgebühr. Guthaben aufladen — der Versand
wird gegen Guthaben abgerechnet, nicht auf Rechnung.

### 2. API-Key erzeugen

Im Kundenbereich unter *API* einen Key anlegen. Du bekommst zwei Werte:
Benutzername und API-Key.

### 3. Zugangsdaten hinterlegen

`.env.example` im Projektwurzelverzeichnis nach `.env` kopieren und eintragen:

```
LXP_USER=deinbenutzername
LXP_APIKEY=der-lange-schluessel
```

Die `.env` steht in `.gitignore` und wird nicht mit hochgeladen.

### 4. Auftragsverarbeitungsvertrag

LetterXpress verarbeitet Empfängeradressen in deinem Auftrag. Den AV-Vertrag
nach Art. 28 DSGVO im Kundenbereich abschließen und ablegen — er gehört ins
Verarbeitungsverzeichnis, ebenso die Rechtsgrundlage der Kaltakquise
(berechtigtes Interesse, Art. 6 Abs. 1 lit. f DSGVO; Postwerbung an
Unternehmen ist davon gedeckt, anders als Werbe-E-Mails).

---

## Bei jeder Welle

### Schritt 1 — Briefe erzeugen

```bash
node scripts/generate-briefe-heimat94.js
```

Legt je Empfänger ein PDF in `Anschreiben/Briefe_Heimat94/` ab, dazu
`_index.json` als Versandliste.

Meldet das Skript Warnungen (Seitenzahl ≠ 2, Satzspiegel > 285 mm, zu breite
Tabellentexte), diese Briefe zuerst einzeln ansehen. Ohne Warnung ist der
Satz geprüft.

### Schritt 2 — Trockenlauf

```bash
node scripts/send-letterxpress.js --dry-run
```

Listet auf, was eingereicht würde: Empfänger, Seitenzahl, Dateigröße.
Es geht nichts raus. Prüfen, ob Anzahl und Namen stimmen.

### Schritt 3 — Einen Testbrief einreichen

```bash
node scripts/send-letterxpress.js --limit 1
```

Ohne `--live` läuft alles im **Testmodus**: der Auftrag landet im
LetterXpress-Warenkorb, wird nicht produziert und nach 7 Tagen automatisch
gelöscht. Es entstehen keine Kosten.

Jetzt im Kundenbereich die **Vorschau** öffnen und prüfen:

- Sitzt die Empfängeranschrift im Kuvertfenster? (Das Layout folgt dem
  LetterXpress-Formblatt: 20 mm von links, 27 mm von oben, 85 × 40 mm —
  aber die Vorschau ist der Beweis.)
- Sind beide Seiten farbig und richtig herum?
- Ist der QR-Code sauber gedruckt? Mit dem Handy vom Bildschirm scannen.

### Schritt 4 — Scharf schalten

```bash
node scripts/send-letterxpress.js --live
```

Erst dieser Befehl produziert. Das Skript zeigt vorher eine Warnung an.

Das Protokoll `_versand.json` wird **pro Token und Modus** geführt: ein
Testlauf blockiert den Livelauf nicht, und kein Brief geht zweimal raus.
Bricht der Lauf ab, einfach denselben Befehl erneut ausführen — bereits
eingereichte Briefe werden übersprungen.

### Schritt 5 — Deployment: beide QR-Ziele scharf schalten

**Vor** dem Druck, sonst laufen 150 Briefe auf eine 404.

Das Repository `ploechinger-felix/Website` ist **öffentlich**. Zwei Dinge
dürfen deshalb nie hineincommittet werden: `api/short-links.json`
(Empfänger-Firmennamen) und die `.env`. Beide stehen in `.gitignore`.

**a) Musterbericht-PDF** — geht über den normalen Weg ins Repo:

```bash
git add musterbericht.pdf && git commit -m "Musterbericht als PDF" && git push
```

**b) Auf dem VPS** (Hostinger, per SSH):

```bash
cd /pfad/zum/repo && git pull
docker compose build web api && docker compose up -d
```

`build web` liefert das PDF aus, `build api` bringt die Kurzlink-Route und
die Traefik-Regel `kolibri-short`.

**c) Kurzlink-Tabelle einspielen** — nicht über git, sondern direkt:

```bash
scp api/short-links.json vps:/tmp/
ssh vps 'docker compose cp /tmp/short-links.json api:/data/short-links.json'
```

Der Server liest sie über `SHORT_LINKS_FILE=/data/short-links.json` und lädt
sie bei jeder Änderung automatisch neu — kein Rebuild je Kampagne nötig.

**d) Beides prüfen:**

```bash
curl -I https://www.kolibri-inspect.de/musterbericht.pdf
curl -I https://www.kolibri-inspect.de/a/<echterToken>
```

Erwartung: `200` mit `content-type: application/pdf` bzw. `302` mit
`Location:` auf die vorbefüllte `angebot.html`.

---

## Response messen

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://www.kolibri-inspect.de/api/kurzlink-hits
```

Liefert Aufrufe gesamt und die Zahl eindeutiger Briefe. Jeder Brief hat einen
eigenen Token — du siehst also, welche Empfänger gescannt haben, nicht nur
wie viele.

Vergleichsmaßstab Eichstätt: 43 Briefe → 2 Aufträge.

---

## Wenn etwas schiefgeht

| Meldung | Ursache | Lösung |
|---|---|---|
| `LXP_USER und LXP_APIKEY nicht gesetzt` | `.env` fehlt oder leer | Schritt 3 der Einrichtung |
| `HTTP 401` | API-Key falsch oder widerrufen | Key im Kundenbereich neu erzeugen |
| `HTTP 402` / Guthaben | Konto leer | Guthaben aufladen, Lauf wiederholen |
| Seitenzahl ≠ 2 | Layout übergelaufen | `DEBUG_LAYOUT=1` setzen, Zwischenhöhen prüfen |
| Adresse sitzt nicht im Fenster | Anschriftfeld verschoben | Konstanten `ADR_X/ADR_Y` im Generator gegen das aktuelle LXP-Formblatt prüfen |

Limits der Schnittstelle: 50 MB je PDF, 120 Anfragen pro Minute. Das
Versandskript pausiert 600 ms zwischen den Briefen und bleibt damit deutlich
darunter — 150 Briefe brauchen rund 90 Sekunden.

---

## Alternativen

Falls LetterXpress ausfällt oder du vergleichen willst — alle drei nehmen
PDFs per REST entgegen:

| Anbieter | 2 S. A4 Farbe duplex | Besonderheit |
|---|---|---|
| **LetterXpress** | **1,00 €** | günstigste Farboption, Testmodus im Warenkorb |
| onlinebrief24 | 1,58 € | ähnlicher Funktionsumfang |
| Pingen | ab 0,86 € (s/w) | OAuth2, SDKs für PHP/Python/Go/.Net |

Preise netto, Stand der jeweils aktuellen Nettopreisliste — vor größeren
Läufen gegenprüfen.
