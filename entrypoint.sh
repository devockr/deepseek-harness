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

# --- Point every package manager at one registry ------------------------------
# The registry is only ever configured in these user-level files, never through an
# environment variable: npm honours NPM_CONFIG_REGISTRY, but pnpm and yarn 1 ignore
# it while installing, and an environment variable outranks a project's own
# configuration, which would defeat a project that pins its own registry. The files
# merge per key instead.
#
#   ~/.npmrc       registry=           npm, pnpm and yarn 1
#   ~/.yarnrc      registry "…"        yarn 1's own config view
#   ~/.yarnrc.yml  npmRegistryServer:  yarn 2/3/4, the file `config set --home` writes
#
# pnpm reads only the npm-compatible keys from .npmrc (its own settings moved to
# pnpm-workspace.yaml in v10) and its global ~/.config/pnpm/config.yaml is left
# alone on purpose: that file outranks even a project's own .npmrc. Yarn 1 ignores
# .yarnrc.yml, so the three files coexist in one home without disturbing anyone.
#
# Only the account dsh runs as is covered — $HOME, /home/app — since a root shell
# is not where package managers run. Keys that are already there are kept, so a
# hand-written file survives a restart, and this runs before the chown below so
# the new files end up owned by PUID.
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com/}"

# Append a line, first ensuring the file ends with a newline, so a hand-edited
# config file cannot have the new key glued onto its last line.
append_line() {
  append_file="$1"
  shift
  if [ -s "$append_file" ] && [ -n "$(tail -c 1 "$append_file")" ]; then
    printf '\n' >> "$append_file"
  fi
  printf '%s\n' "$*" >> "$append_file"
}

# Add one setting to one file, unless it is already there: npm's ini and yarn's
# store accept whitespace around the key, so the pattern has to as well. A file
# that exists but is not writable — a read-only bind mount holding an auth token,
# say — is left untouched, and a write that fails anyway must not take the
# container down with it: this is the user's configuration, not a precondition.
add_setting() {
  if [ -e "$1" ] && [ ! -w "$1" ]; then
    return 0
  fi
  grep -qsE "$2" "$1" || append_line "$1" "$3" || true
}

if [ -w "$HOME" ]; then
  add_setting "$HOME/.npmrc" '^[[:space:]]*registry[[:space:]]*=' "registry=$NPM_REGISTRY"
  add_setting "$HOME/.yarnrc" '^[[:space:]]*(-{1,2})?registry[[:space:]=]' "registry \"$NPM_REGISTRY\""
  add_setting "$HOME/.yarnrc.yml" '^[[:space:]]*npmRegistryServer[[:space:]]*:' "npmRegistryServer: \"$NPM_REGISTRY\""
fi

# Corepack and node-gyp have no config file to write, so their two mirrors have to
# travel in the environment. Corepack's is the same npm registry; node-gyp's is a
# binary mirror, because it appends /v<version>/node-v<version>-headers.tar.gz to
# whatever base it is given — the registry root answers 422 at that path. An
# inherited value wins, and a project's own `disturl` wins over it for node-gyp.
# (`disturl` is not written above: it is deprecated, and npm 11 warns about it on
# every command.)
export COREPACK_NPM_REGISTRY="$NPM_REGISTRY"
export NODEJS_ORG_MIRROR="${NODEJS_ORG_MIRROR:-https://npmmirror.com/mirrors/node}"

# NPM_REGISTRY has done its job: a variable meaning "use this registry" should not
# be inherited by every tool dsh spawns.
unset NPM_REGISTRY

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
