#!/usr/bin/env bash
# setup.sh — one-shot local environment setup for new clones
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[setup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[setup]${NC} $*"; }
error()   { echo -e "${RED}[setup]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ── Prerequisite checks ───────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v docker  >/dev/null 2>&1 || die "docker is not installed. See https://docs.docker.com/get-docker/"
command -v uv      >/dev/null 2>&1 || die "uv is not installed. Run: curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v python3 >/dev/null 2>&1 || die "python3 is not installed."

PYTHON_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
if [[ "$PYTHON_VER" < "3.11" ]]; then
  die "Python 3.11+ required (found $PYTHON_VER)"
fi

info "Prerequisites OK (python $PYTHON_VER, uv $(uv --version | cut -d' ' -f2))"

# ── .env file ─────────────────────────────────────────────────────────────────
cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  warn ".env created from .env.example — fill in your API keys before running the backend."
else
  info ".env already exists — not overwriting."
fi

# ── Python virtualenv ─────────────────────────────────────────────────────────
if [[ -f pyproject.toml ]]; then
  info "Installing Python dependencies..."
  uv sync --dev
  info "Python dependencies installed."
else
  warn "pyproject.toml not found — skipping Python dependency install."
fi

# ── Start Docker services ─────────────────────────────────────────────────────
info "Starting Docker services (postgres, redis, adminer)..."
docker compose up -d

# ── Wait for postgres ─────────────────────────────────────────────────────────
info "Waiting for PostgreSQL to be ready..."
MAX_WAIT=30
WAITED=0
until docker compose exec -T postgres pg_isready -U monika -d monika >/dev/null 2>&1; do
  if [[ $WAITED -ge $MAX_WAIT ]]; then
    die "PostgreSQL did not become ready within ${MAX_WAIT}s. Check: docker compose logs postgres"
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
info "PostgreSQL is ready."

# ── Wait for redis ────────────────────────────────────────────────────────────
info "Waiting for Redis to be ready..."
WAITED=0
until docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do
  if [[ $WAITED -ge 15 ]]; then
    die "Redis did not become ready within 15s. Check: docker compose logs redis"
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
info "Redis is ready."

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
echo "    1. Edit .env and fill in your API keys"
echo "    2. Run database migrations: ./scripts/migrate.sh"
echo "    3. Start the backend: uv run uvicorn backend.main:app --reload"
echo ""
