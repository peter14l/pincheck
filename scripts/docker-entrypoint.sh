#!/bin/sh
# PinCheck container entrypoint.
#
# Responsibilities:
#   1. Validate the SQLite DATABASE_URL and make sure its directory exists.
#   2. Apply Prisma migrations with `prisma migrate deploy`.
#   3. exec `next start` so the Node process is PID 1 and receives SIGTERM.
#
# Usage:
#   docker-entrypoint.sh          # migrate, then start the app
#   docker-entrypoint.sh migrate  # migrate only (also used by the image build)
#
# POSIX sh only: this script must run under /bin/sh (dash on Debian).

set -eu

APP_DIR="${APP_DIR:-/app}"
PRISMA_SCHEMA="${PRISMA_SCHEMA:-$APP_DIR/prisma/schema.prisma}"
PRISMA_BIN="$APP_DIR/node_modules/.bin/prisma"

# Default matches the Dockerfile and docker-compose.yml. An absolute file: URL
# is required so the database always lands on the persistent /data volume.
DATABASE_URL="${DATABASE_URL:-file:/data/pincheck.db}"
export DATABASE_URL

log() {
    printf '[entrypoint] %s\n' "$*"
}

fail() {
    printf '[entrypoint] ERROR: %s\n' "$*" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# Validate the database URL
# ---------------------------------------------------------------------------
case "$DATABASE_URL" in
    file:*) ;;
    *)
        fail "DATABASE_URL must be a SQLite URL starting with file: (got '$DATABASE_URL'). This image does not bundle a Postgres/MySQL driver."
        ;;
esac

case "$DATABASE_URL" in
    *\?*)
        fail "DATABASE_URL must not contain query parameters; better-sqlite3 treats them as part of the filename."
        ;;
esac

DB_PATH="${DATABASE_URL#file:}"
[ -n "$DB_PATH" ] || fail "DATABASE_URL has no file path: '$DATABASE_URL'"

# Resolve a relative path against APP_DIR and export the normalized URL, so the
# generated Prisma config, the Prisma CLI, and the Next.js runtime always open
# exactly the same file. The container default is already absolute (/data).
case "$DB_PATH" in
    /* | [A-Za-z]:[\\/]*) ;;
    *) DB_PATH="$APP_DIR/${DB_PATH#./}" ;;
esac
DATABASE_URL="file:$DB_PATH"
export DATABASE_URL

DB_DIR=$(dirname "$DB_PATH")
mkdir -p "$DB_DIR" 2>/dev/null || fail "cannot create database directory '$DB_DIR'. If you use a bind mount, chown it to UID/GID 1001 (see docs/DEPLOYMENT.md)."
[ -w "$DB_DIR" ] || fail "database directory '$DB_DIR' is not writable by UID $(id -u). If you use a bind mount, chown it to UID/GID 1001 (see docs/DEPLOYMENT.md)."

[ -x "$PRISMA_BIN" ] || fail "Prisma CLI not found at '$PRISMA_BIN'. The production image must include the prisma package."
[ -f "$PRISMA_SCHEMA" ] || fail "Prisma schema not found at '$PRISMA_SCHEMA'."

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
migrate() {
    # The checked-in prisma.config.ts is owned by the application and may point
    # at a development database, so migrations use a tiny generated config that
    # reads the runtime DATABASE_URL. The file lives outside /app, which keeps
    # the image filesystem read-only-friendly and avoids writing into /data.
    CONFIG_FILE="${TMPDIR:-/tmp}/pincheck-prisma.config.mjs"

    cat > "$CONFIG_FILE" <<EOF
export default {
  schema: "$PRISMA_SCHEMA",
  datasource: { url: process.env.DATABASE_URL },
};
EOF

    log "Applying pending Prisma migrations to $DATABASE_URL"
    if ! (cd "$APP_DIR" && "$PRISMA_BIN" migrate deploy --config "$CONFIG_FILE"); then
        rm -f "$CONFIG_FILE"
        fail "database migration failed; the container will not start with a partially migrated schema. Check the logs above, restore a backup if needed, and see docs/DEPLOYMENT.md."
    fi
    rm -f "$CONFIG_FILE"
    log "Database is up to date."
}

if [ "${1:-}" = "migrate" ]; then
    migrate
    exit 0
fi

migrate

log "Starting PinCheck on port ${PORT:-3000}"
# exec keeps the Next.js server as PID 1 for clean SIGTERM handling.
exec "$APP_DIR/node_modules/.bin/next" start
