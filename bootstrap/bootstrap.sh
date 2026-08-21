#!/bin/bash
# Gate I4 step 0 — legacy schema bootstrap. Run ONCE per fresh database, BEFORE
# `manage migrate`. Usage: DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... PGPASSWORD=... ./bootstrap.sh
set -euo pipefail
PSQL="psql -v ON_ERROR_STOP=1 -h ${DB_HOST:?} -p ${DB_PORT:-25060} -U ${DB_USER:?} -d ${DB_NAME:?}"
if [ "$($PSQL -tAc "SELECT to_regclass('public.\"tblUsers\"') IS NOT NULL")" = "t" ]; then
  echo "[bootstrap] tblUsers already present — bootstrap appears applied; refusing to re-run."
  exit 0
fi
# DO Managed PG (PostgreSQL 15+): db owner must grant schema rights first (I2 runbook):
#   GRANT ALL ON SCHEMA public TO <db_user>;  -- run as doadmin, per database
for f in 00_legacy_prereq.sql 01_aux_functions.sql 02_views.sql 03_reference_data.sql 04_sequences.sql; do
  echo "[bootstrap] applying $f"
  $PSQL -q -f "$(dirname "$0")/$f"
done
echo "[bootstrap] done — now run migrations: docker compose -f compose.healthpay.yml run --rm backend manage migrate"
