# TFAC QA fixture — supported application paths only

The October 27 owner report authorizes five facilities and their complete synthetic claim demonstration data on the previously approved existing HealthPay QA deployment. Its SHA-256 is recorded in `tfac-fixture.json`. This authorization does not extend to production or to changes in working application behavior.

## Fixture decisions

The fixture carries forward the prepared five-row Cairo/Giza H/C mix and synthetic service, product and beneficiary proposal. It adds diagnosis `TDX001` as an explicitly **nonclinical synthetic sentinel**, not ICD or any real diagnosis, and claim code `TFACC001` (8 characters). The earlier proposed `TEST-TFAC` claim prefix exceeded the deployed form's default 8-character limit; no control is widened, no identifier is truncated, and the visible claim explanation retains `TEST-TFAC`. All facility codes remain exactly `TFAC001`–`TFAC005` as directed. No production parameters or real person/provider details are implied by the synthetic amounts and names.

## Execution

`seed_tfac_api.py` defaults to dry-run. Apply requires `--apply`, the exact authorization SHA, trusted Django `HEALTHPAY_DEPLOYMENT_ENV=qa/staging`, the configured QA authorization gate, the approved database and the independently verified immutable backend/frontend images. It uses only actual deployed GraphQL create operations for service, price list, facilities and product. It does not create or edit users or roles.

The deployed API has no diagnosis-create mutation or standalone non-login claim-administrator creation operation. For those new reference records and the necessary non-login enrolment officer/catchment, `load_tfac_reference_fixture.py` uses Django's supported `loaddata` mechanism, with no raw SQL or ad hoc model insert/update/save. It validates and whitelists the source-controlled fixture, looks up actual facility and audit-user IDs, lets the database/model assign new identifiers, defaults to dry-run, and requires trusted QA configuration plus `HP_QA_AUTHORIZATION_SHA` and `HP_QA_FIXTURE_APPLY=yes`. The administrator has `has_login=false`; it is not an authentication account and receives no role grant. The launcher is a fixture artifact, not a patch to running application code. No application-image rebuild/deployment is needed for these ordinary supported fixture operations.

Every API creation is acknowledged, correlated by a persisted client mutation UUID, then checked for `MutationLog.SUCCESS=2` and an independent canonical entity readback. Exact source semantics are Received=0, Error=1, Success=2; status 1 must never be treated as success. Unknown outcomes stop and must be reconciled before retry. Exact existing matches skip; historical rows, ambiguous keys and mismatches stop without update or reactivation.

Registration, policy/enrolment, first-service-point selection and the claim cycle use supported application flows. UI pass claims require real browser evidence; database/API checks only corroborate persistence and audit.

## Preservation and cleanup

Capture prechange fingerprints for all existing records and persona scopes. After each phase, compare the original ID sets and frozen Scenario A fingerprints. Never alter `TESTA001`, family 1, its four insurees, its photo, its original/extra policy history, original locations, existing catalog values, or existing role/district assignments.

Retain the new synthetic fixtures for the requested management demo. The execution manifest supplies created IDs, timestamps, actor, source and fixture hashes, API mutation logs or Django fixture-load audit. Cleanup is a separate audited operation: dry-run first; reverse dependency order (claim/lifecycle records, contribution/policy/enrolment, new family/insuree, claim administrator, facilities, product benefit links/product, price-list details/list, service, diagnosis); verify no non-fixture reference uses any target; use supported soft-delete/reversal flows. Stop if the system has no supported cleanup contract for a target. Never reset sequences, delete by prefix, alter shared references, or restore the whole database to remove QA additions. No cleanup is automatically executed by these scripts.

## Gates

`python -m unittest discover -p 'test_*.py' -v` exercises the approved case and negative controls for default/explicit production, wrong database, missing authorization, wrong document, wrong codes/markers, nonclinical diagnosis, non-login administrator, 8-character claim envelope, exact-match conflicts, missing canonical fields, and journal error/unknown states. The source CI gate runs without live credentials, network calls or databases. Existing Gate M assembly/module pins and all prior browser suites are unchanged.

### Supported-input reconciliation

The first product API request omitted service limit fields that `ServicesTabForm.onAdd` sends explicitly. The backend rejected it with `failed_to_create_product / 'limitation_type'`; readback proved no `TQAC001` product was created. The corrected fixture now declares all six adult/child O/R/E values as zero co-insurance and all three types as `CO_INSURANCE`, matching the prepared zero-co-pay mechanics and the supported UI contract. No backend or existing record was changed. Both failed and corrected attempts are retained in the execution evidence.

The policy picker filters officers by village catchment. To avoid altering the existing officer's catchment or account districts, the fixture includes a new non-login enrolment officer `TFACOFF`, visibly synthetic, plus its single `EG010901` catchment. These are loaded through the same guarded source-controlled Django fixture path. No login, user-role grant or existing officer/catchment change is made.

The persisted product readback also showed that generic ceiling/deductible values need the existing supported ceiling-type selector. The completed fixture uses `ceilingType=POLICY`, `ceilingInterpretation=CLAIM_TYPE`, and calendar `Date` input strings. The API exposes these dates as midnight DateTime readbacks; the canonical matcher allows only that exact representation difference, not changed dates or non-midnight times. A read-only input-contract check now validates actual schema field names/types before submission. `configure_owned_product.py` may configure only this run's newly created TQAC001: it checks the actual record ID against the captured prechange product ID set and refuses any pre-existing product. The original incomplete QA version stays in normal application history; no TESTA001 or pre-existing product is edited. This is fixture configuration through the supported API, not a backend fix.

The unchanged `healthFacilitiesStr` first-service-point filter matches the facility location to the selected district ID exactly. The fixture therefore uses actual governed D references `EG0109` and `EG2107`; original source V references are retained as `siteVillageReferencePcode` provenance only. The beneficiary remains at `EG010901` directly under `EG0109`. The ownership-guarded configuration changes only this run's newly created TFAC facilities; no location record, user scope or existing facility is changed. Repeat catalog creation checks current versions for exact matches and rejects historical-only collisions; it does not duplicate or reactivate rows.
