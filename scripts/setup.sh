#!/usr/bin/env bash
# setup.sh — one-shot local environment setup for a fresh clone.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
die()   { echo -e "${RED}[setup]${NC} $*" >&2; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
info "Checking prerequisites..."
command -v node  >/dev/null 2>&1 || die "Node.js not installed. See https://nodejs.org"
command -v npm   >/dev/null 2>&1 || die "npm not installed."
command -v docker >/dev/null 2>&1 || die "Docker not installed. See https://docs.docker.com/get-docker/"

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if (( NODE_MAJOR < 20 )); then
  die "Node.js 20+ required (found $(node --version))"
fi
info "Node.js $(node --version), npm $(npm --version) — OK"

# ── .env ──────────────────────────────────────────────────────────────────────
cd "$REPO_ROOT"
if [[ ! -f .env ]]; then
  cp .env.example .env
  warn ".env created — fill in your API keys before starting the server."
else
  info ".env already exists — not overwriting."
fi

# ── npm install ───────────────────────────────────────────────────────────────
info "Installing Node.js dependencies..."
npm install
info "Dependencies installed."

# ── Docker infrastructure ─────────────────────────────────────────────────────
info "Starting Docker services (postgres, redis, adminer)..."
docker compose up -d

# ── Wait for postgres ─────────────────────────────────────────────────────────
info "Waiting for PostgreSQL..."
MAX=30; N=0
until docker compose exec -T postgres pg_isready -U monika -d monika >/dev/null 2>&1; do
  (( N++ )); (( N >= MAX )) && die "PostgreSQL not ready after ${MAX}s. Check: docker compose logs postgres"
  sleep 1
done
info "PostgreSQL is ready."

# ── Prisma generate + migrate ─────────────────────────────────────────────────
info "Generating Prisma client..."
npm run db:generate

info "Applying database migrations..."
npm run db:migrate -- --name init 2>/dev/null || npm run db:migrate:deploy 2>/dev/null || {
  warn "Migrations may already be applied — trying db:push as fallback..."
  npm run db:push -- --accept-data-loss
}

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup complete.${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  PostgreSQL : postgresql://monika:monika@localhost:5432/monika"
echo "  Redis      : redis://localhost:6379"
echo "  Adminer    : http://localhost:8080"
echo ""
echo "  Next steps:"
echo "    1. Edit .env — fill in API keys"
echo "    2. npm run dev"
echo "    3. curl http://localhost:3000/health"
echo ""
