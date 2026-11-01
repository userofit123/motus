# Self-hosting Motus

Motus runs as two containers: PostgreSQL and the Motus app (API, web app and exercise photos in one image).

## Start

```sh
mkdir motus && cd motus
curl -O https://raw.githubusercontent.com/userofit123/motus/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/userofit123/motus/main/.env.example
# edit .env: set DB_PASSWORD to a long random password
docker compose up -d
```

Motus listens on `127.0.0.1:8790`. Open it through a reverse proxy with HTTPS (Caddy example below).
The first account you create becomes the admin.

```
motus.example.com {
	reverse_proxy 127.0.0.1:8790
}
```

## Accounts

- Settings → Server admin: add people, reset passwords, disable or remove accounts, choose who can sign up
  (only the admin, people with an invite link, or anyone).
- Every person's data is kept apart by the database itself (row-level security). Admins cannot see anyone's workouts.

## Updates

- By hand: `docker compose pull && docker compose up -d`
- Automatically: `docker compose -f docker-compose.yml -f docker-compose.autoupdate.yml up -d` (Watchtower, daily at 04:00).
- Pin a version with `MOTUS_VERSION=0.1.0` in `.env`.

## Backups

- Each person makes their own backups in Settings → Backup & restore (to their device).
- For the whole server, back up the `db` and `appdata` volumes, e.g.
  `docker compose exec db pg_dump -U motus motus | gzip > motus-$(date +%F).sql.gz`.

## Without Docker

Node 22 and pnpm: `pnpm install`, `pnpm --filter @motus/web exec vite build`, then
`DATABASE_URL=postgres://… WEB_DIR=apps/web/dist node --import tsx apps/server/src/index.ts`.
Without `DATABASE_URL` the server keeps its data in `DATA_DIR` with PGlite (fine for one person).
