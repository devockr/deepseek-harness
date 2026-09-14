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
# mode. Force isLoopbackHostname to always answer true so settings work over the LAN.
RUN f="$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js" \
 && sed -i 's/if (hostname === "localhost" || hostname === "\[::1\]")//' "$f" \
 && ! grep -Fq 'if (hostname === "localhost"' "$f"

COPY --chmod=755 entrypoint.sh /entrypoint.sh

USER app

WORKDIR /app

EXPOSE 3080

ENTRYPOINT ["/entrypoint.sh"]
