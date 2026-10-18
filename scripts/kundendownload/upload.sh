#!/usr/bin/env bash
# Legt einen Kundenbericht passwortgeschützt auf den VPS.
#
#   bash scripts/kundendownload/upload.sh <kunde> <bericht.pdf> [dateiname.pdf]
#
# Beim ersten Lauf je Kunde werden Slug, Benutzer und Passwort erzeugt und in
# Bestellungen/kunden/<kunde>-download.env abgelegt (gitignored). Weitere Läufe
# verwenden dieselben Zugangsdaten, sodass sich der Link nicht ändert.
# Ergebnis: https://kolibri-inspect.de/download/<slug>/<dateiname>
set -euo pipefail

KUNDE=${1:?Kundenkürzel fehlt, z. B. mueller}
PDF=${2:?Pfad zum Bericht fehlt}
NAME=${3:-$(basename "$PDF" | tr -c 'A-Za-z0-9._-' '_')}
[ -f "$PDF" ] || { echo "Datei nicht gefunden: $PDF" >&2; exit 1; }

HOST=kolibri-vps
REMOTE=/docker/downloads
WEBREPO=/docker/kolibri_inspect
HIER=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HIER/../.." && pwd)
CREDS="$ROOT/Bestellungen/kunden/$KUNDE-download.env"

# Endliche Quelle statt "tr < /dev/urandom | head", sonst bricht pipefail mit SIGPIPE ab
zufall() { local s; s=$(head -c 2048 /dev/urandom | LC_ALL=C tr -dc "$1"); printf '%s' "${s:0:$2}"; }

if [ ! -f "$CREDS" ]; then
  mkdir -p "$(dirname "$CREDS")"
  # Ohne verwechselbare Zeichen (0/O, 1/l/I), damit es sich am Telefon diktieren lässt
  PW="$(zufall 'A-HJ-NP-Za-km-z2-9' 4)-$(zufall 'A-HJ-NP-Za-km-z2-9' 4)-$(zufall 'A-HJ-NP-Za-km-z2-9' 4)"
  cat > "$CREDS" <<EOF
DL_SLUG=$(zufall 'a-z0-9' 20)
DL_USER=$KUNDE
DL_PASS=$PW
EOF
  echo "Zugangsdaten neu angelegt: $CREDS"
fi
# shellcheck disable=SC1090
. "$CREDS"
URL="https://kolibri-inspect.de/download/$DL_SLUG/$NAME"
HASH=$(openssl passwd -apr1 "$DL_PASS")

echo "Pruefe SSH-Zugang ..."
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" true

echo "Richte $REMOTE ein ..."
ssh "$HOST" "mkdir -p $REMOTE/files/$DL_SLUG $REMOTE/auth"
scp -q "$HIER/docker-compose.yml" "$HIER/nginx.conf" "$HOST:$REMOTE/"
# Traefik erreicht den Website-Container über dessen Netz; dasselbe nehmen.
ssh "$HOST" bash -s -- "$REMOTE" "$WEBREPO" <<'EOF'
set -e
cd "$1"
grep -q '^DL_NETWORK=' .env 2>/dev/null && exit 0
WEB=$(cd "$2" && docker compose ps -q web)
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$WEB" | awk '{print $1}')
[ -n "$NET" ] || { echo "Netz des web-Containers nicht gefunden" >&2; exit 1; }
echo "DL_NETWORK=$NET" >> .env
echo "Netz: $NET"
EOF
printf '%s:%s\n' "$DL_USER" "$HASH" | ssh "$HOST" "cat > $REMOTE/auth/$DL_SLUG.htpasswd && chmod 644 $REMOTE/auth/$DL_SLUG.htpasswd"

echo "Lade $(du -h "$PDF" | cut -f1) hoch ..."
scp "$PDF" "$HOST:$REMOTE/files/$DL_SLUG/$NAME"
ssh "$HOST" "cd $REMOTE && docker compose up -d --remove-orphans && docker compose restart downloads"

echo "Pruefe Link ..."
sleep 3
OHNE=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
KOPF=$(curl -sI -u "$DL_USER:$DL_PASS" "$URL" | tr -d '\r')
MIT=$(echo "$KOPF" | awk 'NR==1{print $2}')
LAENGE=$(echo "$KOPF" | awk -F': ' 'tolower($1)=="content-length"{print $2}')
LOKAL=$(wc -c < "$PDF" | tr -d ' ')
echo "  ohne Passwort: $OHNE (erwartet 401)"
echo "  mit Passwort:  $MIT, ${LAENGE:-?} Bytes (lokal $LOKAL)"
[ "$OHNE" = 401 ] && [ "$MIT" = 200 ] && [ "$LAENGE" = "$LOKAL" ] \
  || { echo "Link verhaelt sich nicht wie erwartet" >&2; exit 1; }

echo
echo "Link:     $URL"
echo "Benutzer: $DL_USER"
echo "Passwort: steht in $CREDS"
