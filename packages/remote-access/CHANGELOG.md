# @idsh/remote-access

## 0.0.2

### Patch Changes

- [#43](https://github.com/devockr/idsh/pull/43) [`c4189cf`](https://github.com/devockr/idsh/commit/c4189cf6fe51bc46ab221128a2639df4277c3484) Thanks [@JounQin](https://github.com/JounQin)! - The package READMEs lose the YAML frontmatter they opened with. npm renders it as the first
  paragraph rather than as metadata, and nothing read those fields — the description already lives in
  each manifest — so the pages now start at the heading.

  `@idsh/image` rides along because it pins these packages by version: a release that moves them has to
  move the image's own version, which is what `release.yml` reads to decide whether to publish it.

## 0.0.1

### Patch Changes

- [#27](https://github.com/devockr/idsh/pull/27) [`3b26eca`](https://github.com/devockr/idsh/commit/3b26eca1c3a79d93595241992f87a38ee7ee3705) Thanks [@JounQin](https://github.com/JounQin)! - First published release: the bundle that keeps a remote dsh Web profile reachable — the heartbeat
  interval that carries the UI's multiplexed WebSocket through a stall, and the interface fallback the
  entrypoint's own address overrides.
