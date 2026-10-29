# Issue 40 browser acceptance source inventory

This directory contains acceptance source only. It is intentionally separate from the existing `test/poc-claim-browser` suite and does not alter existing Cypress specs, support files, application source, backend, data, roles, or deployment configuration.

## Cases

1. **Entry and panel mount** — navigates the real `/front/location/healthFacilities` list, opens a pre-existing synthetic facility only when the live list exposes `TFAC0001` or `TFAC001`, confirms the edit route and four catchment hierarchy panes, and proves no visible checkbox or save action is used.
2. **Parent switch / stale response** — intercepts only child-location read responses with local synthetic transport data, delays the old A→W response, switches to B, verifies lower rows clear immediately, and verifies the late A response cannot repopulate B’s panel. Controlled response data is transport-local and is never persisted.
3. **Legacy W path** — controls a proven read-only A→D→W→V sequence and asserts the V request/rendered row is under the selected W, with metadata-only counts and labels.
4. **Direct D→V fallback** — controls a B district whose W response is explicitly empty, then asserts the direct V request uses B’s district parent. No direct-D→V hierarchy is fabricated in live data; the controlled local response is only for transport/race reproduction.

The stale-switch case also asserts bounded request counts to detect duplicate/running loops. All cases require `businessForwarded === 0` and `httpWriteAttempts === 0`.

## Guard and evidence

`cypress/support/issue40-readonly.js` forwards normal GraphQL reads and auth-only login mutations, blocks every other GraphQL mutation, blocks non-GraphQL HTTP POST and other HTTP write methods, and writes only metadata. Evidence excludes request/response bodies, variables, query text, credentials, tokens, photos, and beneficiary data.

`cypress/support/issue40-guard.test.js` is an offline source guard for operation classification, mutation mixing, fixed sleeps, state injection, and required hierarchy assertions.

## Runner contract

`/home/ubuntu/healthpay-batch4-oct29/deployment/run_issue40_readonly.sh` packages only this directory, invokes the approved credential preparer through `HEALTHPAY_BROWSER_CREDENTIAL_DIR`, suppresses preparer output, passes only a protected credential-file path to `cypress/included:13.17.0`, and traps cleanup of local and remote credential files. The runner is prepared for the parent agent to invoke after the exact CI/source deployment checkpoint.

## Validation status

Offline syntax and source guards are the only validation performed in this task. No Cypress browser run, live navigation, credential read/output, SSH action, remote container action, or browser-pass claim is made here.

A separate one-test `issue40-scope-diagnostic.cy.js` is a no-write structure/loading diagnostic, explicitly invoked with runner mode `diagnostic`. It is not included in the five acceptance tests or any claimed release-pass total.
