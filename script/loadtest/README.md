# Bounded HealthPay read-load harness

Owner approval: 27 October 2026, existing QA target only, maximum eight-minute profile, ten VUs and five target requests/second. Source/test changes only; no application deployment or role/data/infrastructure change. No secret is committed.

## Actual execution checkpoint

**STOPPED AT SMOKE GATE.** A one-request k6 2.3.0 health smoke timed out at three seconds. The full eight-minute multi-VU ramp has NOT been run. Eleven sequential functional query cases pass with ten-second cold-setup allowance; that is functional evidence, not sustained-load acceptance. Public cold-connection timing was approximately 3.69 seconds with TLS completion around 2.78 seconds. The safety limits were not raised to obtain a passing result.

The new TFAC policy was found in stored status 4 before any multi-VU traffic, rather than the earlier status 2. Capture this drift independently and do not reactivate it. `prepare_setup.py` reads the current owned policy status so the load response must remain equal to the pre-load snapshot; it does not invent status 2 or alter the policy. Separate approved fixtures and original Scenario A remain protected.

## Files and safeguards

`workload.js` contains exact query/target whitelist, approved synthetic identifiers, minimal projections, semantic checks and a deterministic mix: 10% health, 30% National-ID validation, 20% beneficiary read, 15% policy, 15% locations and 10% actual mobile GetControls. This preliminary cohort is hpadmin only, not a national role distribution. Expected duplicate rejections count as success.

`prepare_setup.py` uses the existing protected FHIR login/bearer/CSRF helper with two authentication requests and one fixture-resolution query. It writes a private mode-0600 temporary file, never logs credentials/tokens, and does not create a user. Existing QA credentials must not be placed in this repository or evidence archives.

`preflight_queries.mjs` performs sequential functional reads with one-second spacing and stores status/correctness/timing only. Its ten-second setup timeout is not the load-test SLA. `smoke.js` uses one VU/one request and a three-second deadline. A failed smoke must be investigated before ramping; do not use the supervisor to bypass it.

`bounded_readonly.js` is the unexecuted capped k6 profile, with one target request per iteration and a separate local request-budget permit. The local permit HTTP metrics are generator control traffic and must be excluded from target RPS/latency reports. Fixed rate phases last 120/120/180/60 seconds with one-second rate transitions included within phases. The maximum is never above five RPS/ten VUs. Global and rolling guards cover unexpected failures/p95 latency; target resource monitoring must be ready before traffic. No business mutation is present or allowed.

`target_sampler.py` is finite aggregate-only read monitoring: host CPU/memory and PostgreSQL statistics, no query text or beneficiary data, no setting changes. `supervise.py` is an execution candidate, not a completed acceptance artifact; it supplies shared budget, monitor-staleness/pressure/health/rolling-window aborts and temporary-secret cleanup. Its full multi-VU lifecycle has not been exercised because the smoke gate failed. Any future ramp must pass smoke/readiness gates first and be reviewed against the then-current explicit authorization; no automatic retry or threshold relaxation.

## Local tests

Run `node script/loadtest/test_workload.mjs`, then from `script/loadtest` run `python3 -m unittest -v test_target_sampler.py test_supervise.py`. Use k6 inspect with explicit `-e INSPECT_ONLY=1` for offline parsing; inspection does not send traffic. k6 is pinned to official release 2.3.0 and archive SHA-256 `39c3117b6af817592dcd0ce4242105c0a7af10948c2a425306f0be8f7a8a8ab1`.

This kit does not authorize a new load attempt, stress-to-failure, clinical/business-data generation, data cleanup, role repair, application deployment, cache/service restart, recovery-clone activation or paid infrastructure. National-scale claims require representative synthetic data and separately authorized production-like workload/topology tests.
