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
     * The iOS home-screen icon. iOS ignores an SVG `apple-touch-icon`, so the phone kept showing
     * its own default; this is the same artwork the favicon carries — white glyph on brand blue,
     * 180x180 — as a fixed PNG rather than something derived from the served favicon at runtime.
     */
    async function rewriteHomeScreenIcon(): Promise<Disposable> {
      const icon = document.createElement('link')
      icon.rel = 'apple-touch-icon'
      icon.dataset.idshMobile = 'icon'
      icon.href = HOME_SCREEN_ICON
      document.head.append(icon)
      return () => icon.remove()
    }

    /**
     * The iOS home-screen icon, from assets/apple-touch-icon.png. iOS ignores an SVG
     * apple-touch-icon — which is why the phone kept its own default — and nothing under a
     * plugin package is reachable by URL: the client half arrives through a bundle endpoint and
     * every /plugins/… path answers 404 (measured, with a 200 control). So the PNG is inlined here, once, from
     * assets/apple-touch-icon.png — the one file the browser does get has to carry it.
     */
    const HOME_SCREEN_ICON =
      'data:image/png;base64,' +
      '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' +
      '7lzkqcWmJ0NTT2tDliyi4So10KhJ3DeXd0FDaWoDTKNMqqRQ3LMqsH3UdXRGRRUSJzdgI6cZUpdSU5rHCRCIxjK1koSvy11Y' +
      'ZqJcvLJKNRA5UL64xPRpyiFZP27cjGHcj7uQmE6n0KFyTW+mzOTY4zpaL7XOiwoY8xVdzeo+yGX2qyZ0f3bDjbemVO1i6H1S' +
      'fs5nX44aVtDu66LeY11pC6VOyqHGJ3FyuI8xab1g0xfa/3tr1KATkXC9QaU8TjjnJs/HKiRFDk44c38pZAjSn5NMCi6isX5U' +
      'H95G6I6EwIbqyc4tM5IVGLtr43ib6T8trl/04IUUGVIBynJEGRzNRBE/tEOzeK1p0CM1Dh738P8zOYjkiTl5GSODuiyWIfmF' +
      'JAfa4Hz6YkFHDSdkmaydeSEHR8V4ihgGZ3F+IvqP899lT440++VzRw7cjotXcyqcHDnTJCdBLa6AI9Uue9Tb7gZ7smr989z1' +
      'EpW2j55lGp0cE+aZ3Hrs7Ghnv82GHBzbk39mJE4OdhZP6R6Jxayc9n8+ZdI/NYxImPuKHA4ISTzfV7UILzWs2GIUpGRGDlYF' +
      'z18nPyZCm2w2lyZz+nx6zEBfMrRF58r2ws593m+NwYwhjgcv3ObCkLSiMCMlclBb6vIRN6K3y+otLHszjc0FZXyBmJHe7HM/' +
      'neYEeJzGMjCjs0uPnEqWGZeu2j+NNSJHDTCqxc/STcEl4snew8Y58xrCKeaTO9iWytzo2QVjRqpHarjLf3qrNYeF1ekjFq8U' +
      '1S5ctqg3gkbIyZ0ixRFuhWNG2ofxfH/R79T3e0N1FSPj7rcOEakG8nM37yreqSglOcZr/Dy/P02UlSGGNdT8allF/HdvkzZl' +
      '6L2NdUT6XSONyBGbZ9qjkgq6LzBXo56ryzltQ5r9jphiAlEsRnx+X0tRmZEBOTippNX3aC8GbwTyLrm4y+GdeDPj/GkTqYr1' +
      'dEHaCCePxj6MpOTkqCSd/J+/SttZoJE37isTSwhbj586ML5tlKPUCc1yOKmnGCdSB2oRIw70P9WDlabzlo9Rw5PCT8u00WYD' +
      'iRzeCDochyGCPkOYlW95f6mUgmuOGo5L88GQyaXrzbBxIkfYpKSfmkufuOOKnbLA1wgXP9l6thhGfw5qiqGqbOuPf0GnTj3F' +
      '55nFIofpPRwnxHC+6uHR/UBiw38hjWGjnrMx2F8iJsegNa0MMU5SLD85AL5hiOFJhBLM6aJ5tVqfTMDi3qZbU+fsOXR77ooY' +
      'GhpIz7OZJnqGdKnIUeEH/kQ4o31+/xfOG2fUE64G8+fDDfRhG8K9cJfCk0mLZVY/9/Jc/ESOPvvLtj3Z9wp81Wrpt3Zp4kV7' +
      'ENeBoGkOKSk2OXpCgzycjkCujDM9aOWtmQ6hQuQ/yetiHAUhcgTDjCUJ1s1DxBqsJYQbsAG6gE27HAXo3kMxnAWT6MjNcpJj' +
      '4O2J5lRlc26scBt3OiPST4aq0h0943GgtcjhFotSfM/tATz4vLgmvXOyJHDf/djZKVxWlGtt9shpy9x0Ro4OalK0ErG+PzeR' +
      'cdXRC63uXSc4JfwHXBaim2mLnLYuemILWpsdkOcPxxKCfqyrKx8uSJdz7FJWEnmRo666E5ewO9OhGgz0yaqzRuTwVeinxTR9' +
      'RwRNyaxXMjgqXOQwIYbOElJea0uDFnTCuefERI48AlUmXxv5ho7O+DnB0DCSEI/MaFxOFJscvfXAiJZJOaDfidLSCCFIdtH3' +
      'RtdMIy8VpSJHv5Zo/BL8A1Qa5DH5sk+cdQaeVo5Dr4BAlGQD9TnEgq9sNC+87gTMOZ/aJnIIIocgcggihyByCCKHIIgcgsgh' +
      'iByCyCGIHILIIYgcgsghiByCyCEIIocgcggihyByCCKHIHIIIocgcggihyByCCKHXoEgcggihyByCCKHIHIIIocgcggihyBy' +
      'CCKHIIgcgsghiByCyCGIHILIIYgcQsHxf82dy3vgrHPWAAAAAElFTkSuQmCC'

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
