#!/usr/bin/env bash
# Host-side, configuration-only deployment; no app code, credentials or DB changes.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'usage: deploy_healthpay_tls.sh SOURCE_DIR EXPECTED_TEMPLATE_SHA256'; exit 2; }
SOURCE_DIR=$1
EXPECTED_SHA=$2
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{64}$ ]] || exit 2
LIVE=/opt/healthpay/healthpay-dist_dkr
TEMPLATE=conf/nginx-healthpay/openimis.conf
EXPECTED_OLD=ce4e952319138c5e2404ebbce0695f67c07455ea259736923fffd766fa07fb13
FE=registry.digitalocean.com/healthpay-payer/frontend@sha256:66413a309e7c0d2ad04cf58a5bf112a831fb7ef971144c7faf7fa17446b8362d
BE=registry.digitalocean.com/healthpay-payer/backend@sha256:fa08084e6f449283eee0779ee2ef5edf47a326c27d2980e7750a7266a5fcfcae
[[ -f "$SOURCE_DIR/$TEMPLATE" ]]
[[ "$(sha256sum "$SOURCE_DIR/$TEMPLATE" | cut -d' ' -f1)" = "$EXPECTED_SHA" ]]
cd "$LIVE"
compose(){ docker compose -f compose.healthpay.yml "$@"; }
front=$(compose ps -q frontend)
back=$(compose ps -q backend)
[[ $(docker inspect "$front" --format '{{.Config.Image}}') = "$FE" ]]
[[ $(docker inspect "$back" --format '{{.Config.Image}}') = "$BE" ]]
[[ "$(sha256sum "$TEMPLATE" | cut -d' ' -f1)" = "$EXPECTED_OLD" ]]
BACKUP=/root/healthpay-backups/tls-ecdsa-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP";chmod 700 "$BACKUP"
cp -p "$TEMPLATE" "$BACKUP/openimis.conf.before"
find conf/nginx-healthpay -type f -exec sha256sum {} \; > "$BACKUP/config-before.sha256"
compose ps --format json > "$BACKUP/containers-before.jsonl"
compose exec -T frontend nginx -T > "$BACKUP/nginx-before.txt" 2>&1
# Candidate is a throwaway same-image frontend with no published ports and read-only inputs.
docker run --rm --network healthpay-net --entrypoint /script/entrypoint.sh \
 -e NEW_OPENIMIS_HOST=inspayer.healthpay.tech -e DATA_UPLOAD_MAX_MEMORY_SIZE=12582912 -e PUBLIC_URL=front -e FORCE_RELOAD=0 \
 -v "$SOURCE_DIR/conf/nginx-healthpay:/conf:ro" \
 -v "$LIVE/data/certbot/conf:/etc/letsencrypt:ro" \
 "$FE" nginx -t > "$BACKUP/candidate-nginx-test.log" 2>&1
changed=0
rollback(){
 rc=$?
 if [[ $changed -eq 1 ]];then
  cp -p "$BACKUP/openimis.conf.before" "$TEMPLATE.rollback";mv "$TEMPLATE.rollback" "$TEMPLATE"
  compose exec -T frontend sh -s < "$SOURCE_DIR/script/render_healthpay_tls_config.sh" > "$BACKUP/rollback-render.log" 2>&1 && compose exec -T frontend nginx -s reload > "$BACKUP/rollback-reload.log" 2>&1
  printf 'ROLLBACK_RESTORED; backup=%s\n' "$BACKUP"
 fi
 exit "$rc"
}
trap rollback ERR
cp -p "$SOURCE_DIR/$TEMPLATE" "$TEMPLATE.candidate";mv "$TEMPLATE.candidate" "$TEMPLATE";changed=1
# Render the same shipped config contract without general startup or static-asset side effects.
compose exec -T frontend sh -s < "$SOURCE_DIR/script/render_healthpay_tls_config.sh" > "$BACKUP/live-render-test.log" 2>&1
compose exec -T frontend nginx -s reload > "$BACKUP/graceful-reload.log" 2>&1
sleep 1
# TLS1.2 and TLS1.3 health with real certificate verification, SNI and same-host routing.
for ver in 1.2 1.3;do
 code=$(curl --silent --show-error --max-time 10 --connect-timeout 5 --resolve inspayer.healthpay.tech:443:127.0.0.1 --tlsv"$ver" --tls-max "$ver" -o /dev/null -w '%{http_code}' https://inspayer.healthpay.tech/front/login)
 [[ "$code" = 200 ]]
 printf 'TLS%s_HTTP_%s\n' "$ver" "$code"
done
# Only template is permitted to differ; certs, location routing and variables stay intact.
python3 - "$BACKUP/config-before.sha256" "$TEMPLATE" <<'PY'
import sys,hashlib
from pathlib import Path
for line in Path(sys.argv[1]).read_text().splitlines():
 sha,name=line.split(None,1)
 if name==sys.argv[2]:continue
 assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==sha,name
print('UNCHANGED_ROUTING_AND_VARIABLES')
PY
[[ $(docker inspect "$front" --format '{{.Config.Image}}') = "$FE" ]]
[[ $(docker inspect "$back" --format '{{.Config.Image}}') = "$BE" ]]
compose ps --format json > "$BACKUP/containers-after.jsonl"
compose exec -T frontend nginx -T > "$BACKUP/nginx-after.txt" 2>&1
trap - ERR
printf 'CONFIG_ONLY_TLS_DEPLOYMENT_PASS; backup=%s; template_sha=%s\n' "$BACKUP" "$EXPECTED_SHA"
