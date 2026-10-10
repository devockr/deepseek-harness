#!/usr/bin/env node
/**
 * Boot a throwaway `dsh web` instance and drive it with a real browser.
 *
 * The point is to verify things that only a browser can show — a client plugin's
 * runtime effect, the settings surface a remote page gets, touch behaviour — without
 * touching the live profile or the live session. Everything lives in a disposable
 * $DSH_HOME; the browser itself lives under ~/.dsh/cache so a container rebuild does
 * not re-download it.
 *
 * Usage:
 *   node tools/ui-probe.mjs [--install <pnpm-spec>]... [--host <host>] [--keep] [--shot <name>]
 *
 * --install     add a package to the probe profile before booting (repeatable)
 * --host        the authority to browse, default 127.0.0.1; pass a LAN address to
 *               reproduce what a remote page sees
 * --keep        leave the probe instance and its $DSH_HOME behind for poking
 */

// Must be set before playwright resolves its browser path. The default is a bind
// mount, so the download survives `docker compose up -d --force-recreate`.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/home/app/.dsh/cache/ms-playwright'

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
/**
 * Every operand of a repeatable `name`, rejecting an absent one or a following flag: a silently
 * defaulted `--host` would probe the wrong origin, and an operand that looks like a flag is a typo.
 */
const values = (name) => {
  const found = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('-')) throw new Error(`${name} needs a value`)
    found.push(value)
    index += 1
  }
  return found
}
/** The loopback authority, however it is spelled — `localhost` is not a remote origin. */
const isLoopback = (host) =>
  host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')

const HOME = process.env.PROBE_HOME ?? '/tmp/dsh-ui-probe'
const SHOTS = process.env.PROBE_SHOTS ?? '/home/app/.dsh/cache/ui-probe'
const PROFILE = process.env.PROBE_PROFILE ?? 'probe'
const HOST = values('--host')[0] ?? '127.0.0.1'
const INSTALLS = values('--install')
const KEEP = flag('--keep')
const SHOT = values('--shot')[0] ?? 'probe'
const SCENARIO = values('--scenario')[0]
// PROBE_DSH points at another lib/bin.js — a pristine copy is what an unpatched deployment
// looks like; without it the probe drives the installed dsh.
const DSH = process.env.PROBE_DSH ?? 'dsh'
// The launcher wants --expose-internals, exactly as entrypoint.sh invokes it.
const dshArgv = (args) => (DSH.endsWith('.js') ? [process.execPath, ['--expose-internals', DSH, ...args]] : [DSH, args])

// The instance is ours to clean up whatever happens: a rejected boot, a thrown scenario or an
// early exit all land here, so nothing outlives the probe unless --keep asked for it.
let child
process.on('exit', () => {
  if (KEEP) return
  child?.kill('SIGTERM')
  rmSync(HOME, { recursive: true, force: true })
})

mkdirSync(SHOTS, { recursive: true })

const run = (args, opts = {}) =>
  spawnSync(...dshArgv(args), { encoding: 'utf8', env: { ...process.env, DSH_HOME: HOME }, ...opts })

/** The probe profile: created from the shipped web template, never the live one. */
function prepareProfile() {
  mkdirSync(HOME, { recursive: true })
  // Idempotent: a crashed earlier run leaves the profile behind, and recreating it is
  // an error rather than a no-op.
  if (!existsSync(join(HOME, 'profiles', PROFILE, 'package.json'))) {
    const created = run([PROFILE, '--from-default-profile', 'web', '--dump-config'])
    if (created.status !== 0) {
      throw new Error(`could not create the probe profile:\n${created.stdout ?? ''}${created.stderr ?? ''}`)
    }
  }
  for (const spec of INSTALLS) {
    const r = run(['plugin', '--profile', PROFILE, 'add', spec])
    process.stdout.write(`install ${spec}: ${r.status === 0 ? 'ok' : 'FAILED'}\n`)
    if (r.status !== 0) {
      // Booting anyway would probe a profile without the plugin the caller asked for, and still
      // exit 0 — fail here, where the message means something.
      throw new Error(`could not install ${spec}:\n${r.stdout ?? ''}${r.stderr ?? ''}`)
    }
  }
}

/**
 * Boot the instance, wait for the readiness line, return { url, token, child }.
 *
 * Browsing a non-loopback authority is what reproduces a remote page, and that needs
 * the server to bind one — `dsh web --host 0.0.0.0` is refused by design, so the bind
 * goes in as a patch overlay (the same way a deployment does it). The `!!js` port
 * fallback keeps `--port 0` working.
 */
function boot() {
  // Launcher options have to precede the app's: the launcher hands everything from
  // the first token it does not recognize to the app, so `--patch` must come before
  // `--port`.
  const args = ['--profile', PROFILE]
  if (!isLoopback(HOST)) {
    const patch = join(HOME, 'bind-all-interfaces.patch.yml')
    writeFileSync(
      patch,
      [
        '- id: webserver',
        "  name: '@deepseek-ai/dsh-host-webserver'",
        '  config:',
        "    host: '0.0.0.0'",
        '    port: !!js ctx.webStartup.port ?? 3080',
        '    compression: gzip',
        '    compressionLevel: 1',
        '    compressionThresholdBytes: 1024',
        '',
      ].join('\n'),
    )
    args.push('--patch', patch)
  }
  args.push('--port', '0', '--no-open')
  child = spawn(...dshArgv(args), {
    env: { ...process.env, DSH_HOME: HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`no readiness line in 60s:\n${out}`))
    }, 60_000)
    const onData = (chunk) => {
      out += chunk
      const m = /dsh web: (https?:\/\/[^\s]+)/.exec(out)
      if (!m) return
      clearTimeout(timer)
      child.stdout.off('data', onData)
      const url = new URL(isLoopback(HOST) ? m[1] : m[1].replace(/\/\/[^/:]+/, `//${HOST}`))
      resolve({ url: url.toString(), token: url.searchParams.get('token'), out })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (c) => (out += c))
    child.on('exit', (code) => reject(new Error(`dsh exited early (${code}):\n${out}`)))
  })
}

const { chromium } = await import('playwright')

prepareProfile()
const { url, token, out } = await boot()
process.stdout.write(`probe up: ${url.replace(token ?? '', '<token>')}\n`)

// Without a browser the useful half is still available: the served shell carries the
// composed boot graph, so the plugin rows and their bundle URLs can be checked
// directly. This is the mode to use where the container has no browser libraries.
if (flag('--no-browser')) {
  let failed = false
  const origin = new URL(url).origin
  // The token URL answers 303 and sets the session cookie; the redirect target then
  // needs that cookie. fetch follows redirects but keeps no cookie jar, so a plain
  // fetch(url) lands on the 401 page. Exchange it explicitly instead.
  const exchange = await fetch(url, { redirect: 'manual' })
  const cookie = (exchange.headers.getSetCookie?.() ?? [exchange.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
  if (exchange.status !== 303) failed = true
  process.stdout.write(`token       : ${exchange.status} → cookie ${cookie ? `${cookie.length} bytes` : 'NONE'}\n`)
  const res = await fetch(`${origin}/`, { headers: { cookie } })
  const html = await res.text()
  // The shell injects it as globalThis["__DSH_BOOT__"], with `<` and `&` escaped so a
  // plugin-controlled string cannot break out of the script element.
  const boot = /globalThis\["__DSH_BOOT__"\]\s*=\s*([\s\S]*?)\s*<\/script>/.exec(html)
  const graph = (boot?.[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  process.stdout.write(
    `shell       : ${res.status} ${res.headers.get('content-type') ?? ''} ${html.length} bytes\n`,
  )
  process.stdout.write(`boot graph  : ${boot ? `${graph.length} bytes` : 'NOT FOUND'}\n`)
  if (!boot) {
    failed = true
    const at = html.search(/__DSH_BOOT__/)
    process.stdout.write(
      at >= 0
        ? `  at ${at}: ${JSON.stringify(html.slice(Math.max(0, at - 60), at + 160))}\n`
        : `  no __DSH_BOOT__; head: ${JSON.stringify(html.slice(0, 200))}\n`,
    )
  }
  // remote-access is a server-side patch with no client half, so its absence from the boot graph
  // is by design and not an assertion; the two client plugins are.
  for (const wanted of ['privileged-ui', 'mobile', 'remote-access']) {
    const expected = wanted !== 'remote-access'
    const found = graph.includes(wanted)
    if (expected && !found) failed = true
    process.stdout.write(
      `contains ${wanted}: ${found ? 'yes' : 'NO'}${expected ? '' : ' (server half, not in the client graph)'}\n`,
    )
  }
  // URLs appear both escaped (inside the boot graph) and as plain script attributes.
  const urls = [
    ...new Set(
      [...html.matchAll(/["']((?:plugins|\/plugins)\/[^"']+client\.js[^"']*)["']/g)]
        .map((m) => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"')),
    ),
  ]
  process.stdout.write(`bundle urls : ${urls.length}\n`)
  for (const u of urls) {
    const target = u.startsWith('http') ? u : origin + (u.startsWith('/') ? '' : '/') + u
    const res = await fetch(target)
    if (res.status >= 400) failed = true
    process.stdout.write(`  ${res.status} ${res.headers.get('content-type') ?? ''} ${u}\n`)
  }
  if (!KEEP) {
    child.kill('SIGTERM')
    rmSync(HOME, { recursive: true, force: true })
  } else {
    process.stdout.write(`kept: ${HOME} (pid ${child.pid})\n`)
  }
  process.exit(failed ? 1 : 0)
}

const browser = await chromium.launch({
  headless: true,
  // Chromium honours http_proxy from the environment on Linux, which turns a probe
  // against a LAN address into a proxy request (502). Blank the variables for the
  // browser process and tell it not to use a proxy at all.
  env: { ...process.env, http_proxy: '', https_proxy: '', all_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
})
// A phone, when that is the point: `hasTouch` is what makes `(pointer: coarse)` match, which is
// the condition every touch behaviour here hangs off. `isMobile` is deliberately not set: in the
// headless shell that emulation path dies in Skia asking fontconfig for fonts the dev image does
// not carry, and the coarse pointer is what the plugins key off either way.
const PHONE = { hasTouch: true, viewport: { width: 390, height: 844 } }
const page = await browser.newPage(SCENARIO === 'mobile' ? PHONE : { viewport: { width: 1280, height: 900 } })
const problems = []
// Everything, not just errors: cordis reports an unmet `inject` as a warning the
// boot audit later summarizes as a bare "failed".
const console_all = []
page.on('console', (m) => {
  console_all.push(`[${m.type()}] ${m.text()}`)
  if (m.type() === 'error') problems.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
// Name the failing URL: a bare "502" in the console says nothing about who answered.
page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()} ${r.url()}`))
page.on('requestfailed', (r) => problems.push(`failed ${r.url()} — ${r.failure()?.errorText ?? ''}`))

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  // The shell renders before the mux socket finishes its token exchange; give it a
  // moment, then describe what we actually got instead of asserting a selector we
  // guessed.
  await page.waitForTimeout(4_000)

  // Scenarios exist because "the flag flipped" is not the same answer as "the
  // privileged surface behaves". Discovery first: click the entry and report the
  // controls, so the real assertions are written against the actual DOM.
  if (SCENARIO === 'discover-settings') {
    const clicked = await page.evaluate(() => {
      const all = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], li, span, div')]
      const el = all.reverse().find((e) => (e.textContent ?? '').trim() === 'Settings')
      if (!el) return false
      el.click()
      return true
    })
    await page.waitForTimeout(2_500)
    const controls = await page.evaluate(() =>
      [...document.querySelectorAll('button, [role="button"], [role="radio"], [role="tab"], [role="switch"], label')]
        .map((e) => ({ t: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), r: e.getAttribute('role') ?? e.tagName }))
        .filter((x) => x.t),
    )
    process.stdout.write(`clicked settings: ${clicked}\ncontrols:\n${controls.map((c) => `  ${c.r} — ${c.t}`).join('\n')}\n`)
    await page.screenshot({ path: join(SHOTS, `${SHOT}-settings.png`) })
  }

  // Does a settings change survive a reload? That is what "host" vs "memory"
  // persistence means to a user, and it is the half the flag decides.
  if (SCENARIO === 'settings-persistence') {
    const clickText = (text) =>
      page.evaluate((t) => {
        const all = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], li, span, div')].reverse()
        const el = all.find((e) => (e.textContent ?? '').trim() === t)
        if (!el) return false
        el.click()
        return true
      }, text)
    const themeState = () =>
      page.evaluate(() => ({
        cls: document.documentElement.className,
        theme: document.documentElement.getAttribute('data-theme'),
        scheme: getComputedStyle(document.documentElement).colorScheme,
        bg: getComputedStyle(document.body).backgroundColor,
        buttons: [...document.querySelectorAll('button')]
          .filter((b) => ['Light', 'Dark', 'System'].includes((b.textContent ?? '').trim()))
          .map((b) => `${(b.textContent ?? '').trim()}:${b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked') ?? b.className.slice(0, 24)}`),
      }))

    process.stdout.write(`open settings: ${await clickText('Settings')}\n`)
    await page.waitForTimeout(2_000)
    process.stdout.write(`before       : ${JSON.stringify(await themeState())}\n`)
    process.stdout.write(`click DARK   : ${await clickText('Dark')}\n`)
    await page.waitForTimeout(2_500)
    process.stdout.write(`after click  : ${JSON.stringify(await themeState())}\n`)
    await page.screenshot({ path: join(SHOTS, `${SHOT}-after-dark.png`) })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5_000)
    process.stdout.write(`after reload : ${JSON.stringify(await themeState())}\n`)
    await page.screenshot({ path: join(SHOTS, `${SHOT}-after-reload.png`) })
  }

  // Touch behaviours: coarse-pointer CSS, and Enter meaning "line break" rather than
  // "send". Both are asserted where they act — computed styles and dispatched events in
  // the real page — not by reading the plugin's own source back.
  if (SCENARIO === 'discover-composer') {
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('[contenteditable="true"], textarea, input')].map((el) => ({
        tag: el.tagName,
        inXterm: !!el.closest('.xterm'),
        attrs: [...el.attributes]
          .map((a) => `${a.name}=${JSON.stringify(a.value.slice(0, 70))}`)
          .join(' '),
      })),
    )
    process.stdout.write(`editables:\n${found.map((f) => `  ${JSON.stringify(f)}`).join('\n')}\n`)
  }

  if (SCENARIO === 'mobile') {
    const probe = await page.evaluate(() => {
      const input = document.createElement('input')
      document.body.append(input)
      const css = {
        touchAction: getComputedStyle(document.documentElement).touchAction,
        inputFontSize: getComputedStyle(input).fontSize,
      }
      input.remove()

      // A plain Enter inside an editable must arrive as a shifted one, and must not reach
      // the document in its original form: the recorder sits in the bubble phase, the
      // plugin's rewrite in the capture phase.
      const seen = []
      const record = (e) => seen.push(`${e.key}${e.shiftKey ? '+shift' : ''}`)
      document.addEventListener('keydown', record)
      const editable = document.createElement('div')
      editable.setAttribute('contenteditable', 'true')
      editable.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.append(editable)
      editable.focus()
      editable.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      )
      document.removeEventListener('keydown', record)
      editable.remove()

      // And the other way round: a plain input (the session search) keeps its own Enter.
      const inputSeen = []
      const recordInput = (e) => inputSeen.push(`${e.key}${e.shiftKey ? '+shift' : ''}`)
      document.addEventListener('keydown', recordInput)
      const search = document.createElement('input')
      search.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.append(search)
      search.focus()
      search.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      )
      document.removeEventListener('keydown', recordInput)
      search.remove()

      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        css,
        enterEvents: seen,
        inputEvents: inputSeen,
        composerEditables: document.querySelectorAll('[contenteditable="true"]').length,
        marker: document.body.dataset.idshMobile,
        appleTouchIcon: !!document.querySelector('link[rel="apple-touch-icon"]'),
      }
    })
    process.stdout.write(`mobile probe : ${JSON.stringify(probe)}\n`)
    await page.screenshot({ path: join(SHOTS, `${SHOT}-mobile.png`) })
  }

  const facts = await page.evaluate(() => ({
    title: document.title,
    bodyLength: document.body?.innerHTML.length ?? 0,
    // Plugins under test report through body.dataset (see packages/privileged-ui).
    dataset: { ...(document.body?.dataset ?? {}) },
    text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300),
  }))
  const shot = join(SHOTS, `${SHOT}.png`)
  await page.screenshot({ path: shot, fullPage: false })
  process.stdout.write(
    [
      `title       : ${facts.title}`,
      `body length : ${facts.bodyLength}`,
      `dataset     : ${JSON.stringify(facts.dataset)}`,
      `visible text: ${facts.text}`,
      `screenshot  : ${shot}`,
      `problems    : ${problems.length ? '\n  ' + problems.join('\n  ') : 'none'}`,
      `console log : ${console_all.length ? '\n  ' + console_all.slice(-25).join('\n  ') : 'none'}`,
    ].join('\n') + '\n',
  )
} finally {
  await browser.close()
  if (!KEEP) {
    child.kill('SIGTERM')
    rmSync(HOME, { recursive: true, force: true })
  } else {
    process.stdout.write(`kept: ${HOME} (pid ${child.pid})\n${out.slice(-400)}\n`)
  }
}
