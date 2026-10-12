---
'@idsh/mobile': patch
---

The home-screen icon is a PNG again: iOS ignores an SVG `apple-touch-icon`, so the phone kept showing its default. It is fixed rather than derived from the served favicon at runtime, and inlined because a package serves one file.

Enter now inserts a line break on the composer as intended. It matched `contenteditable="true"` only, while the composer writes `contenteditable=""` — dsh's own shortcut plugin matches both — and the editor sits inside a shadow root, where the event target is retargeted to the host; the rewrite walks `composedPath()` instead.
