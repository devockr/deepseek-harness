#!/usr/bin/env node
/**
 * The companion half of entrypoint.sh, for a profile that already exists: it keeps the packages the
 * image baked in the state that image declares. A package the profile does not have, declares
 * without files, or has at a lower version is put in place as the image itself installed it — a
 * link when the image linked (that is how the dev image gives a checkout whose edits show up
 * immediately), files otherwise, always from the image, so no boot downloads anything. A package at
 * the image's version or above is left alone: that is where a pinned version or a fork lives.
 * Nothing is ever removed, a bundle entry is only written for a package that was not installed at
 * all (so a disabled one stays disabled), files are staged and swapped in so a failed copy leaves
 * the installed package working, and the caller fixes ownership afterwards.
 */
import { cp, lstat, mkdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface Manifest {
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[] } }
}

interface Package {
  version?: string
  main?: string
  exports?: Record<string, unknown>
}

const exists = async (path: string) => (await stat(path).catch(() => undefined)) !== undefined

const packageOf = async (dir: string) =>
  (await import(path.join(dir, 'package.json'), { with: { type: 'json' } }).catch(() => undefined))
    ?.default as Package | undefined

/**
 * The files dsh itself loads: the host half (`main`, or the `.` export standing in for it) and the
 * browser half (`./client`). Nothing else is checked. An unused export subpath pointing at a file
 * the package never shipped would otherwise look like a broken package — and the repair for that
 * replaces an operator's customized copy with the image's, which is a fine thing to do for a package
 * that cannot load and a bad thing to do for one that can. A wildcard target is a pattern rather
 * than a file, so it is skipped as well — and so is a condition object this cannot read (an
 * `import`/`require` pair with no `default`, say): leaving a package alone is always safer than
 * replacing it on a guess about which target the loader would have picked.
 */
const entriesOf = (manifest: Package | undefined): string[] => {
  const pick = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
      return value
    }
    return value && typeof value === 'object'
      ? pick((value as Record<string, unknown>).default)
      : undefined
  }
  const exports = (manifest?.exports ?? {}) as Record<string, unknown>
  return [manifest?.main, pick(exports['.']), pick(exports['./client'])].filter(
    (entry): entry is string => typeof entry === 'string' && !entry.includes('*'),
  )
}

/** The numeric parts only, which is what these packages use; an unreadable one compares equal. */
const compare = (a: string | undefined, b: string | undefined) => {
  if (!a || !b) {
    return 0
  }
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

/**
 * Puts whatever `write` leaves at the staging path in place of `target`, so the installed thing
 * keeps working until its replacement is complete and a failure leaves it exactly as it was.
 * Renaming is what makes the swap atomic — writing in place truncates first, sync or async alike.
 */
const atomicReplace = async (target: string, write: (staging: string) => Promise<void>) => {
  const staging = `${target}.sync`
  const parked = `${target}.old`
  await rm(staging, { recursive: true, force: true })
  try {
    await write(staging)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }

  // A directory cannot be renamed onto, so the old one is parked next to the target first and only
  // dropped once the swap succeeded — and put back if it did not, so the installed thing is never
  // left absent for the next boot to trip over. `lstat`, because a dangling link is an entry that
  // has to be moved out of the way: renaming a directory onto it fails instead.
  const had = (await lstat(target).catch(() => undefined)) !== undefined
  await rm(parked, { recursive: true, force: true })
  if (had) {
    await rename(target, parked)
  }
  try {
    await rename(staging, target)
  } catch (error) {
    if (had) {
      await rename(parked, target).catch(() => undefined)
    }
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  await rm(parked, { recursive: true, force: true })
}

const baked = '/opt/dsh/home/.dsh/profiles/web'
const home = process.env.HOME

if (!home) {
  console.error('sync-companions: HOME is not set')
  process.exit(1)
}

const live = path.join(home, '.dsh/profiles/web')
const liveManifest = path.join(live, 'package.json')
const liveModule = await import(liveManifest, { with: { type: 'json' } }).catch(() => undefined)

if (liveModule) {
  const bakedManifest = (await import(path.join(baked, 'package.json'), { with: { type: 'json' } }))
    .default as Manifest
  const manifest = liveModule.default as Manifest
  const { dependencies } = manifest
  const { bundles } = manifest.dsh.profile
  const wasInstalled = new Set(Object.keys(dependencies))
  let changed = false

  for (const [name, spec] of Object.entries(bakedManifest.dependencies)) {
    const target = path.join(live, 'node_modules', name)
    const present = await exists(target)
    const installedManifest = present ? await packageOf(target) : undefined
    const installed = installedManifest?.version
    const wanted = (await packageOf(path.join(baked, 'node_modules', name)))?.version
    // A directory dsh cannot read a manifest from is no more usable than a missing one — and the
    // version comparison alone would call it equal and leave it there.
    const absent = (
      await Promise.all(
        entriesOf(installedManifest).map(async (entry) =>
          (await exists(path.resolve(target, entry))) ? undefined : entry,
        ),
      )
    ).filter((entry) => entry !== undefined)
    // A manifest whose own entry files are absent compiles to nothing dsh can load — which is what
    // a checkout mounted over the packages directory looks like before its build has run.
    const unusable =
      !present || (installed === undefined && wanted !== undefined) || absent.length > 0

    // `file:` is the one spec whose string cannot show that its files changed, so it is refreshed
    // whenever it is seen; everything else is only replaced when it is unusable or behind.
    if (!wasInstalled.has(name) || unusable || compare(installed, wanted) < 0 || spec.startsWith('file:')) {
      if (absent.length > 0) {
        console.error(
          `sync-companions: ${name} has no ${absent.join(', ')} — installing the image's copy`,
        )
      }
      // Both sides can be pnpm links — the destination into the live profile's store, the source
      // into the image's — so a link is recreated and files are dereferenced. The scope directory
      // may not exist yet on either path.
      await mkdir(path.dirname(target), { recursive: true })
      await atomicReplace(target, (staging) =>
        spec.startsWith('link:')
          ? // A link spec is written relative to the manifest that carries it, so it has to be read
            // from there — the link itself lives in the live profile's node_modules.
            symlink(path.resolve(baked, spec.slice('link:'.length)), staging)
          : cp(path.join(baked, 'node_modules', name), staging, { recursive: true, dereference: true }),
      )
      dependencies[name] = spec
      // Only a package that was not installed at all gets its bundle entry: one that is installed
      // but absent from the list was disabled on purpose and stays that way.
      if (!wasInstalled.has(name) && !bundles.includes(name)) {
        bundles.push(name)
      }
      changed = true
    }
  }

  if (changed) {
    await atomicReplace(liveManifest, (staging) =>
      writeFile(staging, `${JSON.stringify(manifest, null, 2)}\n`),
    )
  }
}
