# syntax=docker/dockerfile:1
#
# PinCheck production image.
#
# SQLite lives on a persistent volume at /data (see docker-compose.yml and
# docs/DEPLOYMENT.md). The runtime image runs as an unprivileged user and the
# entrypoint applies Prisma migrations before `next start`.
#
# Next.js standalone output is intentionally not used: next.config.ts is left
# untouched and the app is served with the regular `next start` server.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies (full install, including dev deps needed by `next build`)
# ---------------------------------------------------------------------------
FROM base AS deps

# better-sqlite3 may need to compile its native addon when no prebuilt binary
# matches the platform. Keep the toolchain in this stage only.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy the Prisma schema before npm ci so @prisma/client's postinstall can
# generate a client instead of warning about a missing schema.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time only database. It is used by the migration step below and by any
# data read that Next.js performs while prerendering. It never ships in the
# runtime image.
ENV DATABASE_URL=file:/tmp/pincheck-build.db

RUN ./node_modules/.bin/prisma generate

# Apply migrations to the throwaway build database so build-time reads see a
# valid (empty) schema instead of a hard failure. Production data is untouched.
RUN sh scripts/docker-entrypoint.sh migrate

RUN npm run build && rm -rf .next/cache

# ---------------------------------------------------------------------------
# Production dependencies
# ---------------------------------------------------------------------------
FROM base AS prod-deps

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Drop dev dependencies, then regenerate the client so node_modules/.prisma is
# definitely present and matches the schema in this stage.
RUN npm prune --omit=dev \
    && ./node_modules/.bin/prisma generate \
    && npm cache clean --force

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/pincheck.db \
    NEXT_TELEMETRY_DISABLED=1

# Run as an unprivileged user (UID/GID 1001). Named volumes inherit this
# ownership on first mount; bind mounts need an explicit chown, see the docs.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs \
    && mkdir -p /data \
    && chown -R nextjs:nodejs /data

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs package.json ./package.json
COPY --chown=nextjs:nodejs next.config.ts ./next.config.ts
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod 0555 ./scripts/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

VOLUME ["/data"]

# Uses Node's built-in fetch, so no curl/wget is required in the runtime image.
# /api/circuits touches the database, so an unhealthy database fails the check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/circuits', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Invoked through /bin/sh so the image does not depend on the file's mode bit
# surviving a Windows checkout. The Dockerfile chmods it as well.
ENTRYPOINT ["/bin/sh", "/app/scripts/docker-entrypoint.sh"]
