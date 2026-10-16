---
"@idsh/privileged-ui": patch
---

Grant the privileged surface only to a page this deployment serves: the host half now asks dsh's
own request gate (`connection.requestRejection`) and the browser half grants nothing until it
answers yes, so loopback forms, IPv6 literals, default ports and the declared authorities are
decided by the code that defines them instead of by a matcher here.
