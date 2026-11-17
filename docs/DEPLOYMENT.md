# Deploying PinCheck

PinCheck is a Next.js server that stores saved circuits in a SQLite database.
This document describes the supported self-hosting path: a Node.js process
with a persistent directory for the database. Docker is one convenient way to
run it — see [§13 Non-Docker alternatives](#13-non-docker-alternatives) for
options that do not require Docker.

> **Short version:** install Node.js 22+, run `npm run db:migrate` and
> `npm run db:seed` against a `DATABASE_URL` on a persistent disk, then
> `npm start`. For the packaged path, `docker compose up -d --build`.

---

## 1. What gets deployed

- A single Node.js 22 container running the production Next.js server
  (`next start`), listening on port `3000`.
- A named Docker volume mounted at `/data` that holds `pincheck.db` and its
  SQLite sidecar files (`-wal`, `-shm`).
- Prisma migrations from `prisma/migrations` are baked into the image and
  applied by the entrypoint on every container start.
- The process runs as an unprivileged user (`UID/GID 1001`); no root process
  is needed at runtime.

The image does **not** use Next.js standalone output. `next start` with the
regular `.next` directory is used, so no changes to `next.config.ts` are
required.

---

## 2. Prerequisites

- Docker Engine 24+ with the Compose v2 plugin (`docker compose version`).
- Roughly 1 GB of RAM for the image build. `better-sqlite3` compiles a native
  addon during the build, so the build stage installs `python3`, `make`, and
  `g++`. These tools are not present in the runtime image.
- A host directory for backups (recommended).

---

## 3. Quick start

```bash
# 1. Optional: enable AI prompt interpretation for this shell.
export OPENAI_API_KEY="sk-..."        # PowerShell: $env:OPENAI_API_KEY="sk-..."

# 2. Build and start.
docker compose up -d --build

# 3. Wait for the health check to pass.
docker compose ps
```

Open <http://localhost:3000>. On first start the entrypoint creates
`/data/pincheck.db`, applies the initial migration, and then starts the app.

Compose also reads a `.env` file in this directory for variable substitution
(`${OPENAI_API_KEY}`, etc.). Do not commit it — `.gitignore` already excludes
`.env*` except `.env.example`.

Useful first checks:

```bash
curl -fsS http://localhost:3000/api/circuits
docker compose logs --tail=100 pincheck
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q pincheck)"
```

---

## 4. Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:/data/pincheck.db` | Must be a `file:` URL; absolute is strongly recommended. Relative paths are resolved against `/app` (not `/data`), so they will not survive rebuilds and are usually not writable. Query parameters are rejected by the entrypoint. |
| `PORT` | `3000` | Internal listen port. Change it together with the Compose port mapping. |
| `OPENAI_API_KEY` | unset | Optional. Enables AI prompt interpretation. Server-side only. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Optional. Compose supplies the default explicitly. |
| `GEMINI_API_KEY` | unset | Optional fallback when no OpenAI key is configured. |
| `NEXT_PUBLIC_SITE_URL` | unset | Canonical origin for Open Graph share URLs (`/c/[id]`). Falls back to the request's `Host` header. Set it to `https://pincheck.example` for a real domain, and remember that `NEXT_PUBLIC_*` values are inlined at **build** time. |

AI keys are injected at runtime by Compose. They are not copied into the image
and they are never sent to the browser.

To change settings, edit `docker-compose.yml` or export variables before
`docker compose up -d`. Then recreate the container:

```bash
docker compose up -d --force-recreate
```

---

## 5. Persistence and the `/data` volume

`docker-compose.yml` declares the named volume `pincheck-data` and mounts it at
`/data`. Everything written there survives:

- container restarts,
- `docker compose down`,
- image rebuilds and upgrades.

It is deleted only by `docker compose down -v` or an explicit
`docker volume rm`.

Inspect the volume name (Compose prefixes it with the project name, usually the
directory name):

```bash
docker compose config --volumes
docker volume ls | grep pincheck
docker volume inspect pincheck_pincheck-data   # name may differ
```

### Bind mount instead of a named volume

If you prefer a visible host directory, replace the volume in
`docker-compose.yml`:

```yaml
    volumes:
      - ./data:/data
```

Then fix ownership so the unprivileged container user can write. **On Linux:**

```bash
mkdir -p data
sudo chown -R 1001:1001 data
```

On Docker Desktop for Windows/macOS, ownership is virtualized and usually works
without this step, but the container still runs as UID 1001.

> Do not copy or restore the database while the app is running. A file copy of
> a live SQLite database can capture a half-written WAL and produce a corrupt
> backup.

---

## 6. Backup and restore

### 6.1 Backup (consistent, service stopped)

```bash
docker compose stop pincheck

mkdir -p backups
docker compose cp pincheck:/data "./backups/pincheck-$(date +%Y%m%d-%H%M%S)"

docker compose start pincheck
```

The destination directory contains `pincheck.db` and, if present, the
`-wal`/`-shm` files. A clean stop normally checkpoints and removes the WAL.

Verify the copy:

```bash
ls -lh backups/pincheck-*/
```

If the container no longer exists (for example after `docker compose down`),
recreate it without starting it first:

```bash
docker compose create pincheck
docker compose cp pincheck:/data ./backups/pincheck-manual
```

If your Compose version refuses to copy from a stopped container, use the
container ID directly: `docker cp <container>:/data ./backups/pincheck-manual`.

### 6.2 Restore

Stop the app, clear the old database plus stale WAL files, copy the backup, and
fix ownership. Running a one-off container as root is the most reliable way to
do this:

```bash
docker compose stop pincheck || true

docker compose run --rm --no-deps --user root \
  -v "$PWD/backups/pincheck-<stamp>:/backup:ro" \
  --entrypoint sh pincheck \
  -c 'rm -f /data/pincheck.db /data/pincheck.db-wal /data/pincheck.db-shm \
      && cp /backup/pincheck.db /data/pincheck.db \
      && chown 1001:1001 /data/pincheck.db \
      && ls -l /data'

docker compose up -d pincheck
```

If the backup directory contains a non-empty `pincheck.db-wal`, copy it too
(`cp /backup/pincheck.db-wal /data/`) and `chown` it the same way.

The entrypoint re-runs `prisma migrate deploy` on start, so a backup taken from
an older release is migrated forward automatically.

### 6.3 Alternative: online backup with the sqlite3 CLI

If you use a bind mount (`./data:/data`) and have `sqlite3` installed on the
host, SQLite's backup API produces a consistent snapshot even while the app is
running:

```bash
sqlite3 ./data/pincheck.db ".backup './backups/pincheck-$(date +%Y%m%d-%H%M%S).db'"
```

The Docker image itself does not include the `sqlite3` binary.

---

## 7. Migrations and seeding

### 7.1 Migrations run automatically on start

`scripts/docker-entrypoint.sh` runs the equivalent of:

```bash
npx prisma migrate deploy
```

against the container's `DATABASE_URL` before starting Next.js. The entrypoint
generates a temporary Prisma config that targets `DATABASE_URL`, so the
checked-in `prisma.config.ts` (which points at a development database) cannot
silently redirect migrations.

- Migrations are idempotent: already-applied migrations are skipped.
- Migration files come from the image, not from the volume.
- If a migration fails, the entrypoint exits non-zero and the container does
  not start. With `restart: unless-stopped`, Docker retries with backoff; check
  `docker compose logs pincheck`.
- There is no automatic down-migration. To roll back a release that changed the
  schema, restore the backup from before the upgrade.

Take a backup before every upgrade.

### 7.2 Seeding is optional and never automatic

The app works without demo data. The entrypoint deliberately **does not** run
`prisma/seed.ts`, because seeding rewrites the three demo presets and deletes
rows that can no longer be parsed. It does not wipe valid user circuits, but it
is still better left as an explicit action.

If you want the demo presets, seed **before** the first production start. Use
the `builder` build stage: it contains the dev dependency `tsx` and `src/`,
which the slim runtime image intentionally does not ship.

```bash
# Make sure the container (and the named volume) exists, then stop the app.
docker compose create pincheck
docker compose stop pincheck

docker build --target builder -t pincheck-seed .

VOLUME_NAME="$(docker volume ls -q --filter name=pincheck-data | head -n 1)"
docker run --rm -v "$VOLUME_NAME":/data \
  -e DATABASE_URL=file:/data/pincheck.db \
  pincheck-seed \
  sh -c 'sh scripts/docker-entrypoint.sh migrate \
         && ./node_modules/.bin/tsx prisma/seed.ts \
         && chown -R 1001:1001 /data'

docker compose start pincheck
```

The final `chown` matters: the seed container runs as root, while the runtime
container runs as UID/GID 1001 and must be able to write the database.

With the bind-mount variant, replace the volume mount with
`-v "$PWD/data:/data"` and fix the host ownership afterwards
(`sudo chown -R 1001:1001 data` on Linux).

---

## 8. Reverse proxy and TLS

Run TLS at a reverse proxy in front of PinCheck. The container serves plain
HTTP on port 3000.

1. Bind the published port to loopback only when the proxy runs on the same
   host:

   ```yaml
   ports:
     - "127.0.0.1:3000:3000"
   ```

   Or remove `ports` entirely and attach the container to a private proxy
   network.

2. **Caddy** (automatic certificates):

   ```caddyfile
   pincheck.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

3. **nginx** (abbreviated):

   ```nginx
   server {
     listen 443 ssl http2;
     server_name pincheck.example.com;

     ssl_certificate     /etc/letsencrypt/live/pincheck.example.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/pincheck.example.com/privkey.pem;

     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       # Next.js App Router streams responses; disable proxy buffering.
       proxy_buffering off;
     }
   }
   ```

Notes:

- Do not expose `/data` or the SQLite file through the web server.
- The app sets no special `trust proxy` configuration; the proxy should set the
  standard `Host` and `X-Forwarded-*` headers above.
- If you run the proxy in another container, use a shared Docker network and
  `proxy_pass http://pincheck:3000;` instead of a host port.

---

## 9. Health, logs, and operations

```bash
# Container and health status
docker compose ps
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q pincheck)"

# Follow logs (migrations and Next.js output)
docker compose logs -f --tail=200 pincheck

# Inspect the database directory
docker compose exec pincheck sh -c 'ls -lah /data'

# Restart without rebuilding
docker compose restart pincheck

# Stop and start
docker compose stop pincheck
docker compose start pincheck
```

The health check calls `GET /api/circuits`, which performs a database read. A
container is reported healthy only when both the Next.js server and SQLite are
working.

---

## 10. Upgrade procedure

```bash
# 1. Back up first.
docker compose stop pincheck
mkdir -p backups
docker compose cp pincheck:/data "./backups/pre-upgrade-$(date +%Y%m%d-%H%M%S)"
docker compose start pincheck

# 2. Keep the current image for rollback.
docker tag pincheck:local pincheck:previous

# 3. Rebuild and recreate.
docker compose build --pull
docker compose up -d

# 4. Verify.
docker compose ps
docker compose logs --tail=100 pincheck
curl -fsS http://localhost:3000/api/circuits > /dev/null && echo OK
```

Rollback:

```bash
docker tag pincheck:previous pincheck:local
docker compose up -d --force-recreate
```

If the failed release applied a schema migration, restoring the pre-upgrade
backup is the safe rollback path; Prisma migrations are forward-only.

---

## 11. Where to run it (and where not to)

SQLite needs a **persistent, writable, local filesystem with working file
locks**, and PinCheck should run as a **single instance** (one process writing
the database).

| Platform | Suitable? | Notes |
| --- | --- | --- |
| VPS with Docker (Hetzner, DigitalOcean, EC2, …) | Yes | Recommended. Persistent disk, one container, reverse proxy for TLS. |
| Home server / NAS with Docker | Yes | Use a local volume, not a network share. |
| Fly.io with a volume | Yes, one machine | Attach a volume at `/data`; keep the app at one instance. |
| Railway / Render with a persistent disk | Yes, one instance | Mount the disk at `/data`; disable horizontal scaling. |
| Kubernetes with a PVC | Yes, `ReadWriteOnce` | Use a local/block-backed StorageClass and `replicas: 1`. Do not use a `ReadWriteMany` NFS volume for SQLite. |
| Docker Swarm | Yes, one replica | Pin the service to one node with a local volume. |
| **Vercel / Netlify / Cloudflare / AWS Lambda** | **No** | See below. |
| AWS ECS on Fargate | **No** | No persistent local disk. EFS is a network filesystem and is not safe for SQLite locking. |

### Why serverless does not work here

Platforms like Vercel give each invocation an ephemeral filesystem. Only `/tmp`
is writable and it is not shared or durable. The repository's default
`file:./dev.db` would be lost on every deploy or cold start, and the app writes
to SQLite at runtime (`POST /api/circuits`). Running `prisma migrate deploy`
against an ephemeral path also means the schema disappears with the instance.
SQLite additionally relies on POSIX file locking, which network/serverless
filesystems do not provide reliably.

This is a storage-architecture limitation, not a Docker-specific one. Deploy
PinCheck to a host with a persistent disk, or change the data layer.

### Managed Postgres is out of scope

Moving to Postgres would require changing the Prisma datasource provider in
`prisma/schema.prisma`, replacing `@prisma/adapter-better-sqlite3` with a
Postgres adapter, regenerating migrations (SQLite migration SQL is not portable
to Postgres), and provisioning a database. That is a separate application
change and is not covered by this deployment path.

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `database directory '/data' is not writable` | Bind mount owned by the host user | `sudo chown -R 1001:1001 ./data` (Linux), or switch back to the named volume. |
| `unable to open database file` | Same permission issue, or a `DATABASE_URL` outside `/data` | Check `docker compose exec pincheck env \| grep DATABASE_URL` and `/data` permissions. |
| `database is locked` | More than one container/replica using the same SQLite file, or a network filesystem | Run exactly one instance; keep the DB on local block storage. |
| Container is `unhealthy` but the page loads | `GET /api/circuits` is failing (database error) | `docker compose logs pincheck`; verify migrations and `/data`. |
| Migration fails on startup | New migration is incompatible with existing data | Restore the pre-upgrade backup, fix the migration, redeploy. |
| Build fails in `better-sqlite3` | Missing toolchain or unusual CPU architecture | The `deps` stage installs `python3 make g++`; on ARM64/other platforms the build can take several minutes. |
| `Error: Cannot find module '.next/...'` | Image was built without the `npm run build` stage or `.next` was excluded | Rebuild without a stale local `.next` (it is in `.dockerignore`). |
| Changes to code do not appear | Old image/container | `docker compose build --no-cache && docker compose up -d --force-recreate`. |

---

## 13. Non-Docker alternatives

Docker is the documented path, but PinCheck is a plain Node.js process and runs
equally well without it. The only hard requirement is a **persistent, writable
local filesystem with working file locks** for SQLite (see §11).

### 13.1 Bare-metal / VPS (no container)

```bash
# 1. Install Node.js 22+ (see .nvmrc: 22.12.0).
# 2. Clone and install.
git clone https://github.com/peter14l/pincheck.git && cd pincheck
npm ci

# 3. Point DATABASE_URL at a persistent path, then migrate and seed.
export DATABASE_URL=/var/lib/pincheck/pincheck.db
npm run db:migrate
npm run db:seed

# 4. Serve. Behind a reverse proxy, set NEXT_PUBLIC_SITE_URL.
npm run build
npm start
```

`scripts/docker-entrypoint.sh` does two things for the Docker image: validate
`DATABASE_URL` and run `prisma migrate deploy` before `next start`. The
equivalent commands are `npm run db:migrate` and `npm start`.

### 13.2 systemd service (Linux)

`scripts/pincheck.service` can be dropped into `/etc/systemd/system/`:

```ini
[Unit]
Description=PinCheck
After=network.target

[Service]
Type=simple
User=pincheck
WorkingDirectory=/opt/pincheck
Environment=NODE_ENV=production
Environment=DATABASE_URL=file:/var/lib/pincheck/pincheck.db
Environment=NEXT_PUBLIC_SITE_URL=https://pincheck.example
ExecStartPre=/opt/pincheck/node_modules/.bin/prisma migrate deploy
ExecStart=/opt/pincheck/node_modules/.bin/next start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now pincheck`. Backups are still your
responsibility (§6).

### 13.3 Fly.io, Railway, Render (managed, one instance)

These platforms run the app directly and offer an attached persistent disk:

| Platform | How |
| --- | --- |
| Fly.io | `fly launch`, then `fly volumes create --size 1 /data` and `flyctl volumes attach`. One machine only. |
| Railway | Add a `Volume` service, mount it, set `DATABASE_URL=file:/data/pincheck.db`, disable horizontal scaling. |
| Render | Create a Web Service with a Persistent Disk at `/data`, same env vars. |

The `Dockerfile` still works on all three if you prefer the container path.

### 13.4 PM2 / process managers

```bash
npm install -g pm2
npm run build
pm2 start "next start" --name pincheck --env DATABASE_URL=/var/lib/pincheck/pincheck.db
```

Run `prisma migrate deploy` separately before the first start and after every
deployment that ships a new migration.

---

## 14. Known limitations

- **Single writer.** SQLite allows one writer at a time. Run one container (or
  one replica) per database file. `database is locked` errors usually mean a
  second process is writing.
- **Next.js output cache is container-local.** Static assets and the Next.js
  cache live in the image/container, not on `/data`. That is fine for a single
  instance. Multi-instance deployments would need a shared cache handler, which
  this setup does not provide.
- **Build-time prerendering.** The app uses Cache Components. Pages that read
  SQLite (currently `/` and `/gallery`) can be prerendered into the image at
  build time, and the build uses an empty throwaway database. The API and the
  shared `/c/[id]` pages always read the live `/data` database. If the gallery
  appears frozen at the state of the build, that route needs request-time
  rendering (`await connection()` or equivalent) in the application code; the
  Docker path cannot change that from the outside.
- **No built-in TLS.** Terminate TLS at a reverse proxy (section 8).
- **Backups are your responsibility.** The volume protects against container
  replacement, not against host loss or accidental deletion.
