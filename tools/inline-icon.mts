#!/usr/bin/env node
// Puts a package's icon into its built browser half. dsh serves exactly one file per package, so
// the image has to travel inside the bundle — but not in the source: the PNG lives in `assets/`,
// and this replaces the placeholder after `tsc` has run.
//
//   node tools/inline-icon.mts packages/mobile
import fs from 'node:fs/promises'
import path from 'node:path'

const PLACEHOLDER = '__IDSH_ICON_PNG__'
const dir = process.argv[2] ?? '.'
const asset = path.join(dir, 'assets', 'apple-touch-icon.png')
const bundle = path.join(dir, 'lib', 'client.js')

const source = await fs.readFile(bundle, 'utf8').catch(() => '')
if (!source.includes(PLACEHOLDER)) {
  console.log(`inline-icon: no placeholder in ${bundle} — nothing to do`)
  process.exit(0)
}

const base64 = (await fs.readFile(asset)).toString('base64')
await fs.writeFile(bundle, source.replaceAll(PLACEHOLDER, base64))
console.log(`inline-icon: ${path.relative(process.cwd(), bundle)} ← ${(base64.length / 1024).toFixed(1)}KB base64`)
