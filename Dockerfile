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

COPY --chmod=755 entrypoint.sh /entrypoint.sh

USER app

WORKDIR /app

EXPOSE 3080

ENTRYPOINT ["/entrypoint.sh"]
