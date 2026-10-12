// The touch-device half of the Web UI, as a client plugin.
//
// The image this was extracted from got all three of these by patching dsh's installed
// files at build time: two CSS rules injected into dist/index.html, a rewritten
// dist/favicon.svg, and a sed-injected branch inside the composer's keydown handler.
// Doing them here means the image can ship an untouched dsh and install a package.
window.__ModuleLoader__.load({
  id: '@idsh/mobile',
  factory: () => {
    const module: { exports: Record<string, unknown> } = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    exports.name = '@idsh/mobile'
    exports.inject = []

    // One-glance state for the probe and for anyone with DevTools open.
    let state = 'starting'
    function mark(extra?: string): void {
      state = extra === undefined ? state : extra
      try {
        document.body.dataset.idshMobile = state
      } catch {}
      console.log('[mobile] ' + state)
    }

    /**
     * Coarse-pointer CSS, byte for byte what the image injected into index.html:
     * vertical page panning, and a 16px floor on form controls so iOS does not zoom the
     * page when one takes focus (the terminal keeps its own size).
     */
    const CSS =
      '@media(pointer:coarse){html{touch-action:pan-x pan-y}' +
      'select,:read-write:not(.xterm-helper-textarea){font-size:max(16px,1em)!important}}'

    function injectCss(): Disposable {
      const style = document.createElement('style')
      style.dataset.idshMobile = 'css'
      style.textContent = CSS
      document.head.append(style)
      return () => style.remove()
    }

    /**
     * Enter inserts a line break on a touch device instead of sending.
     *
     * Stock behaviour is `event.key === "Enter" && !event.shiftKey` → send, and a shifted
     * Enter runs the editor's own line-break command. So the plain key is turned into a
     * shifted one in the capture phase, and the original is stopped before the composer's
     * handler ever sees it.
     */
    function rewriteEnterOnCoarsePointers(): Disposable {
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
        if (event.isComposing || event.keyCode === 229) return // mid-IME
        if (!window.matchMedia('(pointer: coarse)').matches) return
        // Only the composer's own editor: the same rewrite on a plain input (the session
        // search) or the terminal's textarea would break them, and the patch this replaces
        // lived inside the composer's handler, so that is the scope it had.
        //
        // Two things about finding it: the composer writes `contenteditable=""` rather than
        // `"true"` — dsh's own shortcut plugin matches both — and the editor sits inside a shadow
        // root, where the event target is retargeted to the host. composedPath sees through it.
        const editable = event
          .composedPath()
          .find(
            (node): node is HTMLElement =>
              node instanceof HTMLElement &&
              (node.getAttribute('contenteditable') === 'true' || node.getAttribute('contenteditable') === ''),
          )
        if (editable === undefined) return
        event.stopPropagation()
        event.preventDefault()
        editable.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        )
      }
      document.addEventListener('keydown', onKeydown, true)
      return () => document.removeEventListener('keydown', onKeydown, true)
    }

    /**
     * The iOS home-screen icon, rasterised from the favicon the app already serves. iOS ignores
     * an SVG apple-touch-icon — which is why the phone kept its own default — and nothing under a
     * plugin package is reachable by URL (measured: the /favicon.svg control answers 200 while
     * every /plugins/… path answers 404). So the artwork comes from the page itself, is turned
     * into a PNG here, and the PNG is what iOS is given.
     */
    async function rewriteHomeScreenIcon(): Promise<Disposable> {
      const link = document.querySelector('link[rel~="icon"]')
      if (!(link instanceof HTMLLinkElement)) return () => {}
      const source = await (await fetch(link.href)).text()
      const svg = source
        .replace(/(<path[^>]*)fill="#[0-9A-Fa-f]{3,6}"/g, '$1fill="#FFFFFF"')
        .replace(/(<svg[^>]*)viewBox="[^"]*"/, '$1viewBox="-7.83 -7.83 66 66"')
        .replace(/(<svg[^>]*)width="[0-9.]+" height="[0-9.]+"/, '$1width="180" height="180"')
        .replace(/<path/, '<rect x="-7.83" y="-7.83" width="66" height="66" rx="12" ry="12" fill="#4D6BFE"/><path')
      const image = new Image()
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 180
      canvas.height = 180
      canvas.getContext('2d')?.drawImage(image, 0, 0, 180, 180)
      const icon = document.createElement('link')
      icon.rel = 'apple-touch-icon'
      icon.dataset.idshMobile = 'icon'
      icon.href = canvas.toDataURL('image/png')
      document.head.append(icon)
      return () => icon.remove()
    }

    function apply(ctx: PluginContext): void {
      const teardown: Disposable[] = [injectCss(), rewriteEnterOnCoarsePointers()]
      let disposed = false
      mark('css+enter coarse:' + window.matchMedia('(pointer: coarse)').matches)
      rewriteHomeScreenIcon()
        .then((off) => {
          // The icon arrives a fetch later, so a dispose that already happened has to undo it
          // here: the teardown list was drained and would never see this one.
          if (disposed) {
            off()
            return
          }
          teardown.push(off)
          mark(state + ' icon:ok')
        })
        .catch((error: unknown) => mark(state + ' icon:' + (error as Error).message))
      // cordis's own teardown: the effect body returns what undoes it.
      ctx.effect(() => () => {
        disposed = true
        for (const off of teardown) {
          try {
            off()
          } catch {}
        }
      })
    }

    exports.apply = apply

    return module.exports
  },
})
