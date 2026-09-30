#!/bin/sh
set -e

umask 077

# We start as root (the Dockerfile has no USER) and drop to the host user below.
# dsh keeps its state in $HOME/.dsh.
export HOME=/home/app

# --- Run as the host user (PUID/PGID) -----------------------------------------
# PUID/PGID bring the host uid/gid in from docker-compose, so the image itself
# stays free of any uid and can be built once and reused by anyone.
#
# The account must exist in /etc/passwd: OpenSSH clients call getpwuid(getuid())
# unconditionally and die with "No user exists for uid ...". Plain node/bash don't
# care — which is why this only ever bites ssh/scp/sftp/ssh-keygen.
#
# Needs CAP_SETUID/CAP_SETGID, so do not cap_drop ALL. On Alpine these commands
# come from the `shadow` package, and setpriv/mountpoint from `util-linux`.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$PUID" = 0 ]; then
  # uid 0 already owns the image's `root` entry, so there is nothing to create or
  # re-point — and the surgery below would be actively harmful: getpwuid(0)
  # returns `root`, so the re-home line would move /root to /home/app. Running as
  # root is the caller's explicit choice; just say so and carry on.
  echo "entrypoint: PUID=0 — running as root, skipping account setup" >&2
else
  # Re-point the image's pre-created `app` account at the host uid/gid. `-o` allows
  # the non-unique case where another account already owns that id (node=1000, or
  # users=100 for the group), so no branching is needed — the linuxserver.io idiom.
  groupmod -o -g "$PGID" app
  usermod -o -u "$PUID" -g "$PGID" -d /home/app -s /bin/bash app

  # `-o` can leave two accounts sharing a uid: app + node when PUID=1000, which is
  # the most common uid on Linux — so this is the *likely* case for anyone reusing
  # the image, not an exotic one. ssh resolves ~/.ssh through getpwuid(getuid()),
  # not $HOME, so it would read the *other* account's home. Point that account at
  # /home/app too, so ~ means the same thing however the uid is resolved.
  # getpwuid()/glibc getent return only the first match for a uid, but BusyBox
  # getent (Alpine) lists every match — head -n 1 keeps this safe on both.
  CUR="$(getent passwd "$PUID" | head -n 1 | cut -d: -f1)"
  [ "$CUR" = app ] || usermod -d /home/app -s /bin/bash "$CUR"
fi

# Chown the home directory and every top-level entry that is not itself a
# bind-mount point. The mounts are owned by whoever owns them on the host, and
# this image is published for arbitrary mount layouts, so we can't assume their
# names — `mountpoint` detects them instead. The skeleton files (.bashrc & co)
# are what this fixes: after `usermod -u` they're left at the old build-time uid,
# and the running user should be able to read/write them.
#
# /home/app and /app themselves are always ours — a non-recursive chown cannot
# reach into the mounts below /home/app — so they go first and unconditionally.
chown "$PUID:$PGID" /home/app /app 2>/dev/null || true

for f in /home/app/* /home/app/.[!.]*; do
  [ -e "$f" ] || continue
  mountpoint -q "$f" && continue
  chown "$PUID:$PGID" "$f" 2>/dev/null || true
done

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

# The process we exec below runs as PUID, so hand it the file (umask left it
# 600 root:root).
chown "$PUID:$PGID" /tmp/webserver.yml

# The browser-trust fence rejects API requests whose Host is not loopback or a
# trusted host. DSH_TRUSTED_HOSTS is a space-separated list of authorities
# (host or host:port) to allow, e.g. "192.168.1.10" or "dsh.local:3080".
# Append these to the incoming args (docker run <image> …) rather than clobbering
# them, so extra dsh flags can be passed through.
for h in ${DSH_TRUSTED_HOSTS:-}; do
  set -- "$@" --trusted-host "$h"
done

# Drop privileges before exec: dsh and everything it spawns must run as the host
# user, so files written into the bind mounts belong to the host user.
exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups \
  node --expose-internals "$(command -v dsh)" --profile web --patch /tmp/webserver.yml --no-open "$@"
