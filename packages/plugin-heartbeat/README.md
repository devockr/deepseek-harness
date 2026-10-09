---
description: "Raise the Remote-mux WebSocket heartbeat interval so a flaky or proxied link stops terminating the Web UI's connection."
kind: "package-bundle"
---

# @idsh/plugin-heartbeat

## Summary

The Web UI talks to the Host over one multiplexed WebSocket (`/api/remote.mux`,
owned by the Typert gateway). The Host pings it every
`websocketHeartbeatIntervalMs` and terminates a socket that has missed
`MAX_MISSED_HEARTBEATS` (2) pings, so the shipped default of 2000ms tolerates
roughly 4-6 seconds of stall. On a public or reverse-proxied link that is a normal
hiccup — a Wi-Fi roam, a GC pause, a closed laptop lid — and the UI's live
connection dies and reconnects for no real reason.

This bundle raises the interval to 30000ms (~60-90 seconds of tolerance). It is
config only: no code, no dependency, and no entry touched other than
`typert-gateway`.

## Use this package

```sh
dsh plugin --profile web add @idsh/plugin-heartbeat
```

or install it from the Web UI's **Plugins** page. With HMR the profile recomposes
and the new interval applies without a restart; without HMR it applies on the next
boot. The install adds the package to the profile and selects it in
`dsh.profile.bundles`.

Inside the container of this repository:

```sh
docker exec -u app -e HOME=/home/app dsh dsh plugin --profile web add @idsh/plugin-heartbeat
```

## What it changes

| | Shipped default | With this bundle |
|---|---|---|
| ping interval | 2000ms | 30000ms |
| tolerated stall before the socket is terminated | ~4-6s | ~60-90s |

`MAX_MISSED_HEARTBEATS` stays 2, so a link that is genuinely gone is still
detected — just later.

## Overriding it

A bundle layer sits below every user layer, so a profile that wants a different
value does not have to change or remove this package:

```yaml
# <profile>/cordis.patch.yml
- id: typert-gateway
  name: "@deepseek-ai/dsh-api-gateway"
  config:
    websocketHeartbeatIntervalMs: 120000
```

## Trade-offs

- A socket that is truly dead is noticed up to one interval later, so a reconnect
  after a real drop starts later than it would on the default.
- Ping volume is unchanged in kind and negligible either way: one control frame
  per open socket per interval.
- The value is a policy choice rather than a bug fix. 30000 suits a link with a
  proxy in the middle; a loopback-only setup gains nothing from it.

## Compatibility

The bundle addresses the config surface of `@deepseek-ai/dsh-api-gateway` as
shipped in dsh `0.2.x`. It declares no dependencies, so nothing is pulled into the
profile and no peer range is enforced; on a dsh version where that entry or its
config schema changed, the loader reports the entry's validation error rather than
silently ignoring the override.
