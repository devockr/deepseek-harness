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

const NAMESPACE = 'devockr'
const REPOSITORY = 'idsh'
const SHORT = 'Dockerized DeepSeek Harness (dsh) web UI'

const dryRun = process.argv.includes('--dry-run')

const fail = (message: string): never => {
  console.error(`push-hub-readme: ${message}`)
  process.exit(1)
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

const login = await fetch('https://hub.docker.com/v2/users/login/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: token }),
})

if (!login.ok) {
  fail(
    `login answered ${String(login.status)} — the account or the token is wrong`,
  )
}

const { token: jwt } = (await login.json()) as { token?: string }
if (!jwt) {
  fail('login answered without a token')
}

const patch = await fetch(
  `https://hub.docker.com/v2/repositories/${NAMESPACE}/${REPOSITORY}/`,
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  },
)

if (!patch.ok) {
  fail(`PATCH answered ${String(patch.status)}: ${await patch.text()}`)
}

console.log(`push-hub-readme: ${NAMESPACE}/${REPOSITORY} updated`)
