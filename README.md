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

3. Grab the one-time token from the logs:

   ```sh
   docker compose logs dsh
   # dsh web: http://127.0.0.1:3080/?token=...
   ```

4. Open it in your browser (note the host port is `15080`):

   ```
   http://<host>:15080/?token=<token>
   ```

The token rotates on every restart.

## Configuration

Environment variables (see `docker-compose.example.yml`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key — the highest-priority credential source | — |
| `PUID` / `PGID` | uid/gid dsh runs as (and owns bind-mounted files as); compose forwards the host's `$UID`/`$GID` | `$UID` / `$GID` |
| `DSH_TRUSTED_HOSTS` | Space-separated host authorities allowed by dsh's browser-trust fence | `dsh.example.com` |
| `http_proxy` / `https_proxy` / `all_proxy` / `no_proxy` | Outbound proxy for dsh's HTTP requests | — |

Ports and volumes:

- `15080:3080` — host port `15080` → dsh's internal web server (`3080`).
- `./.dsh` → `/home/app/.dsh` — dsh state and credentials (persist).
- `..` → `/home/app/Workspaces` — your workspace directory.
- `~/.dotfiles` → `/home/app/.dotfiles` — dotfiles.

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
- **Settings page** — dsh gates the Models/settings page behind a client-side loopback check. The `Dockerfile` patches that check in the installed bundle, so the page loads over the LAN and settings persist durably (no SSH tunnel needed).
- **Enter on a phone** — stock dsh sends on Enter, which leaves touch devices with no way to insert a newline (no Shift key). The `Dockerfile` patches the composer so Enter inserts a newline there and the send button sends, matching the app. Known iOS quirk: the blinking caret mark can stay on the previous line after a newline until the composer scrolls; the insertion point itself is correct, so typed text lands on the new line.
- **Plugins** — the image installs pnpm (which `dsh plugin` drives), so plugins can be added from the web UI's plugin manager or the CLI, e.g. `docker exec -u app -e HOME=/home/app dsh dsh plugin --profile web add <pkg>` (HOME has to be passed along). Plugins live in the `.dsh` bind mount, so they survive recreations but are not part of the image.
- **HTTPS reverse proxy** — if you front this with nginx, keep the `Host` header intact (`proxy_set_header Host $http_host;`) so the browser-trust fence passes, and add WebSocket upgrade headers.
