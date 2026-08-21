# Slice-1 nginx conf (trial-1)

Stock `conf/nginx/` ships location files for services outside the Slice-1
surface: `opensearch.loc` references `${OPENSEARCH_BASIC_TOKEN}` (unset when
the OpenSearch overlay is dropped -> envsubst leaves the literal ->
`nginx: [emerg] unknown "opensearch_basic_token" variable`), and
`lightning.loc` proxies a service that does not exist here.

This directory carries only: frontend.loc, backend.loc, certbot.loc, with
variables trimmed to `$backend` and the `/.well-known` root normalized to
`/var/www/certbot` (matching the certbot webroot mount; the stock
`/var/www/html` was shadowed by certbot.loc's longer prefix anyway).
compose.healthpay.yml mounts THIS directory; do not mount stock conf/nginx.
