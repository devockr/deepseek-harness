#!/usr/bin/env node
// Recreate the deployment from the `:dev` image, the way this repo intends: the dev overlay is
// always merged in, compose never builds (`pnpm dev` does that, in that order), and the binds are
// pre-flighted so a mistake cannot take the deployment down. `--dry` stops after the pre-flight.
//
// `docker compose up -d` removes the old container before creating the new one, so anything that
// would make the create fail is worth catching first.
//
// This one runs from a checkout on the host, where the root package.json makes `.ts` ESM. Tools
// the image ships and runs itself keep the `.mts` extension: /opt/dsh/tools has no package.json,
// so a `.ts` there would be CommonJS.
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dry = process.argv.includes('--dry')

const die = (message: string): never => {
  console.error(`deploy:dev: ${message}`)
  process.exit(1)
}

const run = async (cmd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<string> => {
  const { stdout } = await execFileAsync(cmd, args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...extraEnv } })
  return stdout
}

const stderrOf = (error: unknown): string =>
  ((error as { stderr?: string }).stderr ?? (error as Error).message ?? String(error)).trim()

// docker is not on every PATH this runs under — a login shell here has node and pnpm but not
// /usr/local/bin — so resolve it: $DOCKER, then PATH, then the usual places.
let dockerBin: string | undefined
const docker = async (args: string[], extraEnv?: Record<string, string>): Promise<string> => {
  if (!dockerBin) {
    const candidates = [process.env.DOCKER, 'docker', '/usr/local/bin/docker', '/usr/bin/docker', '/opt/bin/docker'].filter(
      (candidate): candidate is string => Boolean(candidate),
    )
    for (const candidate of candidates) {
      try {
        await run(candidate, ['version'])
        dockerBin = candidate
        break
      } catch {
        // not this one
      }
    }
    if (!dockerBin) {
      for (const candidate of candidates) {
        try {
          await access(candidate, constants.X_OK)
          dockerBin = candidate
          break
        } catch {
          // not this one either
        }
      }
    }
    if (!dockerBin) {
      die('docker not found — run this on the host with docker on PATH, or set DOCKER=/path/to/docker')
    }
  }
  return run(dockerBin, args, extraEnv)
}

// compose interpolates this with `:?`; an empty one produces a container that starts but cannot
// reach the model, which is worse than one that does not start.
if (!process.env.DEEPSEEK_API_KEY) {
  die('DEEPSEEK_API_KEY is empty — it lives in a login shell; run this from one')
}

const files = ['docker-compose.yml', 'docker-compose.dev.yml']
for (const file of files) {
  try {
    await access(path.join(repo, file))
  } catch {
    die(`${file} is missing next to tools/`)
  }
}

const env = { UID: String(process.getuid?.() ?? ''), GID: String(process.getgid?.() ?? '') }
const compose = (args: string[]): Promise<string> => docker(['compose', ...files.flatMap((file) => ['-f', file]), ...args], env)

// 1) What will be deployed, and to which image — read from the resolved config, so this is the
//    deployment about to be created rather than the one that is running now.
type Mount = { type?: string; source?: string; target?: string; read_only?: boolean }
type Resolved = { services?: Record<string, { image?: string; volumes?: Mount[] }> }
const resolved = JSON.parse(await compose(['config', '--format', 'json'])) as Resolved
const service = resolved.services?.dsh ?? {}
const image = service.image ?? 'deepseek-harness-dsh:dev'
console.log(`deploy:dev: image ${image}`)

// 2) Pre-flight: create a throwaway container with exactly the mounts the config declares. A bind
//    source that does not resolve fails here, where nothing is at stake — `compose up` would fail
//    the same way *after* removing the old container, which is what makes this worth doing.
// Bind mounts only. A host path that does not resolve is the failure this pre-flight exists for:
// `compose up` would hit it after removing the old container. A named volume cannot fail that way,
// and its key here is the top-level short name rather than the project-scoped volume, so passing
// it would make docker create a stray volume that `--rm` leaves behind (it removes anonymous ones).
const binds = (service.volumes ?? [])
  .filter((mount) => mount.type === 'bind' && mount.source && mount.target)
  // --mount, not -v: it states the bind explicitly, so a path is never taken for a named volume,
  // and a missing source is always rejected — older dockers and Docker Desktop create it for -v.
  // This daemon rejects both; the point is that only --mount says so everywhere.
  .flatMap((mount) => [
    '--mount',
    `type=bind,source=${mount.source},target=${mount.target}${mount.read_only ? ',readonly' : ''}`,
  ])
if (binds.length === 0) {
  console.log('deploy:dev: the service declares no mounts — nothing to pre-flight')
} else {
  try {
    await docker(['run', '--rm', ...binds, '--entrypoint', 'true', image])
  } catch (error) {
    die(`bind pre-flight failed, nothing was touched:\n${stderrOf(error)}`)
  }
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
  await compose(['up', '-d', '--no-build'])
} catch (error) {
  die(`compose up failed:\n${stderrOf(error)}`)
}

for (let attempt = 1; attempt <= 30; attempt++) {
  let ready = false
  try {
    ready =
      (await docker(['inspect', 'dsh', '--format', '{{.State.Running}}'])).trim() === 'true' &&
      (await docker(['logs', 'dsh'])).includes('dsh web:')
  } catch {
    ready = false
  }
  if (ready) {
    console.log(`deploy:dev: up — ${(await docker(['inspect', 'dsh', '--format', '{{.Config.Image}}'])).trim()}`)
    process.exit(0)
  }
  await sleep(4000)
}

die('the new container did not report "dsh web:" within two minutes — check `docker logs dsh`')
