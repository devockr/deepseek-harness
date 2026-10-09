---
description: "Reach a dsh Web profile from another machine: bind every interface and keep the UI's Remote-mux WebSocket alive across a flaky or proxied link."
kind: "package-bundle"
---

# @idsh/remote-access

## Summary

Two settings that together make a dsh Web profile usable from another machine —
both of them things dsh deliberately will not do from the command line.

1. **Bind every interface.** The shipped `webserver` row binds `127.0.0.1`, so the
   GUI accepts connections from its own host only. `dsh web --host 0.0.0.0` is
   refused in code (`it would expose remote code execution to the network`), which
   leaves a config layer as the only way to ask for it. This bundle's fallback is
   `0.0.0.0`.
2. **Keep the UI's live connection alive.** The Web UI talks to the Host over one
   multiplexed WebSocket (`/api/remote.mux`, owned by the Typert gateway). The Host
   pings it every `websocketHeartbeatIntervalMs` and terminates a socket that has
   missed `MAX_MISSED_HEARTBEATS` (2) pings, so the shipped default of 2000ms
   tolerates roughly 4-6 seconds of stall. On a public or reverse-proxied link that
   is a normal hiccup — a Wi-Fi roam, a GC pause, a closed laptop lid — and the
   connection dies and reconnects for no real reason. This bundle raises the
   interval to 30000ms (~60-90 seconds).

It is config only: no code, no dependency, and no entry touched other than
`webserver` and `typert-gateway`.

## Use this package

```sh
dsh plugin --profile web add @idsh/remote-access
```

or install it from the Web UI's **Plugins** page. With HMR the profile recomposes
and the new values apply without a restart; without HMR they apply on the next
boot. The install adds the package to the profile and selects it in
`dsh.profile.bundles`.

Inside the container of this repository:

```sh
docker exec -u app -e HOME=/home/app dsh dsh plugin --profile web add @idsh/remote-access
```

The image's `entrypoint.sh` already passes a `webserver` overlay of its own, so for
that container only the heartbeat half of this bundle is new.

## Where this fits

Reaching a dsh host from another machine needs two things, and both of them are
configuration dsh leaves to you. This package covers both.

**The host has to be dialable.** Binding every interface is enough whenever the
host already has an address a browser can reach — a public IPv6 address with the
firewall opened, a forwarded port, a relay in front — and it is also what lets a
browser on the same network in. It is *not* what gets you through NAT: if the host
has no dialable address, put a reverse tunnel in front instead.
[`@froststarinquire/dsh-remote-access-web`](https://github.com/wikkd/dsh-remote-access-web)
publishes one (frp-based, MIT). It is a different layer, not a replacement: a
tunnel changes how the browser reaches the host, while the heartbeat below is what
keeps the UI's socket alive across the extra hop. Two caveats if you go that way —
it targets the `0.1.0-rc.x` dsh line, and `0.2.x` refuses it as an incompatible DSH
peer range (the `--remote-auth` / `--allow-remote-privileged` surfaces its launch
contract wants are not part of the `0.2.x` web app either).

**The connection has to survive the distance.** This is the half the package was
written for. The Remote mux is one long-lived WebSocket, and the shipped heartbeat
gives it roughly 4-6 seconds of slack before the Host terminates it. That is fine
across a desk; over a long-distance path it is not — a Wi-Fi roam, a GC pause, a
route flap or a proxy hiccup is enough to drop the UI and force a reconnect. The
30-second interval here came out of exactly that: a `dsh web` deployment reached
over the public internet from another city, where a few seconds of stall on the way
was making the UI drop for no real reason.


## A side effect worth knowing: the directory picker

`dsh-host-directory-picker-auto` resolves the directory-picking interaction once at
boot: `native` requires a **loopback-only bind**, a non-SSH launch and a servable
display session, and *anything ambiguous resolves to `browse`*. Binding every
interface therefore lands on the in-app browse dialog, which works for a remote
operator — so "Add workspace" keeps working. A loopback-bind tunnel deployment does
not get this for free and has to pin the picker explicitly.

## What it changes

| | Shipped default | With this bundle |
|---|---|---|
| `webserver.host` | `127.0.0.1` | `0.0.0.0` (all interfaces) |
| ping interval on the Remote mux | 2000ms | 30000ms |
| tolerated stall before that socket is terminated | ~4-6s | ~60-90s |

`webserver.port`, `compression`, `compressionLevel` and
`compressionThresholdBytes` are restated exactly as shipped, because a patch
replaces a row's whole `config`. `MAX_MISSED_HEARTBEATS` stays 2, so a link that is
genuinely gone is still detected — just later.

## Read this before you bind every interface

- **The trust fence widens with the bind.** dsh samples the network once at boot: a
  loopback bind derives no LAN addresses, while an all-interfaces bind adds *every*
  non-internal IPv4 literal to the `/api` browser-trust fence, and the LAN URL it
  prints matches that fence. Binding all interfaces therefore trusts every LAN
  address, not just yours. Adding `--trusted-host <authority>` (a hostname, a
  reverse proxy's authority) is additive and does not narrow that.
- **Put authentication in front of it** if the machine is not on a network you
  control: a reverse proxy with TLS and auth, or a VPN. The GUI's token exchange
  authenticates API calls and WebSocket streams, but the bind is what decides who
  can reach them.
- **Opt back out per run** without removing the package: `--host 127.0.0.1` and
  `--port` are still honoured, because the patch keeps the shipped `!!js`
  fallbacks (`ctx.webStartup.host ?? '0.0.0.0'`).

## Overriding it

A bundle layer sits below every user layer, so a profile that wants different
values does not have to change or remove this package:

```yaml
# <profile>/cordis.patch.yml
- id: webserver
  name: "@deepseek-ai/dsh-host-webserver"
  config:
    host: "0.0.0.0"
    port: !!js ctx.webStartup.port ?? 3080
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
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
- 30000 is a deliberate middle: it absorbs the seconds-long stalls a long-distance or
  proxied path produces, while a socket that is genuinely gone is still cleaned up
  within ~90s. Lower it if you would rather fail fast, raise it for a satellite or
  heavily proxied link — the profile patch above wins over this bundle either way.

## Compatibility

The bundle addresses the config surfaces of `@deepseek-ai/dsh-host-webserver` and
`@deepseek-ai/dsh-api-gateway` as shipped in dsh `0.2.x`. It declares no
dependencies, so nothing is pulled into the profile and no peer range is enforced;
on a dsh version where an entry or its config schema changed, the loader reports
that entry's validation error rather than silently ignoring the override.
