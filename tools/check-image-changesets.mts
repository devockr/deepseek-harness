#!/usr/bin/env node
/**
 * A changeset that changes what the image bakes has to move the image's version, because
 * `release.yml` publishes the image from that version and from nothing else. Without this check a
 * plugin release whose changeset forgot `@idsh/image` would publish packages and quietly ship no
 * image at all: the version would not move, so the job that waits for it would not run.
 *
 * The pending changesets are simply the ones in the tree — a release consumes them, so `main` has
 * none and a pull request carries the ones it adds.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** A manifest's package name, which is all this check reads from one. */
const nameOf = async (file: string): Promise<string | undefined> => {
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as {
    name?: string
  }
  return manifest.name
}

const fail = (message: string): never => {
  console.error(`check-image-changesets: ${message}`)
  process.exit(1)
}

const image =
  (await nameOf(path.join(repo, 'image/package.json'))) ??
  fail('image/package.json has no name')

/** The packages the published image bakes: every workspace package under `packages/`. */
const baked = new Set<string>()
for (const entry of await fs.readdir(path.join(repo, 'packages'), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) {
    continue
  }
  const name = await nameOf(
    path.join(repo, 'packages', entry.name, 'package.json'),
  )
  if (name) {
    baked.add(name)
  }
}

/** The package names a changeset names, from the front matter between its `---` lines. */
const namedIn = (source: string): string[] => {
  const [, front = ''] = /^---\n([\s\S]*?)\n---/.exec(source) ?? []
  const names: string[] = []
  for (const line of front.split('\n')) {
    const match = /^"(?<name>[^"]+)": (?:major|minor|patch)$/u.exec(line.trim())
    const name = match?.groups?.name
    if (name) {
      names.push(name)
    }
  }
  return names
}

const entries = await fs.readdir(path.join(repo, '.changeset'))
const changesets = entries.filter(
  file => file.endsWith('.md') && file !== 'README.md',
)

const forgotten: string[] = []
for (const file of changesets) {
  const names = namedIn(
    await fs.readFile(path.join(repo, '.changeset', file), 'utf8'),
  )
  const bakedHere = names.filter(name => baked.has(name))
  if (bakedHere.length > 0 && !names.includes(image)) {
    forgotten.push(`  .changeset/${file} (${bakedHere.join(', ')})`)
  }
}

if (forgotten.length > 0) {
  fail(
    [
      `these changesets change what the image bakes without naming ${image}:`,
      ...forgotten,
      '',
      `Add \`"${image}": patch\` to each. \`release.yml\` publishes the image from that version`,
      'alone, so without the bump the image is never rebuilt.',
    ].join('\n'),
  )
}

console.log(
  `check-image-changesets: ${changesets.length} pending changeset(s), each that changes the image bumps it`,
)
