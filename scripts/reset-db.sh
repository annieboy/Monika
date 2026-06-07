#!/usr/bin/env bash
# reset-db.sh — wipe and recreate the local database
# USE WITH CAUTION: destroys all local data.
set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

warn()  { echo -e "${YELLOW}[reset-db]${NC} $*"; }
info()  { echo -e "${GREEN}[reset-db]${NC} $*"; }
die()   { echo -e "${RED}[reset-db]${NC} $*" >&2; exit 1; }

warn "This will DELETE all data in the local PostgreSQL database."
read -r -p "Type 'yes' to confirm: " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
  info "Aborted."
  exit 0
fi

info "Stopping postgres..."
docker compose stop postgres

info "Removing postgres data volume..."
docker compose rm -f postgres
docker volume rm monika_postgres_data 2>/dev/null || true

info "Restarting postgres..."
docker compose up -d postgres

info "Waiting for PostgreSQL to be ready..."
MAX_WAIT=30
WAITED=0
until docker compose exec -T postgres pg_isready -U monika -d monika >/dev/null 2>&1; do
  if [[ $WAITED -ge $MAX_WAIT ]]; then
    die "PostgreSQL did not become ready within ${MAX_WAIT}s."
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

info "Database reset complete. Run ./scripts/migrate.sh to re-apply migrations."
