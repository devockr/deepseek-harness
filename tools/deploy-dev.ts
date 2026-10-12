#!/usr/bin/env node
// Recreate the deployment from the `:dev` image, the way this repo intends: the dev overlay is
// always merged in, compose never builds (`pnpm dev` does that, in that order), and the binds are
// pre-flighted so a mistake cannot take the deployment down. `--dry` stops after the pre-flight.
//
// `docker compose up -d` removes the old container before creating the new one, so anything that
// would make the create fail is worth catching first.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const dry = process.argv.includes('--dry')

const die = (message: string): never => {
  console.error(`deploy:dev: ${message}`)
  process.exit(1)
}

const run = (cmd: string, args: string[], extraEnv: Record<string, string> = {}): string =>
  execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...extraEnv } })

// docker is not on every PATH this runs under — a login shell here has node and pnpm but not
// /usr/local/bin — so resolve it: $DOCKER, then PATH, then the usual places.
let dockerBin: string | undefined
const docker = (args: string[], extraEnv?: Record<string, string>): string => {
  if (!dockerBin) {
    const candidates = [process.env.DOCKER, 'docker', '/usr/local/bin/docker', '/usr/bin/docker', '/opt/bin/docker'].filter(
      (candidate): candidate is string => Boolean(candidate),
    )
    dockerBin =
      candidates.find((candidate) => spawnSync(candidate, ['version'], { encoding: 'utf8' }).status === 0) ??
      candidates.find((candidate) => existsSync(candidate))
    if (!dockerBin) die('docker not found — put it on PATH, or set DOCKER=/path/to/docker')
  }
  return run(dockerBin, args, extraEnv)
}

// compose interpolates this with `:?`; an empty one produces a container that starts but cannot
// reach the model, which is worse than one that does not start.
if (!process.env.DEEPSEEK_API_KEY) die('DEEPSEEK_API_KEY is empty — it lives in a login shell; run this from one')

const files = ['docker-compose.yml', 'docker-compose.dev.yml']
for (const file of files) if (!existsSync(join(repo, file))) die(`${file} is missing next to tools/`)

const env = { UID: String(process.getuid?.() ?? ''), GID: String(process.getgid?.() ?? '') }
const compose = (args: string[]): string => docker(['compose', ...files.flatMap((file) => ['-f', file]), ...args], env)

// 1) What would be deployed, and to which image.
const image = /^\s*image:\s*(\S+)\s*$/m.exec(compose(['config']))?.[1] ?? 'deepseek-harness-dsh:dev'
console.log(`deploy:dev: image ${image}`)

// 2) Pre-flight: create a throwaway container with the running deployment's own binds. A bind that
//    cannot resolve fails here, where nothing is at stake.
let binds: string[] = []
try {
  binds = docker(['inspect', 'dsh', '--format', '{{range .HostConfig.Binds}}{{.}}\n{{end}}'])
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .flatMap((bind) => ['-v', bind])
} catch {
  console.log('deploy:dev: no running dsh container — skipping the bind pre-flight')
}
if (binds.length > 0) {
  const preflight = spawnSync(dockerBin as string, ['run', '--rm', ...binds, '--entrypoint', 'true', image], { encoding: 'utf8' })
  if (preflight.status !== 0) die(`bind pre-flight failed, nothing was touched:\n${(preflight.stderr ?? '').trim()}`)
  console.log('deploy:dev: bind pre-flight passed')
}

if (dry) {
  console.log('deploy:dev: --dry, stopping before the recreate')
  process.exit(0)
}

// 3) Recreate. `--no-build` plus the overlay's `pull_policy: never` means this either uses the
//    image `pnpm dev` built or fails saying so.
console.log('deploy:dev: recreating (--no-build)')
try {
  compose(['up', '-d', '--no-build'])
} catch (error) {
  const stderr = (error as { stderr?: string }).stderr ?? (error as Error).message
  die(`compose up failed:\n${stderr.trim()}`)
}

for (let attempt = 1; attempt <= 30; attempt++) {
  let ready = false
  try {
    ready =
      docker(['inspect', 'dsh', '--format', '{{.State.Running}}']).trim() === 'true' && docker(['logs', 'dsh']).includes('dsh web:')
  } catch {
    ready = false
  }
  if (ready) {
    console.log(`deploy:dev: up — ${docker(['inspect', 'dsh', '--format', '{{.Config.Image}}']).trim()}`)
    process.exit(0)
  }
  execFileSync('sleep', ['4'])
}

die('the new container did not report "dsh web:" within two minutes — check `docker logs dsh`')
