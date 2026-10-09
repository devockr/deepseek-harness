---
description: "Re-enable the loopback-only privileged surface for a dsh Web profile served to a non-loopback origin — the deliberate security exception the self-hosted image carried as a build-time patch."
kind: "package-bundle"
---

# @idsh/privileged-ui

## Read this first

dsh decides, once, whether the page talking to it is the operator's own machine:

```js
// @deepseek-ai/dsh-client-connection, browser half
ctx.provide('connection', { isLoopback: transport?.ownsHost === true
                                       || pageLocation === undefined
                                       || isLoopbackHostname(pageLocation.hostname), … })
```

That single boolean carries the privileged surface, and upstream is explicit that a
*served* page must not be able to claim it: *"Only a shell that assembles its own
transport can set this; served pages never carry the global at all."* A page reached
over the LAN or the internet is therefore **not** loopback, and loses:

| Consumer | When `isLoopback` is false |
|---|---|
| `@deepseek-ai/dsh-client-ui-settings` | settings persistence falls back to `"memory"` — changes are lost on reload |
| `@deepseek-ai/dsh-client-ui-settings-general` | the document controller behind the Models/settings page is not built |
| `@deepseek-ai/dsh-cordis-client-runner` | reads the same flag |

**This package flips that flag at runtime, in the browser. It is an exception to a
deliberate boundary, not a feature of dsh.** Install it only where you would
otherwise have patched dsh's own JavaScript — that is, on a single-tenant,
self-hosted deployment you control, behind whatever network control you already
rely on. It is not a substitute for authentication.

## What it does

* Browser half (`lib/client.js`): on activation it asserts that
  `ctx.connection.isLoopback` is a writable boolean, sets it to `true`, and reports
  the result — including what the gateway's `$host` facts already captured — as
  `document.body.dataset.idshPrivileged` and one console line. If the property is
  missing or not writable it reports `SELF-CHECK-FAILED …` instead of failing
  silently. On disposal it restores the original value.
* Host half: empty. The decision belongs to the browser, because that is where dsh
  makes it.

The image this package was extracted from did the same thing at build time by
patching dsh's installed files (`isLoopbackHostname` was made to return `true`
unconditionally, and the document controller was disabled separately). Moving it
here means: no patched JavaScript in the image, installable and removable per
profile, and the exception is visible in one file instead of a build step.

## Install

```sh
dsh plugin --profile web add @idsh/privileged-ui
```

Then reload the page. Open DevTools and look for
`document.body.dataset.idshPrivileged` — it should read
`connection:false->true host:true` on a remote page. `host:false` means the gateway
captured the flag before this package activated, and the rows that read `$host`
(`ui-settings`, and the Cordis runner) then have to be re-activated for the change to
reach them; that is what the marker is for.

## Limits

* It depends on dsh internals (`ctx.connection.isLoopback` being a writable property
  of a plain object). The self-check turns that into a visible failure rather than a
  silent no-op, but a dsh upgrade can still invalidate the approach.
* Persistence mode is chosen when the consuming plugin activates. If that happens
  before this package, the flag is flipped too late — see `host:` in the marker.
