---
"@idsh/image": patch
"@idsh/mobile": patch
"@idsh/privileged-ui": patch
"@idsh/remote-access": patch
---

The images now bake dsh `0.2.1-rc.1` instead of `0.2.1-alpha.4` — its first release candidate.
The peer ranges already accept it (`^0.2.0-rc.1 || ^0.2.1-alpha.1` covers `0.2.1-rc.1`, `0.2.1-alpha.5`
and `0.2.1`), so no range changes; the plugin versions move with the image only so the release that
rewrites the `Dockerfile` lines also bumps what it ships.
