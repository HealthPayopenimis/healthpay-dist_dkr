#!/usr/bin/env bash
set -euo pipefail
: "${NEW_BE:?immutable backend image required}"
: "${NEW_FE:?immutable frontend image required}"
[[ "$NEW_BE" =~ ^registry\.digitalocean\.com/healthpay-payer/backend@sha256:[0-9a-f]{64}$ ]]
[[ "$NEW_FE" =~ ^registry\.digitalocean\.com/healthpay-payer/frontend@sha256:[0-9a-f]{64}$ ]]
ROOT=/home/ubuntu/healthpay-v3-execution
KEY=/home/ubuntu/healthpay-delivery/HealthPay-Live-Server-SSH-PRIVATE-KEY
HOST=157.230.96.251
OLD_BE=registry.digitalocean.com/healthpay-payer/backend@sha256:f76c0d1842421af8b90a65079f8de87677f61d0931afeb42f172e5ed0944205b
OLD_FE=registry.digitalocean.com/healthpay-payer/frontend@sha256:fdc20c87f7aa405bd6a8fc1b039a41084517a173b5788065eda3d20849332ffa
ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes root@"$HOST" bash -s -- "$OLD_BE" "$OLD_FE" "$NEW_BE" "$NEW_FE" <<'REMOTE' > "$ROOT/v3-qa-deployment-result.txt"
set -euo pipefail
old_be=$1;old_fe=$2;new_be=$3;new_fe=$4
cd /opt/healthpay/healthpay-dist_dkr
[[ $(sed -n 's/^BE_IMAGE=//p' .env) == "$old_be" ]]
[[ $(sed -n 's/^FE_IMAGE=//p' .env) == "$old_fe" ]]
[[ $(grep -c '^BE_IMAGE=' .env) == 1 && $(grep -c '^FE_IMAGE=' .env) == 1 ]]
for image in "$old_be" "$old_fe" "$new_be" "$new_fe";do docker image inspect "$image" >/dev/null;done
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/root/healthpay-backups/v3-qa-$stamp
mkdir -p "$backup";chmod 700 "$backup"
cp .env compose.healthpay.yml "$backup/";chmod 600 "$backup/.env"
rabbit_before=$(docker compose -f compose.healthpay.yml ps -q rabbitmq)
rollback(){ rc=$?;trap - ERR;cp "$backup/.env" .env;cp "$backup/compose.healthpay.yml" compose.healthpay.yml;chmod 600 .env;docker compose -f compose.healthpay.yml up -d --no-deps --force-recreate backend worker frontend >/dev/null 2>&1 || true;echo "ROLLBACK_EXECUTED rc=$rc backup=$backup";exit "$rc"; }
trap rollback ERR
# Only the reviewed source-controlled Compose file is used. No DNS, VPC,
# firewall, database, RabbitMQ or photo volume modification.
cp /root/healthpay-qa-build/compose.healthpay.v3.yml compose.healthpay.yml
python3 - "$new_be" "$new_fe" <<'PY'
from pathlib import Path
import sys
p=Path('.env'); lines=p.read_text().splitlines(); vals={'BE_IMAGE':sys.argv[1],'FE_IMAGE':sys.argv[2],'HEALTHPAY_DEPLOYMENT_ENV':'qa','HEALTHPAY_QA_AUTHORIZATION':'oct11-2026-existing-healthpay-qa'}
lines=[l for l in lines if l.split('=',1)[0] not in vals]
lines.extend(k+'='+v for k,v in vals.items());p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
PY
docker compose -f compose.healthpay.yml up -d --no-deps --force-recreate backend worker frontend
ready=false
for i in $(seq 1 90);do
 web=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 --resolve inspayer.healthpay.tech:443:127.0.0.1 https://inspayer.healthpay.tech/front/login || true)
 gql=$(curl -sS -o /tmp/v3-qa-passive.json -w '%{http_code}' --max-time 8 --resolve inspayer.healthpay.tech:443:127.0.0.1 -H 'Content-Type: application/json' --data '{"query":"query{__typename}"}' https://inspayer.healthpay.tech/api/graphql || true)
 if [[ "$web" == 200 && "$gql" == 200 ]] && python3 -c 'import json;d=json.load(open("/tmp/v3-qa-passive.json"));assert d.get("data",{}).get("__typename")=="Query" and not d.get("errors")';then ready=true;break;fi
 sleep 2
done
[[ "$ready" == true ]]
[[ $(docker compose -f compose.healthpay.yml ps -q worker | wc -l) -eq 3 ]]
[[ $(docker compose -f compose.healthpay.yml ps -q rabbitmq) == "$rabbit_before" ]]
for svc in backend frontend;do id=$(docker compose -f compose.healthpay.yml ps -q "$svc");[[ $(docker inspect -f '{{.State.Running}}' "$id") == true ]];done
[[ $(docker inspect -f '{{.Config.Image}}' "$(docker compose -f compose.healthpay.yml ps -q backend)") == "$new_be" ]]
[[ $(docker inspect -f '{{.Config.Image}}' "$(docker compose -f compose.healthpay.yml ps -q frontend)") == "$new_fe" ]]
for worker in $(docker compose -f compose.healthpay.yml ps -q worker);do [[ $(docker inspect -f '{{.State.Running}}' "$worker") == true ]];[[ $(docker inspect -f '{{.Config.Image}}' "$worker") == "$new_be" ]];done
docker compose -f compose.healthpay.yml exec -T backend python manage.py check >/tmp/v3-qa-manage-check.txt 2>&1
grep -q 'System check identified no issues' /tmp/v3-qa-manage-check.txt
rm -f /tmp/v3-qa-passive.json /tmp/v3-qa-manage-check.txt
trap - ERR
printf 'DEPLOY_REMOTE=GREEN\nbackup=%s\nnew_be=%s\nnew_fe=%s\nrabbitmq_unchanged=true\nworkers=3\nmanage_check=GREEN\n' "$backup" "$new_be" "$new_fe"
REMOTE
curl -fsS --max-time 30 https://inspayer.healthpay.tech/front/login -o /dev/null
cat "$ROOT/v3-qa-deployment-result.txt"
