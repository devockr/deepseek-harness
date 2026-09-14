# syntax=docker/dockerfile:1

# ---- Stage 1: build dsh from the deepseek-harness source, with patches ----
FROM node:24-alpine AS builder

# patch applies the patches; python3/make/g++/musl-dev compile native modules
RUN apk add --no-cache git patch python3 make g++ musl-dev

# pnpm (version pinned by the repo's packageManager field)
RUN corepack enable

WORKDIR /app

# Faster installs from the CN mirror
ENV npm_config_registry=https://registry.npmmirror.com

# Submodule source + patches
COPY deepseek-harness/ ./
COPY patches/ /tmp/patches/

# Apply the WebUI loopback-bypass patch
RUN patch -p1 < /tmp/patches/bypass-loopback.patch

# Install workspace deps (persistent pnpm store cache)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store CI=true pnpm install --frozen-lockfile

# Alpine's gcc already targets musl; the native build invokes `musl-gcc`.
RUN ln -s /usr/bin/gcc /usr/local/bin/musl-gcc

# Replace the submodule's .git pointer with the real git objects so the build
# can read the commit hash via `git rev-parse HEAD`.
COPY .git/modules/deepseek-harness .git

# Build: tsc + tsdown bundles the runtime
RUN pnpm run build


# ---- Stage 2: runtime ----
FROM node:24-alpine

# Avoid running as root
RUN addgroup -S app && adduser -S app -G app

# bash is required by dsh's bash executor (Alpine ships ash, not bash)
RUN apk add --no-cache bash

WORKDIR /app

# Built monorepo (source + lib + node_modules)
COPY --from=builder /app ./

COPY --chmod=755 entrypoint.sh /entrypoint.sh

USER app

EXPOSE 3080

ENTRYPOINT ["/entrypoint.sh"]
