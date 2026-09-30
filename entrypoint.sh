#!/bin/sh
set -e

umask 077

# The `user:` directive in docker-compose runs us as the host user, but does not
# set HOME; dsh keeps its state in $HOME/.dsh.
export HOME=/home/app

CRED="$HOME/.dsh/.credentials.yaml"
[ -f "$CRED" ] && chmod 600 "$CRED"

# dsh refuses `--host 0.0.0.0` on the CLI, but the webserver config accepts it.
# Bind all interfaces so the web UI is reachable directly from the LAN.
cat > /tmp/webserver.yml <<'EOF'
- id: webserver
  config:
    host: 0.0.0.0
    port: 3080
EOF

# The browser-trust fence rejects API requests whose Host is not loopback or a
# trusted host. DSH_TRUSTED_HOSTS is a space-separated list of authorities
# (host or host:port) to allow, e.g. "192.168.1.10" or "dsh.local:3080".
set --
for h in ${DSH_TRUSTED_HOSTS:-}; do
  set -- "$@" --trusted-host "$h"
done

exec node --expose-internals "$(command -v dsh)" --profile web --patch /tmp/webserver.yml --no-open "$@"
