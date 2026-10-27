#!/bin/sh
# Nginx configuration only. No static-asset symlinks, location copies or startup actions.
set -eu
[ "$NEW_OPENIMIS_HOST" = 'inspayer.healthpay.tech' ]
[ "$DATA_UPLOAD_MAX_MEMORY_SIZE" = '12582912' ]
[ -f /conf/openimis.conf ]
[ -f /etc/nginx/conf.d/locations/backend.loc ]
[ -f /etc/nginx/conf.d/variables/var.conf ]
tmp=$(mktemp /etc/nginx/conf.d/.healthpay-tls.XXXXXX)
trap 'rm -f "$tmp"' EXIT HUP INT TERM
envsubst '${DATA_UPLOAD_MAX_MEMORY_SIZE} ${NEW_OPENIMIS_HOST}' < /conf/openimis.conf | sed 's|###INCLUDE_PLACEHOLDER###|#include the configuration use in the loc files\ninclude conf.d/variables/var.conf;\n# include the  loc files\ninclude conf.d/locations/*.loc;|' > "$tmp"
chmod 644 "$tmp"
mv "$tmp" /etc/nginx/conf.d/openIMIS.conf
nginx -t
