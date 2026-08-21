# Legacy schema bootstrap (Gate I4 step 0) — trial-1

## Why this exists
Plan v3 §4 originally banned any SQL bootstrap ("empty DB + real migrations").
Local rehearsal proved the openIMIS 26.04 migration graph is NOT self-sufficient:
39 legacy tables are declared `managed=False` (never created by migrate) yet are
FK-targets and data-dependencies of the graph itself — plus `location.0019`
requires 33 legacy views to pre-exist, and `tasks_management.0002` requires the
system-role rows. The previous trial never saw any of this because
`--fake-initial` skipped these paths entirely.

## Amended §4 (what the incident rules actually require)
- Legacy DDL/reference-data bootstrap: REQUIRED (this directory) — run once, pre-migrate
- `--fake-initial`: still BANNED
- `django_migrations` as schema evidence: still BANNED — `script/schema_audit.py` is the only arbiter

## Provenance & proof
- 00: derived by iterative real-migration rehearsal (extract-on-missing from
  openimis/database_postgresql 00_dump.sql until green) — 39 tables, DDL only
- 01/02: aux functions + views, verbatim from openimis/database_postgresql
- 03: system roles (12) + role-rights (193) + registers, ported from
  openimis/database_ms_sqlserver base data; idempotent; NO user seed rows
  (the dump's default Admin row with published hash is excluded — use createsuperuser)
- Clean-room proven: fresh PG16 -> 00..04 (0 errors) -> migrate (green, first try)
  -> schema audit GREEN (177 models / 2225 fields / Egypt seeds verified)

## Order (per database: IMIS_rehearsal first, then IMIS)
1. As doadmin: `GRANT ALL ON SCHEMA public TO imisuser;` (PostgreSQL 15+ revokes public CREATE)
2. `./bootstrap.sh` (env: DB_HOST/DB_PORT/DB_NAME/DB_USER/PGPASSWORD)
3. `docker compose -f compose.healthpay.yml run --rm backend manage migrate`
4. Schema audit per `healthpay-be_py/script/schema_audit.py` docstring — must print GREEN
5. Create the first UI-capable admin (NOT `createsuperuser`, which makes a
   technical-only user with zero rights and an empty menu):
   `HP_ADMIN_PASSWORD=... docker compose -f compose.healthpay.yml run --rm backend \
        manage create_interactive_admin --username <user> --email <addr>`
   It must report `rights resolved: 249` (or non-zero); it errors out if not.
