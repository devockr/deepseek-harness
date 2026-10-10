# deepseek-harness

Dockerized [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web UI.

## Requirements

- Docker with BuildKit + Docker Compose v2
- A DeepSeek API key

## Getting started

1. Provide the API key and host uid/gid (export them, or drop them in a `.env`
   in this directory):

   ```sh
   export DEEPSEEK_API_KEY=sk-...
   export UID GID
   ```

   `.env` is gitignored, so it is safe to keep in the working directory.

2. Create your compose file from the template and build:

   ```sh
   cp docker-compose.example.yml docker-compose.yml
   docker compose up -d --build
   ```

   `docker-compose.yml` itself is gitignored: it is the copy that carries your
   own hostnames, LAN addresses and proxy settings, which do not belong in a
   published repository.

   The template mounts only dsh's own state; add what you want (see Ports and volumes).

3. Grab the one-time token from the logs:

   ```sh
   docker compose logs dsh
   # dsh web: http://127.0.0.1:3080/?token=...
   ```

4. Open it in your browser (note the host port is `15080`):

   ```
   http://<host>:15080/?token=<token>
   ```

The image bakes [`@idsh/remote-access`](packages/remote-access/) into a fresh profile, which binds
the server to every interface — that is what makes the published port work at all, since a listener
on `127.0.0.1` *inside* the container cannot receive a connection forwarded to its address. It also
means every LAN address reaches the UI once the port is published; read that package's security notes
first. To keep the server on loopback instead, **disable** the package — the UI's Plugins page, or
dropping it from `dsh.profile.bundles` — rather than uninstalling it, since a package the image
declares is put back on the next start; or patch the host back to `127.0.0.1`.
Either way, reach dsh through the container's own network namespace (`docker exec`, or
`docker run --network container:dsh`), because a published port will no longer carry it.

The token rotates on every restart.

## Configuration

Environment variables (see `docker-compose.example.yml`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key — the highest-priority credential source | — |
| `PUID` / `PGID` | uid/gid dsh runs as (and owns bind-mounted files as); compose forwards the host's `$UID`/`$GID` | `$UID` / `$GID` |
| `NPM_REGISTRY` | npm/pnpm/yarn registry: the image build and the user-level configs use it | `https://registry.npmmirror.com/` |
| `DSH_TRUSTED_HOSTS` | Space-separated host authorities allowed by dsh's browser-trust fence | `dsh.example.com` |
| `http_proxy` / `https_proxy` / `all_proxy` / `no_proxy` | Outbound proxy for dsh's HTTP requests | — |

At boot the registry is written into `~/.npmrc`, `~/.yarnrc` and `~/.yarnrc.yml` (corepack
and node-gyp mirrors follow), not into the environment — so a project that pins its own
registry still wins. `NPM_CONFIG_REGISTRY` and `YARN_NPM_REGISTRY_SERVER` are therefore
**not read**; drop them from old compose files. Variables with no default are passed through
by name, so an unset one stays unset rather than becoming empty.

Ports and volumes:

- `15080:3080` — host port `15080` → dsh's internal web server (`3080`).
- `./.dsh` → `/home/app/.dsh` — dsh state and credentials (persist). This is the
  template's only mount.
- Add the rest yourself, for example `./workspace:/home/app/Workspaces` for a
  workspace or `./ssh:/home/app/.ssh` for an ssh config. The template deliberately
  prescribes none.

## Notes

- **Runs as your host user** — the container starts as root, re-points its `app`
  account to `PUID`/`PGID`, fixes ownership of the home skeleton (leaving bind
  mounts alone), then drops privileges with `setpriv`. Files in the mounts are
  owned by you, not a container uid.
- **One-off commands** — `docker exec` lands as root; use `docker exec -u app …`
  for a shell as the working user, or `docker exec dsh dsh …` for arbitrary dsh
  invocations. Extra `docker run <image> <args>` are appended after dsh's web
  flags, so they can't override `--profile web`.
- **Sandbox** — dsh's file sandbox needs user namespaces or Landlock. On hosts without them (e.g. Synology's 4.4 kernel), either set `DSH_PERMISSION_MODE=danger-full-access`, or approve the `danger-full-access` escalation when prompted in the UI.
- **Plugins** — the image bakes a profile when it is built: dsh's own `web` template plus its companion packages — [`@idsh/remote-access`](packages/remote-access/), [`@idsh/privileged-ui`](packages/privileged-ui/) (the settings page over the LAN, which the image used to `sed` into dsh) and [`@idsh/mobile`](packages/mobile/) (the touch CSS, Enter as a line break, and the home-screen icon) — installed from npm by name (the dev image, what we run locally, bakes this checkout's `packages/` as `link:`s instead). A deployment without a profile starts from that one; an existing profile keeps those packages at the version the image declares — compared by each package's own `package.json` — putting back anything missing, broken or below it, exactly as the image installed it (a link in the dev image, where a checkout mounted at `/opt/dsh/packages` is then edited live; files otherwise). Anything at that version or above is left alone, which is where a pinned version or a fork lives, and a package is turned off by dropping it from the bundle list (the UI's Plugins page), not by uninstalling it. Plugins live in the `.dsh` mount and survive recreations.
- **UI probe** — `node tools/ui-probe.mjs` boots a throwaway instance in an isolated `$DSH_HOME` and drives it with a real browser, so a client plugin's runtime behaviour can be checked without touching the live profile. It needs the `:dev` image, which is the one carrying the browser libraries; `--no-browser` skips the browser and checks the served boot graph instead.
- **Remote exposure** — [`@idsh/remote-access`](packages/remote-access/) binds the UI to every interface, which also puts every LAN address into dsh's browser-trust fence. Put TLS and auth (or a VPN) in front unless that network is trusted; see that package's README.
- **HTTPS reverse proxy** — if you front this with nginx, keep the `Host` header intact (`proxy_set_header Host $http_host;`) so the browser-trust fence passes, and add WebSocket upgrade headers.
