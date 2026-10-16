---
"@idsh/image": patch
---

Publish the image: `release.yml` builds `Dockerfile`'s final stage once a release lands and pushes it
to `ghcr.io/devockr/idsh` — tagged `latest`, the commit, and this version.
