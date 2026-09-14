FROM node:24-alpine

# Avoid running as root
RUN addgroup -S app && adduser -S app -G app

# bash is required by dsh's bash executor (Alpine ships ash, not bash).
RUN apk add --no-cache bash

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
