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
| home screen icon (iOS) | the stock favicon, which iOS ignores — an SVG is not a usable `apple-touch-icon` | that favicon rasterised to a 512px PNG, white glyph on a mid-tone brand-blue square |

The CSS is byte for byte what the image injected into `dist/index.html`; the composer and
icon behaviour is the same intent, reached a different way (see below).

## How the Enter rewrite works

The composer is a Lexical editor, and its stock behaviour sends on a plain Enter. Two things
follow from that, and the second is the one worth remembering:

- The editable is found through `composedPath()`, not `closest()`: the composer writes
  `contenteditable=""` rather than `"true"`, and the editor sits inside a shadow root, where
  the event target is retargeted to the host.
- **A dispatched keyboard event cannot do this.** Untrusted events have no default behaviour,
  so a synthetic `Shift+Enter` inserts nothing however it is routed — measured against the
  running editor. Lexical's `insertLineBreak` command runs from `beforeinput`, so the rewrite
  stops the plain Enter in the capture phase and dispatches

  ```ts
  new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true })
  ```

  which the editor accepts and turns into a real break, as
  `<br data-lexical-managed-linebreak>` in its DOM.

## Why the icon is one tile

`apple-touch-icon` and iOS have three properties that decide this, all of them measured:

- **iOS ignores an SVG icon**, which is why the phone used to keep its own default.
- **It samples the icon when the shortcut is added**, so a `prefers-color-scheme` pair would
  freeze whichever theme was active at that moment. Apple's own dark-icon treatment re-renders
  and swaps the background by itself, so one mid-tone tile serves both.
- **It only ever downsamples.** 512px covers the largest slot in service (iPad Pro at
  167pt × 2 = 334px); 180 is the iPhone slot and soft there, and 1024 measured 47.2KB of data
  URI against 16.9KB at 512. The artwork comes from the favicon the app already serves, because
  nothing under a plugin package is reachable by URL.

## Install

```sh
dsh plugin --profile web add @idsh/mobile
```

Reload the page. With DevTools open, `document.body.dataset.idshMobile` reads
`css+enter coarse:true icon:ok` on a phone.

## Verified

On the running deployment, in a phone-sized touch context, with the plugin installed:

```
composer element   DIV contenteditable="true"           ← what composedPath() finds
plain Enter        <br data-lexical-managed-linebreak>  ← the rewrite inserts a real break
rasteriser         180/512/1024px → 4.1KB / 16.9KB / 47.2KB of data URI
```

Both fixes are also confirmed on a real iPhone: the home-screen shortcut shows the blue tile
with the white glyph, a plain Enter in the composer inserts a line break instead of sending,
and a plain Enter still reaches the session-search input untouched.

The probe's mobile scenario covers the CSS and the marker (`node tools/ui-probe.mts --scenario
mobile`); its Enter assertion still dispatches the keydown this package no longer sends, so
that scenario needs updating before it can be read as a verdict on the rewrite.
