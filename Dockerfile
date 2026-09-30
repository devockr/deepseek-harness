# glibc base (not Alpine): dsh 0.2.x depends on node-addon-require-builtin, whose
# prebuilt binaries are published for linux-*-gnu only — there is no musl build,
# so Alpine fails at boot with "No usable native binding found".
FROM node:24-bookworm-slim

# Create a non-root user for dsh to run as. docker-compose overrides it at
# runtime via `user: "${UID}:${GID}"` so dsh runs as the host user and files it
# writes into the bind mounts are owned by the host user, not a container uid.
RUN groupadd app && useradd -m -g app -s /bin/bash app

# bash is required by dsh's bash executor (the slim image ships dash, not bash).
RUN apt-get update && apt-get install -y --no-install-recommends bash \
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

USER app

WORKDIR /app

EXPOSE 3080

ENTRYPOINT ["/entrypoint.sh"]
