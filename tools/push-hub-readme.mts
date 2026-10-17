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
 * `--dry-run` prints what would be sent and touches nothing.
 */
import fs from 'node:fs/promises'

import { isXFetchError, xfetch } from 'x-fetch'

const NAMESPACE = 'devockr'
const REPOSITORY = 'idsh'
const SHORT = 'Dockerized DeepSeek Harness (dsh) web UI'
const API = `https://hub.docker.com/v2/repositories/${NAMESPACE}/${REPOSITORY}/`

const dryRun = process.argv.includes('--dry-run')

const fail = (message: string): never => {
  console.error(`push-hub-readme: ${message}`)
  process.exit(1)
}

/** `xfetch` throws on a non-2xx response, so the message has to carry what the API said. */
const describe = (error: unknown): string => {
  if (isXFetchError(error)) {
    const status = error.response?.status
    const data = error.data == null ? '' : ` ${JSON.stringify(error.data)}`
    return status === undefined ? error.message : `${String(status)}${data}`
  }
  return error instanceof Error ? error.message : String(error)
}

const readme = await fs.readFile('README.md', 'utf8')
const body = { short_description: SHORT, full_description: readme }

if (dryRun) {
  console.log(
    `push-hub-readme: would PATCH ${NAMESPACE}/${REPOSITORY} with ${String(readme.length)} characters of README and a ${String(SHORT.length)}-character short description`,
  )
  process.exit(0)
}

const username =
  process.env.DOCKERHUB_USERNAME ?? fail('DOCKERHUB_USERNAME is not set')
const token = process.env.DOCKERHUB_TOKEN ?? fail('DOCKERHUB_TOKEN is not set')

const login = await xfetch<{ token?: string }>(
  'https://hub.docker.com/v2/users/login/',
  {
    method: 'POST',
    body: { username, password: token },
  },
).catch((error: unknown) =>
  fail(`login failed (${describe(error)}) — the account or the token is wrong`),
)

if (!login.token) {
  fail('login answered without a token')
}

await xfetch(API, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${login.token}` },
  body,
}).catch((error: unknown) => fail(`PATCH failed (${describe(error)})`))

console.log(`push-hub-readme: ${NAMESPACE}/${REPOSITORY} updated`)
