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
# npm, pnpm and yarn do not agree on how a registry is configured, and the
# environment reaches only one of them: NPM_CONFIG_REGISTRY is honoured by npm,
# but pnpm and yarn 1 ignore it while installing (measured — with the variable
# pointed at a dead host, `npm i` fails while `pnpm add` and `yarn add` still
# resolve through the default registry).
#
# The single file all three read is ~/.npmrc: npm and pnpm natively, and yarn v1
# resolves its tarballs through it as well — `yarn config get registry` still
# prints registry.yarnpkg.com, yet the URL recorded in yarn.lock is the mirror's.
# ~/.yarnrc is written too, so yarn's own config view tells the truth.
#
# For pnpm this file carries only the npm-compatible keys: it moved its own
# settings to pnpm-workspace.yaml in v10 — `strict-peer-dependencies` here reads
# back as undefined, `strictPeerDependencies` there as true — but `registry` is
# still read and used (measured: a dead registry in this file fails `pnpm add`
# outright, and `pnpm view <pkg> dist.tarball` answers with the configured one).
# Its global YAML config, ~/.config/pnpm/config.yaml, is deliberately NOT written:
# that file outranks even a project's own .npmrc (only the project's
# pnpm-workspace.yaml beats it), which would break the per-key override above.
#
# Yarn 2/3/4 (Berry) is a different program that reads none of those: its
# user-level — the "global" — configuration is ~/.yarnrc.yml, the very file
# `yarn config set --home npmRegistryServer <url>` writes. It reaches every
# project, including one that ships its own .yarnrc.yml for other settings, since
# those files merge per key; only a project that names its own npmRegistryServer
# takes precedence. Yarn 1 ignores .yarnrc.yml, so both files coexist in the same
# home without disturbing anyone.
#
# These files are the only place the registry is configured, and that is the
# point: for npm and Yarn 4 an environment variable outranks the project's own
# .npmrc / .yarnrc.yml, so one would silently defeat a project that pins its own
# registry. Files merge per key instead — a project that says nothing about the
# registry inherits the mirror, and one that names a registry wins (measured, as
# is everything above).
#
# Only the account dsh runs as is configured: $HOME, which is /home/app. A root
# shell is not where package managers are meant to run, and `docker exec` gets the
# container's environment injected anyway, so a second copy of these files under
# /root would only be a second thing to keep in sync.
#
# NPM_REGISTRY is the one variable this script reads, and it is dropped once the
# files exist (see below): with the answer already on disk, a variable meaning
# "use this registry" should not be inherited by every tool dsh spawns as a
# second, invisible layer of configuration.
#
# This runs before the chown below on purpose, so the files end up owned by PUID,
# and it never overwrites a key that is already set (that is how a user's own
# ~/.npmrc survives a container restart untouched).
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com/}"

# Add a configuration line, first making sure the file ends with a newline: a
# hand-edited .yarnrc.yml need not, and without this the new key would be glued
# onto the previous line instead of becoming its own.
append_line() {
  append_file="$1"
  shift
  if [ -s "$append_file" ] && [ -n "$(tail -c 1 "$append_file")" ]; then
    printf '\n' >> "$append_file"
  fi
  printf '%s\n' "$*" >> "$append_file"
}

if [ -w "$HOME" ]; then
  # npm, and through it pnpm and yarn 1.
  grep -qs '^registry='          "$HOME/.npmrc"      || append_line "$HOME/.npmrc"      "registry=$NPM_REGISTRY"
  # yarn 1's own config view.
  grep -qs '^registry '          "$HOME/.yarnrc"     || append_line "$HOME/.yarnrc"     "registry \"$NPM_REGISTRY\""
  # yarn 2/3/4 (Berry), global for every project.
  grep -qs '^npmRegistryServer:' "$HOME/.yarnrc.yml" || append_line "$HOME/.yarnrc.yml" "npmRegistryServer: \"$NPM_REGISTRY\""
fi

# Two more mirrors have to travel in the environment rather than a file, because
# the tools reading them have no config file to write: corepack fetches the
# package managers themselves and ignores .npmrc, and node-gyp fetches the Node
# headers a native module is compiled against.
#
# Corepack's is an npm registry, so it is the same one. Node-gyp's is a fixed
# binary mirror: whatever base it is given, it asks for
# /v<version>/node-v<version>-headers.tar.gz next to that version's SHASUMS256.txt,
# so the registry value cannot be reused verbatim — npmmirror answers 422 at that
# path, while https://npmmirror.com/mirrors/node serves both, which a full
# `node-gyp install` confirms with `gyp info ok`. A NODEJS_ORG_MIRROR that reached
# the container always wins, and a project pinning its own `disturl` is unaffected
# either way: npm hands that to node-gyp ahead of this. (The `disturl` key of
# ~/.npmrc is deliberately not written above: it is deprecated, and npm 11 warns
# about it on *every* command.)
export COREPACK_NPM_REGISTRY="$NPM_REGISTRY"
export NODEJS_ORG_MIRROR="${NODEJS_ORG_MIRROR:-https://npmmirror.com/mirrors/node}"

# The knob has done its job — see the note above for why it does not survive.
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
