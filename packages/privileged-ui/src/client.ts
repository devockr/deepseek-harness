// The whole trick, in one property.
//
// dsh computes `ctx.connection.isLoopback` from the page's own authority and refuses
// to be convinced otherwise — upstream puts it plainly: "Only a shell that assembles
// its own transport can set this; served pages never carry the global at all". Every
// privileged affordance hangs off that one boolean (`ui-settings` picks "host" vs
// "memory" persistence, `ui-settings-general` builds its document controller only
// when true, the Cordis runner reads it too).
//
// A self-hosted deployment that is reached over the LAN or the internet wants that
// surface anyway. The image used to get it by patching dsh's installed JavaScript at
// build time; this does the same thing at runtime, in the browser, where the flag
// lives — installable, visible, and removable without touching dsh.
//
// This is deliberately an exception to a designed boundary. Read the package README
// before installing it.
window.__ModuleLoader__.load({
  id: '@idsh/privileged-ui',
  factory: () => {
    const module: { exports: Record<string, unknown> } = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const MARK = 'idshPrivileged'

    // A one-glance marker and a console line: the image's build-time patch fails the
    // build when dsh moves, and a runtime patch has to fail just as loudly instead of
    // rotting quietly. `document.body.dataset.idshPrivileged` is the whole report.
    function mark(state: string): void {
      try {
        document.body.dataset[MARK] = state
      } catch {}
      console.log('[privileged-ui] ' + state)
    }

    exports.name = '@idsh/privileged-ui'
    // `remote` is read below for the report, and cordis throws when a plugin touches a
    // service it did not inject — that throw is what made the first version inactive.
    exports.inject = ['connection', 'remote']

    function apply(ctx: PluginContext): void {
      // The one place this package reaches past the published client types, and it is the point of
      // the package: dsh's `Context` does not declare `connection` or `remote` for client plugins,
      // and it declares the flag `readonly` on the host side, because a served page is not supposed
      // to write it at all. Stating the shape here is smaller than a hand-written context interface
      // and keeps everything else — `ctx.effect` included — checked against dsh's own types.
      const services = ctx as unknown as {
        connection?: { isLoopback: boolean }
        remote?: { $host?: { isLoopback?: boolean } }
      }
      const connection = services.connection
      const before = connection?.isLoopback
      if (connection === undefined || typeof before !== 'boolean') {
        mark('SELF-CHECK-FAILED connection.isLoopback is ' + typeof before)
        return
      }
      try {
        connection.isLoopback = true
      } catch (error) {
        mark('SELF-CHECK-FAILED not writable: ' + (error as Error).message)
        return
      }
      // Whether the consumers can see this depends on when they read it: the gateway copies the
      // flag into its `$host` facts when it activates, and the settings pages read
      // `$host.isLoopback`. So the flag alone is not the point — a live gateway that still says false
      // is the activation-order regression this package exists to prevent, and it has to fail as
      // loudly as a property that cannot be written. A profile with no gateway at all reports
      // undefined, which is not judged.
      const host = services.remote?.$host?.isLoopback
      const state = 'connection:' + before + '->' + connection.isLoopback + ' host:' + host
      const visible = connection.isLoopback === true && host !== false
      mark(visible ? state : 'SELF-CHECK-FAILED ' + state)
      // cordis's own teardown: the effect body returns what undoes it.
      ctx.effect(() => () => {
        try {
          connection.isLoopback = before
        } catch {}
      })
    }

    exports.apply = apply

    return module.exports
  },
})
