#!/usr/bin/env bash
# Run PinCheck in production without Docker.
#
#   DATABASE_URL=file:/var/lib/pincheck/pincheck.db ./scripts/run-production.sh
#
# Applies any pending migrations, then starts the Next.js production server.
# The database path must be on a persistent, writable filesystem with working
# file locks (see docs/DEPLOYMENT.md §11).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set, e.g. file:/var/lib/pincheck/pincheck.db}"

# Reject URLs with query params: better-sqlite3 ignores them and the app would
# silently read a different file than the one you configured.
case "$DATABASE_URL" in
  file:*) ;;
  *) echo "DATABASE_URL must start with 'file:' (got: $DATABASE_URL)" >&2; exit 1 ;;
esac
case "$DATABASE_URL" in
  *\?*) echo "DATABASE_URL must not contain a query string (got: $DATABASE_URL)" >&2; exit 1 ;;
esac

export NODE_ENV="${NODE_ENV:-production}"

npm run db:migrate
exec npm start