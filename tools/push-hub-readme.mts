#!/usr/bin/env node
/**
 * Push the repository README to Docker Hub.
 *
 * The Hub's Overview is not read from the image: the OCI labels fill the sidebar, and the page
 * itself only changes through the API. That is one page per repository — every tag shares it — so
 * there is nothing per-version to keep in sync here.
 *
 * Authentication is a two-step: the v2 API wants the short-lived JWT that `/v2/users/login/` hands
 * back for the account and its access token, not the token itself. The repository lives in the
 * `devockr` namespace, which is not necessarily the account in DOCKERHUB_USERNAME.
 *
 * Plain `fetch` on purpose: this runs in the image job, which checks out the repository and installs
 * nothing, so a dependency here would fail the release before the build. The error handling below is
 * the part a wrapper would have given, written out.
 *
 * `--dry-run` prints what would be sent and touches nothing.
 */
import fs from 'node:fs/promises'

const NAMESPACE = 'devockr'
const REPOSITORY = 'idsh'
const SHORT = 'Dockerized DeepSeek Harness (dsh) web UI'
const API = `https://hub.docker.com/v2/repositories/${NAMESPACE}/${REPOSITORY}/`
// fetch has no timeout of its own; without one a hung request holds the release job open.
const TIMEOUT_MS = 30_000

const dryRun = process.argv.includes('--dry-run')

const fail = (message: string): never => {
  console.error(`push-hub-readme: ${message}`)
  process.exit(1)
}

/**
 * Which account the JWT the login handed back belongs to, and what it is allowed to do. The account
 * matters as much as the scopes: the secret in CI is not necessarily the token that was tried
 * locally, and "no scopes" says nothing about which one answered.
 */
const claimsOf = (jwt: string): string => {
  const [, payload = ''] = jwt.split('.')
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as {
      access?: Array<{ type?: string; actions?: string[] }>
      username?: string
    }
    const actions = (claims.access ?? []).flatMap(entry => entry.actions ?? [])
    const scopes = actions.length === 0 ? 'no scopes' : actions.join(', ')
    return `user ${claims.username ?? '(unnamed)'}, scopes ${scopes}`
  } catch {
    return 'unreadable token'
  }
}

/**
 * One request, and the message carries the status and whatever the API said when it is not a 2xx —
 * which is the whole of what a fetch wrapper would have bought here.
 */
const call = async (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown },
): Promise<unknown> => {
  const response = await fetch(url, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `${init.method} ${url} answered ${String(response.status)} ${text}`,
    )
  }
  return text === '' ? undefined : JSON.parse(text)
}

const readme = await fs.readFile('README.md', 'utf8')
// The repository object calls the sidebar line `description`; `short_description` is accepted and ignored.
const body = { description: SHORT, full_description: readme }

if (dryRun) {
  console.log(
    `push-hub-readme: would PATCH ${NAMESPACE}/${REPOSITORY} with ${String(readme.length)} characters of README and a ${String(SHORT.length)}-character description`,
  )
  process.exit(0)
}

const username =
  process.env.DOCKERHUB_USERNAME ?? fail('DOCKERHUB_USERNAME is not set')
const token = process.env.DOCKERHUB_TOKEN ?? fail('DOCKERHUB_TOKEN is not set')

const login = (await call('https://hub.docker.com/v2/users/login/', {
  method: 'POST',
  body: { username, password: token },
}).catch((error: unknown) =>
  fail(
    `login failed (${error instanceof Error ? error.message : String(error)}) — the account or the token is wrong`,
  ),
)) as { token?: string } | undefined
const jwt = login?.token ?? fail('login answered without a token')

await call(API, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${jwt}` },
  body,
}).catch((error: unknown) => {
  // The token authenticates and still cannot write. Measured against two tokens for the same account:
  // the one that could PATCH carried Read, Write *and Delete* plus "Allow Cloud Sandboxes access";
  // the one that got this 403 carried Read and Write only. The message names the account and both
  // permissions, because that difference is the whole difference.
  if (error instanceof Error && error.message.includes('insufficient scope')) {
    fail(
      `the token authenticated but cannot write (${claimsOf(jwt)}) — Docker Hub grants metadata writes to access tokens with Read, Write and Delete plus "Allow Cloud Sandboxes access"; one without them authenticates but is refused here`,
    )
  }
  throw error
})

console.log(`push-hub-readme: ${NAMESPACE}/${REPOSITORY} updated`)
