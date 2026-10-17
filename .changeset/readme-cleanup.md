---
"@idsh/image": patch
"@idsh/mobile": patch
"@idsh/privileged-ui": patch
"@idsh/remote-access": patch
---

The package READMEs lose the YAML frontmatter they opened with. npm renders it as the first
paragraph rather than as metadata, and nothing read those fields — the description already lives in
each manifest — so the pages now start at the heading.

`@idsh/image` rides along because it pins these packages by version: a release that moves them has to
move the image's own version, which is what `release.yml` reads to decide whether to publish it.
