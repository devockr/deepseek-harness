---
"@idsh/image": patch
---

Bake dsh `0.2.1-rc.1` instead of `0.2.1-alpha.4`, and pnpm `12.14.0` instead of `12.11.2`. Both are
what the published image installs, so the image's own version moves with them; the three plugin
packages move too, because `pnpm run version` writes their `dsh plugin …` lines from their manifests.
