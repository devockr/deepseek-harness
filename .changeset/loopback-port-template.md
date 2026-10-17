---
"@idsh/image": patch
---

The compose template publishes `15080` on loopback instead of every interface, and `DSH_TRUSTED_HOSTS`
no longer defaults to a placeholder name. Deployments built from the template stop handing out a port
that bypasses whatever reverse proxy sits in front of them.
