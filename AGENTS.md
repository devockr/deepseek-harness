# AGENTS.md

The parts of this repository that are easy to get wrong. `README.md` covers what it is and how to
deploy it.

**This file is public**: no hostnames, addresses, ports, ssh commands, registry mirrors, no
reference to a file that exists on one machine only. Those go in untracked local notes — the
tracked `.gitignore` already ignores `.tasks/`.

## Invariants

- **Compose goes through a login shell.** `${UID:?…}`/`${GID:?…}` and the proxy/API-key variables
  only exist there; a bare `sh` dies with `required variable UID is missing a value`. Otherwise
  pass them: `env UID="$(id -u)" GID="$(id -g)" docker compose …`.
- **No patching dsh.** The `sed` block that rewrote `isLoopbackHostname`, the touch CSS, the
  favicon and the composer's Enter key is gone; that behaviour comes from `packages/`. If the UI
  must behave differently, write a plugin.
- **Two images, two purposes — one base.** `Dockerfile`'s `base` target is dsh + pnpm; its final
  stage is the published image: that base plus a profile baked from the registry, installed by name
  and *strictly* — a release that cannot ship its own plugins is not a release, so the build fails
  while one is unpublished. `Dockerfile.dev` is built from the same `base` target, never from the
  published image, so it does not depend on anything being published; it adds the headless shell's
  libraries, and bakes the same profile from this checkout's `packages/` as a `link:` — that is how a
  deployment that mounts a checkout over `/opt/dsh/packages` runs that source and sees edits
  immediately. A test or development convenience never goes into `Dockerfile`; the published image
  *should* fail to launch a browser.
- **The image bakes the profile; the entrypoint keeps it to that.** A deployment with no profile gets
  the baked one, exactly as built — that is what keeps a restart free of downloads. An existing
  profile keeps the packages the image declares in the state it declares, compared by the version in
  each package's *own* `package.json`: one that is missing, declares without files, or sits below the
  image's version is put in place the way the image installed it — a `link:` when the image linked
  (how `Dockerfile.dev` gives a deployment that mounts a checkout over `/opt/dsh/packages` source
  whose edits show up immediately), files otherwise, and `file:` specs refreshed on every boot
  because their string cannot show that their files changed. One at that version or above is left
  alone, which is where a pin or a fork lives. Nothing is ever removed, and turning a package off
  means dropping it from `dsh.profile.bundles`, never uninstalling it. Nothing names a package in the
  entrypoint.
- **Script in Node, not Python.** The images carry node 24 — which runs `.ts`/`.mts` directly, no
  flag needed — and no Python: whatever a check or a helper needs, it can do in Node.
- **Alpine is blocked, not abandoned.** `node-addon-require-builtin` ships `linux-*-gnu` prebuilds
  only, so a musl base dies at boot; revisit when upstream ships one, and keep musl-compatible
  choices in `entrypoint.sh` until then.
- **The state directory is runtime state**, bind-mounted and gitignored — not a place for scripts,
  and neither is the image. Local helpers go in `.tasks/` (also gitignored); verification helpers
  stay on the machine that runs them.
- **Machine specifics never get committed.** The real compose file is gitignored; the template is
  `docker-compose.example.yml`.
- **Each image has its own ignore file**: `.dockerignore` for `Dockerfile` (which copies only
  `entrypoint.sh`), `Dockerfile.dev.dockerignore` for the dev image (`packages/`, plus the
  Dockerfile itself, which BuildKit reads from the context). Neither build carries the other's
  content, and a new `COPY` has to be whitelisted in the right one or the build fails loudly.
- **The `@deepseek-ai/dsh@…`/`pnpm@…` pins and the plugins baked into the images** are read by the
  custom managers in `renovate.json`: the first parses the `npm install -g` RUN line to its end, the
  second the `dsh plugin add` lines. Keep both readable by those regexes — on one line, and with
  the versions still in them.

## Images

| tag | contents | used by |
|---|---|---|
| `deepseek-harness-dsh:base` | dsh + pnpm, nothing baked, no browser libraries | the two images below |
| `deepseek-harness-dsh:latest` | `:base` + a profile baked from the registry (strict) | the deployment |
| `deepseek-harness-dsh:dev` | `:base` + those libraries; the profile baked from `packages/` | local runs and browser-driven checks |

Build the base first, then the dev image: `docker build --target base -t deepseek-harness-dsh:base .`
and `docker build -f Dockerfile.dev -t deepseek-harness-dsh:dev .`. `docker compose build` is the
published image on its own — the one build that needs the plugins published.

A cached layer once left a browser-dependency set inside `:latest` that the Dockerfile no longer
declared. After an apt change, check the image instead of trusting the build; `--no-cache` when in
doubt.

## Deploying

Rebuilding the container is how `entrypoint.sh`, the `Dockerfile` or the profile's bundle list
takes effect. It also kills whatever is running inside it — including an agent session (sessions
live in the state directory, so the conversation survives, the process does not).

- Start it **on the host, detached** (`setsid sh -c '…' >/dev/null 2>&1 < /dev/null &`): a restart
  dies with the connection that asked for it. The command itself, with the host and the paths,
  lives in the local deployment notes. A deployment may wrap it in a local script that warms the
  image layers and logs what it did — read the log, don't assume.
- Until the plugins are published the published image cannot be built at all, so local runs use
  `:dev` (built from `:base`, plugins from `packages/`) — which is also what "dogfood the source"
  means here.
- A restart is enough when only the *profile* changed: it re-runs the entrypoint and re-resolves
  bundles. **Hot reload does not re-resolve bundles.**
- A detached command needs `docker` on `PATH` (or an absolute path) and stderr not discarded: a
  missing binary looks exactly like a successful restart.
- `docker run <image> <cmd>` may hand `<cmd>` to the entrypoint as arguments. Use `--entrypoint`,
  `--user <uid>:<gid>`, absolute paths, and the flags that borrow a running container's
  volumes/network when a check has to reach the live server.

## Verifying

Observe the running thing; do not reason from source.

- Client plugins write markers into `document.body.dataset` (`idshPrivileged`, `idshMobile`).
- **A loopback origin is privileged by definition** — to show that a plugin flipped the gate, load
  the page over a non-loopback address.
- Take the **newest** boot token (an older one answers 401). Logs accumulate across restarts: use
  timestamps before reading anything into a count.
- Browser-driven checks run in `:dev`, not in the published image.
- For A/B work that must not touch a live deployment, boot a throwaway state directory with its
  own profile instead of the deployment's, and point the launcher at a different dsh build when
  you need one.
- `dsh --profile <name> --dump-config` prints `# == <bundle>, patched by <package>` — that is how
  to prove which layer supplies a value.

## Packages under `packages/`

- Layout: `src/index.ts` for the host half and, when there is a browser half, `src/client.ts`
  — a plain script with no imports, because dsh serves exactly one file per package —
  compiled by `tsc` into `lib/`, which is what `main`/`exports`/`files` name and what ships;
  `cordis.patch.yml`, `README.md`; npm scope `@idsh`.
- **`lib/` is build output**: gitignored, produced by `pnpm --recursive build` — the dev image
  runs that after COPYing `packages/`, and without it a `link:` target has nothing to load.
- A patch **replaces the row's whole `config`** — restate every key that should survive.
- Patch YAML takes `#` comments only; `//` fails validation and the install rolls back.
- `link:` dogfoods from source; `file:` copies.
- An image's plugin set is the `dsh plugin add` line its Dockerfile bakes with: registry versions in
  `Dockerfile`, `link:` copies from `packages/` in `Dockerfile.dev`. The second custom manager in
  `renovate.json` keeps those versions current.
- No `dependencies`/`peerDependencies` on purpose: a declared peer makes pnpm's
  `autoInstallPeers` pull `@deepseek-ai/dsh-*` into the profile.
- New workspace package → `pnpm install --force`, and drop `node_modules/.pnpm/lock.yaml` plus
  `.pnpm-workspace-state-v1.json` if the importer is skipped.

## Pull requests

- Target `main`; a stacked PR uses the branch below as its base, and GitHub retargets it on merge.
- Fetch before pushing; never force-push a branch you did not author.
