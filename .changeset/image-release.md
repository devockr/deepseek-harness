---
"@idsh/image": patch
---

Publish the image: once a release lands, `release.yml` builds `Dockerfile`'s final stage and pushes
it to `ghcr.io/devockr/idsh` and to Docker Hub's `devockr/idsh` — tagged `latest`, the commit, and
this version.
