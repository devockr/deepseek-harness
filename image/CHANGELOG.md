# @idsh/image

## 0.0.3

### Patch Changes

- [#43](https://github.com/devockr/idsh/pull/43) [`c4189cf`](https://github.com/devockr/idsh/commit/c4189cf6fe51bc46ab221128a2639df4277c3484) Thanks [@JounQin](https://github.com/JounQin)! - The package READMEs lose the YAML frontmatter they opened with. npm renders it as the first
  paragraph rather than as metadata, and nothing read those fields — the description already lives in
  each manifest — so the pages now start at the heading.

  `@idsh/image` rides along because it pins these packages by version: a release that moves them has to
  move the image's own version, which is what `release.yml` reads to decide whether to publish it.

## 0.0.2

### Patch Changes

- [#33](https://github.com/devockr/idsh/pull/33) [`54aebec`](https://github.com/devockr/idsh/commit/54aebec126394ffe7b427baddc76d1bcad51bf96) Thanks [@renovate](https://github.com/apps/renovate)! - Bake dsh `0.2.1-rc.1` instead of `0.2.1-alpha.4`, and pnpm `12.14.0` instead of `12.11.2`. Both are
  what the published image installs, so the image's own version moves with them; the three plugin
  packages move too, because `pnpm run version` writes their `dsh plugin …` lines from their manifests.

## 0.0.1

### Patch Changes

- [#31](https://github.com/devockr/idsh/pull/31) [`a78bd43`](https://github.com/devockr/idsh/commit/a78bd43625b57be7cf3c575b257c029f4595518a) Thanks [@JounQin](https://github.com/JounQin)! - Publish the image: once a release lands, `release.yml` builds `Dockerfile`'s final stage and pushes
  it to `ghcr.io/devockr/idsh` and to Docker Hub's `devockr/idsh` — tagged `latest`, the commit, and
  this version.
