# deepseek-harness

Dockerized [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web UI.

## Requirements

- Docker with BuildKit + Docker Compose v2
- A DeepSeek API key

## Getting started

1. Provide the API key (export it, or drop it in a `.env` in this directory):

   ```sh
   export DEEPSEEK_API_KEY=sk-...
   ```

2. Build and start:

   ```sh
   docker compose up -d --build
   ```

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

Environment variables (see `docker-compose.yml`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key — the highest-priority credential source | — |
| `DSH_TRUSTED_HOSTS` | Space-separated host authorities allowed by dsh's browser-trust fence | `dsh.example.com` |
| `http_proxy` / `https_proxy` / `all_proxy` / `no_proxy` | Outbound proxy for dsh's HTTP requests | — |

Ports and volumes:

- `15080:3080` — host port `15080` → dsh's internal web server (`3080`).
- `./.dsh` → `/home/app/.dsh` — dsh state and credentials (persist).
- `..` → `/home/app/Workspaces` — your workspace directory.
- `~/.dotfiles` → `/home/app/.dotfiles` — dotfiles.

## Notes

- **Sandbox** — dsh's file sandbox needs user namespaces or Landlock. On hosts without them (e.g. Synology's 4.4 kernel), either set `DSH_PERMISSION_MODE=danger-full-access`, or approve the `danger-full-access` escalation when prompted in the UI.
- **Settings page is loopback-only** — the Models/settings page only loads from `localhost`. Reach it via an SSH tunnel (`ssh -L 3080:localhost:3080 <host>`) for full functionality.
- **HTTPS reverse proxy** — if you front this with nginx, keep the `Host` header intact (`proxy_set_header Host $http_host;`) so the browser-trust fence passes, and add WebSocket upgrade headers.
