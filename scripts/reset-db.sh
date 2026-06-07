#!/usr/bin/env bash
# reset-db.sh — wipe and recreate the local database.
# USE WITH CAUTION: destroys all local data.
set -euo pipefail

YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
warn() { echo -e "${YELLOW}[reset-db]${NC} $*"; }
info() { echo -e "${GREEN}[reset-db]${NC} $*"; }
die()  { echo -e "${RED}[reset-db]${NC} $*" >&2; exit 1; }

warn "This will DELETE all data in the local database."
read -r -p "Type 'yes' to confirm: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { info "Aborted."; exit 0; }

info "Resetting Prisma migrations..."
npx prisma migrate reset --force

info "Done. Run 'npm run db:seed' to populate test data."
