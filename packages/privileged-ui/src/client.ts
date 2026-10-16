// The whole trick, in one property — and one check before granting it.
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
// It grants the surface only to a page this deployment actually serves: loopback, the
// listener's own bind literal, or an authority the host declared (`dsh web
// --trusted-host`, i.e. `DSH_TRUSTED_HOSTS`). dsh's fence around its own `/api` accepts
// exactly that set, so this follows it instead of privileging whoever can load the page.
// The list comes from the host half, because the browser cannot see it: /idsh/trusted-hosts.
//
// This is deliberately an exception to a designed boundary. Read the package README
// before installing it.
globalThis.__ModuleLoader__.load({
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

    /**
     * Whether a page authority is one of `entries`, by the rule dsh's own fence uses: a
     * declared authority without a port matches any port, one with a port matches exactly.
     */
    function authorityMatches(host: string, entries: string[]): boolean {
      const mine = host.toLowerCase()
      const name = mine.replace(/:\d+$/, '')
      return entries.some(entry => {
        const candidate = entry.toLowerCase()
        return candidate.includes(':') ? candidate === mine : candidate === name
      })
    }

    /** The authorities this deployment serves, plus its listener's own literal. */
    async function servedAuthorities(): Promise<string[]> {
      const response = await fetch('/idsh/trusted-hosts', {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        return []
      }
      const body = (await response.json()) as {
        trustedHosts?: unknown
        bindHosts?: unknown
      }
      const asList = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : []
      return [...asList(body.trustedHosts), ...asList(body.bindHosts)]
    }

    /**
     * True when this page may carry the privileged surface. Loopback needs no round trip;
     * anything else has to be named by the deployment. A failure to read the list grants
     * nothing, which keeps an unreachable host half on the safe side of the boundary.
     */
    async function mayBePrivileged(): Promise<boolean> {
      const name = location.hostname.toLowerCase()
      if (
        name === '127.0.0.1' ||
        name === '::1' ||
        name === 'localhost' ||
        name.endsWith('.localhost')
      ) {
        return true
      }
      try {
        return authorityMatches(location.host, await servedAuthorities())
      } catch {
        return false
      }
    }

    function apply(ctx: PluginContext): void {
      void mayBePrivileged().then(allowed => {
        if (!allowed) {
          mark('SELF-CHECK-FAILED origin-not-declared:' + location.host)
          return
        }
        grant(ctx)
      })
    }

    /**
     * The half that writes the flag. Split from `apply` so the decision above can be
     * asynchronous — the list it needs is a request — while this stays exactly what it
     * was: a synchronous write, reported, and undone on disposal.
     */
    function grant(ctx: PluginContext): void {
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
      const facts = services.remote?.$host
      const host = facts?.isLoopback
      const state =
        'connection:' + before + '->' + connection.isLoopback + ' host:' + host
      const visible = host !== false
      // The one ordering outcome that is still repairable: a live gateway that copied `false` before
      // this plugin activated. The settings pages read these facts, so writing them reaches every
      // reader that has not cached the value itself — and the marker below still reports that the
      // gateway had it wrong, so the regression is visible rather than quietly papered over.
      let repaired = false
      if (host === false && facts !== undefined) {
        try {
          facts.isLoopback = true
          repaired = true
        } catch {}
      }
      mark(visible ? state : 'SELF-CHECK-FAILED ' + state)
      // cordis's own teardown: the effect body returns what undoes it — including the facts above,
      // or a dropped package would leave the pages it privileged still privileged.
      ctx.effect(() => () => {
        try {
          connection.isLoopback = before
        } catch {}
        if (repaired) {
          try {
            ;(facts as { isLoopback?: boolean }).isLoopback = host
          } catch {}
        }
      })
    }

    exports.apply = apply

    return module.exports
  },
})
