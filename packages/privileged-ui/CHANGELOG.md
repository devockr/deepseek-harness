# @idsh/privileged-ui

## 0.0.1

### Patch Changes

- [#27](https://github.com/devockr/idsh/pull/27) [`3b26eca`](https://github.com/devockr/idsh/commit/3b26eca1c3a79d93595241992f87a38ee7ee3705) Thanks [@JounQin](https://github.com/JounQin)! - Grant the privileged surface only to a page this deployment serves: the host half now asks dsh's
  own request gate (`connection.requestRejection`) and the browser half grants nothing until it
  answers yes, so loopback forms, IPv6 literals, default ports and the declared authorities are
  decided by the code that defines them instead of by a matcher here.
