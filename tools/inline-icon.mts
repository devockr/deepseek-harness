#!/usr/bin/env node
// Puts a package's icon into its built browser half, replacing the placeholder after tsc.
//
// It has to be inlined: dsh serves a plugin's client half through a bundle endpoint
// (`plugins/??<pkg>/client.js,…&rev=…`), and nothing under the package is reachable by URL —
// measured on a deployment where the control (`/favicon.svg`) answers 200 while every
// `/plugins/…` path, including the package's own files, answers 404. There is also no PNG on the
// app's own origin to point at. So the image travels inside the one file the browser does get.
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
