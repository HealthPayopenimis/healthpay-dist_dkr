#!/usr/bin/env bash
# Remote QA host only. Application source, roles, policies and DB are not changed.
# Usage: deploy_poc_frontend.sh apply <published immutable image>
#        deploy_poc_frontend.sh rollback <backup directory from this script>
set -Eeuo pipefail
MODE=${1:?apply or rollback required}
VALUE=${2:?immutable image or exact backup path required}
[[ $(hostname) == healthpay-trial1-app ]]
cd /opt/healthpay/healthpay-dist_dkr
exec 9>/var/lock/healthpay-poc-frontend.lock
flock -n 9
OLD_FE=registry.digitalocean.com/healthpay-payer/frontend@sha256:66413a309e7c0d2ad04cf58a5bf112a831fb7ef971144c7faf7fa17446b8362d
BACKEND=registry.digitalocean.com/healthpay-payer/backend@sha256:fa08084e6f449283eee0779ee2ef5edf47a326c27d2980e7750a7266a5fcfcae
TLS_SHA=168d0eed7bf83ebed59ea531cf548b14cf93d6768ebf3f98a86748505ce4a5b1
SOURCE=fc7548fbcfadfea63ce1616ef767aec8a400b0d4
COMPOSE=(docker compose -f compose.healthpay.yml)
[[ $(grep -c '^FE_IMAGE=' .env) == 1 && $(grep -c '^BE_IMAGE=' .env) == 1 ]]
[[ $(sed -n 's/^BE_IMAGE=//p' .env) == "$BACKEND" ]]
[[ $(sha256sum conf/nginx-healthpay/openimis.conf | cut -d' ' -f1) == "$TLS_SHA" ]]

non_frontend_ids() {
  for svc in backend worker rabbitmq certbot-renew; do
    "${COMPOSE[@]}" ps -q "$svc"
  done | sort
}
passive_health() {
  local ready=false tmp
  tmp=$(mktemp /tmp/healthpay-poc-health.XXXXXX)
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 6 --resolve inspayer.healthpay.tech:443:127.0.0.1 https://inspayer.healthpay.tech/front/login -o /dev/null &&
      curl -fsS --max-time 6 --resolve inspayer.healthpay.tech:443:127.0.0.1 -H 'Content-Type: application/json' --data '{"query":"query{__typename}"}' https://inspayer.healthpay.tech/api/graphql -o "$tmp" &&
      python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));assert d.get("data",{}).get("__typename")=="Query" and not d.get("errors")' "$tmp"; then
      ready=true; break
    fi
    sleep 2
  done
  rm -f "$tmp"
  [[ "$ready" == true ]]
  "${COMPOSE[@]}" exec -T frontend nginx -t
}
verify_untouched() {
  [[ $(sha256sum compose.healthpay.yml | cut -d' ' -f1) == "$(cat "$backup/compose.sha256")" ]]
  [[ $(sha256sum conf/nginx-healthpay/openimis.conf | cut -d' ' -f1) == "$TLS_SHA" ]]
  diff -u "$backup/non-frontend.ids" <(non_frontend_ids)
  [[ $("${COMPOSE[@]}" ps -q worker | wc -l) -eq 3 ]]
  for id in $(non_frontend_ids); do [[ $(docker inspect -f '{{.State.Running}}' "$id") == true ]]; done
}
restore_frontend() {
  cp "$backup/.env" .env
  chmod 600 .env
  "${COMPOSE[@]}" up -d --no-deps --force-recreate frontend
  passive_health
  [[ $(docker inspect -f '{{.Config.Image}}' "$("${COMPOSE[@]}" ps -q frontend)") == "$OLD_FE" ]]
  verify_untouched
}

if [[ "$MODE" == rollback ]]; then
  backup=$VALUE
  [[ "$backup" =~ ^/root/healthpay-backups/poc-frontend-[0-9]{8}T[0-9]{6}Z$ ]]
  [[ -f "$backup/.env" && -f "$backup/non-frontend.ids" && -f "$backup/new-fe.txt" ]]
  [[ $(sed -n 's/^FE_IMAGE=//p' .env) == "$(cat "$backup/new-fe.txt")" ]]
  [[ $(sed -n 's/^FE_IMAGE=//p' "$backup/.env") == "$OLD_FE" ]]
  # Do not silently undo concurrent operational configuration changes.
  python3 - "$backup/.env" .env <<'PY'
from pathlib import Path
import sys
def without_fe(p):
    return [line for line in Path(p).read_text().splitlines() if not line.startswith('FE_IMAGE=')]
assert without_fe(sys.argv[1]) == without_fe(sys.argv[2]), 'NON_FE_ENV_DRIFT'
PY
  restore_frontend
  printf 'FRONTEND_ROLLBACK=PASS\nbackup=%s\n' "$backup"
  exit 0
fi
[[ "$MODE" == apply ]]
new_fe=$VALUE
[[ "$new_fe" =~ ^registry\.digitalocean\.com/healthpay-payer/frontend@sha256:[0-9a-f]{64}$ ]]
[[ "$new_fe" != "$OLD_FE" ]]
[[ $(sed -n 's/^FE_IMAGE=//p' .env) == "$OLD_FE" ]]
[[ $(docker inspect -f '{{.Config.Image}}' "$("${COMPOSE[@]}" ps -q frontend)") == "$OLD_FE" ]]
docker image inspect "$OLD_FE" >/dev/null
docker image inspect "$new_fe" >/dev/null
[[ $(docker image inspect -f '{{index .Config.Labels "tech.healthpay.source.frontend"}}' "$new_fe") == "$SOURCE" ]]
# Require registry digest identity; never deploy a mutable/local-only tag.
docker image inspect "$new_fe" --format '{{json .RepoDigests}}' | grep -Fq "$new_fe"
backup=/root/healthpay-backups/poc-frontend-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"; chmod 700 "$backup"
cp .env "$backup/.env"; chmod 600 "$backup/.env"
sha256sum compose.healthpay.yml | cut -d' ' -f1 > "$backup/compose.sha256"
non_frontend_ids > "$backup/non-frontend.ids"
printf '%s\n' "$new_fe" > "$backup/new-fe.txt"
on_error() {
  rc=$?; trap - ERR
  set +e
  (set -e; restore_frontend)
  rollback_rc=$?
  printf 'FRONTEND_APPLY=FAIL rc=%s rollback_rc=%s backup=%s\n' "$rc" "$rollback_rc" "$backup" >&2
  exit "$rc"
}
trap on_error ERR
python3 - "$new_fe" <<'PY'
from pathlib import Path
import sys
p=Path('.env');lines=p.read_text().splitlines()
assert sum(line.startswith('FE_IMAGE=') for line in lines)==1
p.write_text('\n'.join('FE_IMAGE='+sys.argv[1] if line.startswith('FE_IMAGE=') else line for line in lines)+'\n')
p.chmod(0o600)
PY
"${COMPOSE[@]}" up -d --no-deps --force-recreate frontend
passive_health
[[ $(docker inspect -f '{{.Config.Image}}' "$("${COMPOSE[@]}" ps -q frontend)") == "$new_fe" ]]
verify_untouched
trap - ERR
printf 'FRONTEND_APPLY=PASS\nbackup=%s\nnew_fe=%s\nbackend_workers_rabbitmq_certbot_unchanged=true\ntls_template_unchanged=true\n' "$backup" "$new_fe"
