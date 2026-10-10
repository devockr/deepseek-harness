---
description: "The touch-device half of the Web UI as a client plugin: coarse-pointer CSS, Enter inserting a line break instead of sending, and an iOS home-screen icon."
kind: "package-bundle"
---

# @idsh/mobile

## Summary

Three fixes for using the Web UI on a phone, all of which the self-hosted image got by
patching dsh's installed files at build time. Doing them from a client plugin means the
image can ship an untouched dsh and install a package instead.

| | Stock dsh | With this package |
|---|---|---|
| page panning on touch | browser default | `html { touch-action: pan-x pan-y }` under `@media (pointer: coarse)` |
| focusing a control on iOS | Safari zooms the page, because the control is under 16px | `select, :read-write:not(.xterm-helper-textarea) { font-size: max(16px, 1em) !important }` |
| Enter on a touch keyboard | **sends** the message (there is no Shift key to reach a newline) | inserts a line break; the send button sends |
| home screen icon (iOS) | the stock favicon | the image's rewrite of it — white glyph on a blue rounded square, 1024px — offered as `apple-touch-icon` |

The CSS is byte for byte what the image injected into `dist/index.html`; the composer
change is the same idea as its sed but expressed differently (see below).

## How the Enter rewrite works

Stock behaviour is a keydown handler that sends when `event.key === 'Enter' &&
!event.shiftKey`, and a shifted Enter runs the editor's own line-break command. A plugin
cannot reach that command, so this one rewrites the *event* instead: in the capture phase,
on a coarse pointer, a plain Enter is stopped before the composer sees it and a synthetic
`Shift+Enter` is dispatched on the same editable.

That also composes with the image's own patch rather than doubling it — where that patch is
present, its handler never receives the plain Enter either.

## Install

```sh
dsh plugin --profile web add @idsh/mobile
```

Reload the page. With DevTools open, `document.body.dataset.idshMobile` reads
`css+enter coarse:true icon:ok` on a phone.

## Verified

`node tools/ui-probe.mjs --scenario mobile --install file:packages/mobile` in a phone
context (`hasTouch`, 390×844, DPR 3) against an **unpatched** dsh:

```
coarse: true
css: { touchAction: "pan-x pan-y", inputFontSize: "16px" }
enterEvents: ["Enter+shift"]     ← the plain Enter is gone, only the rewrite arrives
appleTouchIcon: true
problems: none
```

Not covered by that run: typing in the *real* composer needs a session, and the probe
profile starts without a workspace, so the send path is asserted by the handler's condition
(`Enter && !shiftKey`) rather than end to end. The home-screen icon is not verified on a
real iOS device — only that the transformed icon is offered, which is what the image's
favicon rewrite relied on.
