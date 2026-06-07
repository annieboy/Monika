# Monika — AI-Powered Personal Finance Assistant

WhatsApp-native financial intelligence for UK consumers, built on Open Banking.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Full product and technical architecture
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — Phase-by-phase build plan

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Python | 3.11+ | [python.org](https://www.python.org/) or `asdf install` |
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) or `asdf install` |
| uv | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Docker | 25+ | [docs.docker.com](https://docs.docker.com/get-docker/) |

## Quick Start

```bash
# 1. Clone and set up
git clone <repo-url> monika
cd monika
./scripts/setup.sh

# 2. Fill in your API keys
vi .env

# 3. Apply database migrations
./scripts/migrate.sh

# 4. Start the backend
uv run uvicorn backend.main:app --reload
```

## Local Services

After `./scripts/setup.sh`:

| Service    | URL                                          |
|------------|----------------------------------------------|
| PostgreSQL | `postgresql://monika:monika@localhost:5432/monika` |
| Redis      | `redis://localhost:6379`                     |
| Adminer    | http://localhost:8080                        |
| Backend    | http://localhost:8000 (when running)         |
| Frontend   | http://localhost:3000 (when running)         |

## Development

```bash
# Run all tests
uv run pytest

# Run unit tests only (fast, no database required)
uv run pytest backend/tests/unit/

# Lint
uv run ruff check backend/

# Format
uv run ruff format backend/

# Type check
uv run mypy backend/

# Run all pre-commit hooks against staged files
pre-commit run

# Reset local database (destructive — prompts for confirmation)
./scripts/reset-db.sh
```

## Project Structure

```
monika/
├── backend/             # Python backend (FastAPI)
│   ├── core/            # Shared utilities: config, logging, exceptions
│   ├── api/             # HTTP endpoints and middleware
│   ├── services/        # Business logic
│   ├── workers/         # Background job processors
│   ├── db/              # Database models and migrations
│   └── tests/           # Unit and integration tests
├── frontend/            # Next.js web onboarding flow
├── infrastructure/      # Docker Compose and Terraform
├── scripts/             # Developer utility scripts
├── alembic/             # Database migrations
└── docs/                # Architecture and planning documents
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Then edit .env with your API keys
```

Required for basic startup:
- `SECRET_KEY` — 64-char hex: `openssl rand -hex 32`
- `ENCRYPTION_KEY` — 64-char hex: `openssl rand -hex 32`

Required for full functionality: TrueLayer, Anthropic, and WhatsApp credentials (see `.env.example`).

## Contributing

1. Branch from `main`
2. `pre-commit install` to enable commit hooks
3. All tests must pass: `uv run pytest`
4. All linting must pass: `uv run ruff check backend/`
5. Type check must pass: `uv run mypy backend/`
