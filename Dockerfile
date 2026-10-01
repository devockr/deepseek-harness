# glibc base (not Alpine): dsh 0.2.x depends on node-addon-require-builtin, whose
# prebuilt binaries are published for linux-*-gnu only — there is no musl build,
# so Alpine fails at boot with "No usable native binding found".
FROM node:24-bookworm-slim

# Create the account dsh runs as. Its uid/gid here are placeholders only: the
# real ones arrive at runtime as PUID/PGID and entrypoint.sh re-points this
# account at them before dropping privileges (the linuxserver.io convention).
# This line also supplies the account's home and skeleton files up front.
# On Alpine: busybox adduser has a different CLI — `apk add shadow` for the real
# useradd/usermod/groupadd/groupmod, and `util-linux` for setpriv/mountpoint.
RUN groupadd app && useradd -m -g app -s /bin/bash app

# bash is required by dsh's bash executor (the slim image ships dash, not bash).
# openssh-client provides the actual ssh/scp/sftp/ssh-keygen binaries — and those
# need the runtime uid to exist in /etc/passwd (see entrypoint.sh).
# git is what dsh's tools use for repo work; the slim image omits it.
# ca-certificates supplies /etc/ssl/certs/ca-certificates.crt, the trust store
# git/curl/node read for TLS. Without it `git clone https://…` dies with
# "server certificate verification failed … CAfile: none" — and node's own
# outbound HTTPS works only because it falls back to its bundled roots, so the
# gap shows up in git first. Not inherited from the base: bookworm-slim ships
# no CA bundle.
# util-linux is what entrypoint.sh relies on: setpriv (drop privileges) and
# mountpoint (never chown a bind mount). Named explicitly so a missing binary
# fails the build rather than the boot.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates git openssh-client util-linux \
 && rm -rf /var/lib/apt/lists/*

# Install the CLI globally (as root, so it can write to the global prefix).
# The web profile's HMR service requires Node's --expose-internals flag, which
# Node refuses to accept via NODE_OPTIONS, so it is passed in entrypoint.sh.
# The cache mount persists npm's package cache (named "npm_cache") across builds.
RUN --mount=type=cache,id=npm_cache,target=/root/.npm npm install -g @deepseek-ai/dsh

# Bypass the web client's loopback gate: dsh treats a non-loopback page authority
# (e.g. dsh.example.com) as "remote", which leaves the settings page in memory-only
# mode. Force isLoopbackHostname to always answer true so settings work over the
# LAN, and drop the desktop-only "open configuration file" action (xdg-open is
# absent in the container, so it only ever errors).
RUN base="$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai" \
 && f="$base/dsh-client-connection/lib/client.js" \
 && sed -i 's/if (hostname === "localhost" || hostname === "\[::1\]")//' "$f" \
 && ! grep -Fq 'if (hostname === "localhost"' "$f" \
 && g="$base/dsh-client-ui-settings-general/lib/client.js" \
 && sed -i 's/const documentController = .*/const documentController = void 0;/' "$g" \
 && ! grep -Fq 'new SettingsDocumentStore' "$g"

COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Deliberately no USER here: the container starts as root so entrypoint.sh can
# re-point `app` to PUID/PGID and fix ownership, then it drops to that uid with
# setpriv before exec'ing dsh. This is what makes the image reusable by anyone —
# no uid is baked in.
#   docker exec ... -> root; use `docker exec -u app ...` for a shell as app.
# Do not cap_drop ALL: switching uid needs CAP_SETUID/CAP_SETGID.

WORKDIR /app

EXPOSE 3080

ENTRYPOINT ["/entrypoint.sh"]
