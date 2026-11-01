# Development

Watch the app at **https://motus.local** while it is built. Saved changes show up live: the page hot-reloads
for the web app, and the server restarts by itself.

## Start and stop

```sh
docker compose -f docker-compose.dev.yml up -d      # start (installs packages first)
docker compose -f docker-compose.dev.yml logs -f    # watch logs
docker compose -f docker-compose.dev.yml down       # stop (the database is kept in the "motus_db" volume)
```

Without the proxy, the same app is at http://127.0.0.1:8790.

| Container | What it does |
|---|---|
| `motus-db-1` | PostgreSQL 16, on an internal-only network with no published port |
| `motus-server-1` | API server (`apps/server`), restarts when a file in `src/` changes |
| `motus-web` | Vite dev server (`apps/web`), hot reload; `/api` is forwarded to the server |
| `motus-install-1` | Installs packages on every `up`, then exits |

## One-time setup on this computer

1. **Name lookup** (needs sudo): `echo '127.0.0.1 motus.local' | sudo tee -a /etc/hosts`
2. **Live file updates:** `./scripts/dev-setup.sh` installs the `motus-dev-nudge` user service.
   - Docker Desktop shares files with its VM over virtiofs. A file saved by replacing it (most editors,
     Claude Code) stays stale inside the containers.
   - The service rewrites one byte in place after each replacement, which makes the change appear.
   - Check it: `systemctl --user status motus-dev-nudge`.
3. **HTTPS** goes through the shared Caddy proxy (container `caddy-proxy`; its folder is outside this repo),
   with a mkcert certificate `certs/motus.pem`. The Motus block it needs:

   ```
   https://motus.local {
   	tls /etc/caddy/certs/motus.pem /etc/caddy/certs/motus-key.pem
   	encode zstd gzip
   	reverse_proxy motus-web:5173
   }
   ```

## Rules for touching the shared proxy (other sites depend on it)

- The Caddyfile is bind-mounted **as a single file**. Edit it **in place**, e.g. append with `>>`.
  Never use `sed -i` or an editor that saves by replacing the file: the container keeps the old copy, and
  the next restart can break every site.
- Back it up first, then **validate**, then **reload**. Never restart or recreate the proxy container:
  ```sh
  docker exec caddy-proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  docker exec caddy-proxy caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile
  ```
  A reload with a broken config is refused, and the old config keeps running.
- Afterwards, check every site behind the proxy still answers, motus.local included.
- Motus only joins the external `proxy` network. It never publishes ports 80 or 443.
