# Monika — Phase 1 Implementation Plan
## Solo Founder Edition

**Follows from:** `ARCHITECTURE.md`  
**Goal:** Working end-to-end system: WhatsApp message in → real bank data → AI response out  
**Duration:** ~16 weeks at solo-founder pace (20–30 hours/week)  
**Philosophy:** Each task produces something you can see and test. No task ends with "and then it will work later."

---

## Reading This Document

Each task has:
- **Objective** — what you're actually trying to achieve and why
- **Files to create** — exact paths, so the repo structure builds incrementally
- **Implementation details** — specific decisions, not just "set up the database"
- **Acceptance criteria** — a concrete checklist you can tick off
- **Testing requirements** — how to verify it works before moving on

Tasks within a section are ordered. Do not skip ahead — each task creates the foundation the next one depends on.

---

## Phase 1 Overview

```
Section 1: Local Development Environment    (Tasks 1.1 – 1.4)   ~1 week
Section 2: Repository Structure             (Tasks 2.1 – 2.3)   ~1 week
Section 3: Database Setup                   (Tasks 3.1 – 3.4)   ~2 weeks
Section 4: Backend Setup                    (Tasks 4.1 – 4.5)   ~2 weeks
Section 5: WhatsApp Integration             (Tasks 5.1 – 5.4)   ~2 weeks
Section 6: Open Banking Integration         (Tasks 6.1 – 6.5)   ~4 weeks
Section 7: AI Agent Framework               (Tasks 7.1 – 7.5)   ~4 weeks
```

---

## Section 1: Local Development Environment

### Task 1.1 — Install and Configure Core Tooling

**Objective:**  
Every tool you will use throughout the project must be installed, versioned, and verified before writing a single line of application code. Chasing environment issues mid-task is the most expensive kind of interruption.

**Files to create:**
```
.tool-versions                  # asdf version pins for all tools
.env.example                    # template for all environment variables (no real values)
README.md                       # getting-started instructions for future hires
```

**Implementation details:**

Use `asdf` as the version manager for all runtimes. This ensures every tool is pinnable to an exact version — essential when a collaborator or CI pipeline joins later.

Install and pin these tools via `.tool-versions`:
- Python 3.12.x — primary backend language
- Node.js 20.x LTS — for the web onboarding frontend (Next.js)
- PostgreSQL 16.x — local database (also installed as a service, not just client)
- Redis 7.x — local session cache
- Docker 25.x + Docker Compose — for running dependencies locally without polluting the host system

For Python dependency management use `uv` (not pip, not poetry). `uv` is dramatically faster, has a lockfile, and is becoming the standard. Install it separately from asdf.

For local secrets, use a `.env` file that is gitignored. Create `.env.example` with all required variable names and placeholder descriptions. This file IS committed — it documents what needs to be set, without setting it.

`.env.example` should include placeholders for:
- `DATABASE_URL`
- `REDIS_URL`
- `TRUELAYER_CLIENT_ID`
- `TRUELAYER_CLIENT_SECRET`
- `TRUELAYER_REDIRECT_URI`
- `ANTHROPIC_API_KEY`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `KMS_KEY_ID` (can be a placeholder for local dev)
- `ENCRYPTION_KEY` (32-byte hex string for local dev, replaces KMS locally)
- `APP_ENV` (development / staging / production)
- `LOG_LEVEL`
- `SECRET_KEY` (for signing onboarding tokens)

`README.md` should cover: prerequisites, how to run `./scripts/setup.sh`, how to start services, how to run tests.

**Acceptance criteria:**
- [ ] `python --version` returns 3.12.x
- [ ] `node --version` returns 20.x
- [ ] `psql --version` returns 16.x
- [ ] `redis-cli ping` returns `PONG`
- [ ] `docker compose version` returns a valid version
- [ ] `uv --version` returns a valid version
- [ ] `.env.example` exists and is committed; `.env` is in `.gitignore`
- [ ] `README.md` exists with setup instructions

**Testing requirements:**  
Run each version check command above. No automated tests at this stage — this task is purely environment validation.

---

### Task 1.2 — Docker Compose for Local Dependencies

**Objective:**  
Postgres and Redis must run locally with zero manual configuration. A single command should start all infrastructure dependencies. This is essential for a solo founder — you cannot afford to spend time on database administration during development.

**Files to create:**
```
docker-compose.yml              # defines postgres + redis + optional tooling
docker-compose.override.yml     # local overrides (gitignored)
scripts/setup.sh                # one-shot setup script for new environments
scripts/reset-db.sh             # wipes and recreates local database
```

**Implementation details:**

`docker-compose.yml` defines:
- **postgres** service: image `postgres:16-alpine`, named volume for data persistence, environment variables for db name / user / password (use `monika` / `monika` / `monika` for local — these are not secrets), healthcheck using `pg_isready`, port `5432` exposed to host
- **redis** service: image `redis:7-alpine`, port `6379` exposed to host, no persistence needed locally (use `--save ""` to disable RDB snapshotting — we don't need durability locally)
- **adminer** (optional): lightweight database GUI on port `8080` — useful for inspecting the database without installing a separate tool

`docker-compose.override.yml` is gitignored. It lets you add personal local preferences (e.g., different port mappings) without polluting the shared config.

`scripts/setup.sh` should:
1. Check that docker, python, node, uv are installed — print clear error if not
2. Copy `.env.example` to `.env` if `.env` doesn't exist (never overwrite an existing `.env`)
3. Run `docker compose up -d` to start services
4. Wait for postgres to be healthy (poll `pg_isready` up to 30 seconds)
5. Print success message with next steps

`scripts/reset-db.sh` should stop postgres, delete the named volume, restart postgres. Used during development when you want a clean state. Must prompt for confirmation — never auto-run destructively.

**Acceptance criteria:**
- [ ] `docker compose up -d` starts Postgres and Redis with no errors
- [ ] `psql postgresql://monika:monika@localhost:5432/monika` connects successfully
- [ ] `redis-cli -h localhost ping` returns `PONG`
- [ ] `./scripts/setup.sh` runs end-to-end without errors on a fresh clone
- [ ] `docker compose down` stops all services cleanly
- [ ] Named volume persists database data between `docker compose down` and `docker compose up`

**Testing requirements:**  
Run `./scripts/setup.sh` from a clean clone. Verify database connectivity. Run `docker compose down`, then `docker compose up -d`, verify data persisted. Run `./scripts/reset-db.sh`, confirm it prompts for confirmation.

---

### Task 1.3 — Git Configuration and Pre-commit Hooks

**Objective:**  
Establish code quality guardrails before writing any application code. It is trivially easy to commit secrets, broken code, or badly formatted files when working solo — pre-commit hooks are the automated check that catches this. The cost of setting them up now is one hour; the cost of a committed secret is potentially your entire business.

**Files to create:**
```
.gitignore                      # comprehensive Python + Node + env file ignores
.pre-commit-config.yaml         # pre-commit hook definitions
pyproject.toml                  # Python project config (includes ruff, mypy config)
.github/
  workflows/
    ci.yml                      # GitHub Actions CI pipeline (basic, expand later)
```

**Implementation details:**

`.gitignore` must cover:
- Python: `__pycache__/`, `*.pyc`, `.venv/`, `*.egg-info/`, `dist/`, `.pytest_cache/`, `.mypy_cache/`, `htmlcov/`
- Node: `node_modules/`, `.next/`, `out/`, `build/`
- Environment: `.env`, `.env.local`, `.env.*.local`
- Docker: docker-compose.override.yml
- IDE: `.idea/`, `.vscode/` (optional — teams often prefer per-engineer IDE config)
- OS: `.DS_Store`, `Thumbs.db`
- Keys: `*.pem`, `*.key`, `*.p12`

`.pre-commit-config.yaml` hooks:
- `detect-secrets` — scans for accidentally committed secrets/API keys. This is non-negotiable.
- `check-yaml` — validates YAML syntax
- `check-json` — validates JSON syntax
- `end-of-file-fixer` — ensures files end with newline
- `trailing-whitespace` — removes trailing spaces
- `ruff` — Python linting + formatting (replaces flake8 + black + isort — single tool)
- `mypy` — Python type checking (on staged files only, for speed)

`pyproject.toml` configures:
- `ruff` rules: enable `E`, `F`, `I` (isort), `UP` (pyupgrade), `B` (bugbear)
- `ruff` line length: 100 characters
- `mypy` settings: `strict = true` is too aggressive for early development; use `disallow_untyped_defs = true` and `ignore_missing_imports = true`
- `pytest` settings: `testpaths = ["tests"]`, `asyncio_mode = "auto"`

`ci.yml` GitHub Actions workflow:
- Trigger: push to any branch, PR to main
- Steps: checkout, set up Python, install uv, install dependencies, run ruff, run mypy, run pytest
- Keep it simple — do not add deployment steps yet

**Acceptance criteria:**
- [ ] `git commit` with a fake API key string is blocked by `detect-secrets`
- [ ] `git commit` with a Python syntax error is blocked by ruff
- [ ] `.env` cannot be committed (caught by both `.gitignore` and `detect-secrets`)
- [ ] `pre-commit run --all-files` runs without errors on the current repo state
- [ ] GitHub Actions CI pipeline is green on an empty test suite

**Testing requirements:**  
Deliberately attempt to commit a file containing `AKIA1234567890EXAMPLE` (fake AWS key format). Verify pre-commit blocks it. Attempt to commit a Python file with a syntax error. Verify it is blocked.

---

### Task 1.4 — Observability Foundation (Local)

**Objective:**  
You must be able to see what your application is doing from day one. Structured logging and local metrics are not nice-to-haves — they are how you debug issues in a system that spans multiple services. Setting up the pattern now means every future service inherits it automatically.

**Files to create:**
```
backend/
  core/
    logging.py                  # structured logging configuration
    config.py                   # settings management (pydantic-settings)
    exceptions.py               # base exception classes
```

**Implementation details:**

**Logging (`logging.py`):**  
Use `structlog` for structured logging — every log line is JSON in production, human-readable in development. This is critical: when debugging a financial discrepancy, you need to trace exactly what tools were called, what data was returned, and what the agent said. Unstructured string logs make this impossible at volume.

Configure `structlog` with:
- Processors: timestamp (ISO 8601), log level, caller info (file + line number), JSON renderer in production, coloured console renderer in development
- Log context: automatically include `request_id` and `user_id` when set (using `structlog.contextvars`)
- Never log: raw transaction data, OAuth tokens, personal data (add a `sensitive` flag that redacts values)

**Configuration (`config.py`):**  
Use `pydantic-settings` for configuration management. This reads from environment variables, validates types and required fields at startup, and provides IDE autocompletion. If a required variable is missing, the application fails immediately with a clear error — not mysteriously later.

Define a `Settings` class with all the variables from `.env.example`. Organise into nested models: `DatabaseSettings`, `RedisSettings`, `TrueLayerSettings`, `AnthropicSettings`, `WhatsAppSettings`.

Add a `get_settings()` function with `@lru_cache` — settings are loaded once at startup, not on every call.

**Exceptions (`exceptions.py`):**  
Define a hierarchy of base exceptions:
- `MonikaError` — base for all application errors
- `ValidationError(MonikaError)` — invalid input
- `NotFoundError(MonikaError)` — resource not found
- `AuthenticationError(MonikaError)` — auth failure
- `ExternalServiceError(MonikaError)` — third-party API failure (TrueLayer, WhatsApp, Anthropic)
- `DataAccessError(MonikaError)` — database error

Each exception should carry: `message`, `code` (machine-readable string), optional `context` dict.

**Acceptance criteria:**
- [ ] Application startup fails with a clear error if `DATABASE_URL` is missing from environment
- [ ] Log output in development is human-readable and coloured
- [ ] Log output in production (when `APP_ENV=production`) is valid JSON, one object per line
- [ ] `structlog.contextvars.bind_contextvars(user_id="test-123")` causes all subsequent log calls in that context to include `user_id`
- [ ] All exception classes can be imported from `backend.core.exceptions`

**Testing requirements:**  
Write unit tests for: settings validation (missing required field raises), exception hierarchy (subclass relationships), log output format (assert JSON in production mode). These are the first tests in the repo — they should pass cleanly on CI.

---

## Section 2: Repository Structure

### Task 2.1 — Monorepo Layout

**Objective:**  
Establish the directory structure for the entire project. Done once, correctly, it prevents the technical debt of scattered files. Done wrong, you spend weeks reorganising. The structure must support: Python backend services, a Next.js frontend, shared configuration, scripts, and tests — all in one repository.

**Files to create:**
```
backend/
  __init__.py
  core/                         # shared utilities (logging, config, exceptions)
  api/                          # FastAPI application
  services/                     # business logic services
  workers/                      # background job workers
  db/                           # database models and migrations
  tests/
    unit/
    integration/
    conftest.py

frontend/
  (Next.js project — scaffold in Task 4.5)

scripts/
  setup.sh                      # (already created)
  reset-db.sh                   # (already created)
  seed-db.sh                    # populates test data
  run-worker.sh                 # starts a named background worker

infrastructure/
  docker-compose.yml            # (move here from root)
  terraform/                    # AWS infrastructure (empty for now)

docs/
  ARCHITECTURE.md               # (move from root)
  IMPLEMENTATION_PLAN.md        # (move from root)
  decisions/                    # Architectural Decision Records
    001-whatsapp-provider.md
    002-open-banking-provider.md
    003-llm-selection.md

.github/
  workflows/
    ci.yml
  CODEOWNERS                    # who reviews what (solo for now, add for hiring)
  pull_request_template.md
```

**Implementation details:**

The `backend/` directory is a Python package (has `__init__.py` at the top). All imports are absolute: `from backend.core.config import get_settings`, never relative imports at the service level — this prevents import confusion as the project grows.

The `backend/services/` directory will contain one file per service domain:
- `conversation.py` — conversation management
- `banking.py` — Open Banking / TrueLayer client
- `agent.py` — AI agent orchestration
- `notification.py` — WhatsApp message sending
- `user.py` — user management

The `backend/workers/` directory will contain background job processors:
- `transaction_sync.py` — fetches new transactions from TrueLayer
- `categorisation.py` — categorises new transactions
- `anomaly_detection.py` — scores transactions for anomalies
- `aggregation.py` — computes monthly summaries

The `docs/decisions/` directory contains Architectural Decision Records (ADRs). An ADR is a short document recording: what decision was made, why, what alternatives were rejected, and what the consequences are. Write one for each major choice from the architecture document. This is invaluable when a new hire asks "why do we use TrueLayer?" or when you revisit a decision 18 months later.

ADR format: Context → Decision → Alternatives considered → Consequences. Keep them short (one page max).

**Acceptance criteria:**
- [ ] All directories listed above exist (even if empty — add `.gitkeep` to empty dirs)
- [ ] `python -c "from backend.core.config import get_settings"` succeeds
- [ ] `backend/tests/conftest.py` exists with a basic pytest fixture for database connection
- [ ] `docs/decisions/` has at least three ADRs written
- [ ] Architecture and implementation plan docs are in `docs/`

**Testing requirements:**  
Verify Python import paths work. Run `python -m pytest backend/tests/` on an empty test suite — it should return "no tests found" not an error.

---

### Task 2.2 — Python Backend Project Configuration

**Objective:**  
Set up the Python project with all dependencies pinned and a reproducible install process. A solo founder switching machines, or a CI pipeline, must get an identical environment every time. Dependency drift (different versions in different environments) is a silent killer of debugging time.

**Files to create:**
```
pyproject.toml                  # project metadata + tool config (expand from Task 1.3)
uv.lock                         # lockfile (generated by uv, committed to git)
backend/
  requirements/
    base.txt                    # core dependencies (generated from pyproject.toml)
    dev.txt                     # dev-only dependencies
```

**Implementation details:**

Define all dependencies in `pyproject.toml` under `[project.dependencies]`.

**Core dependencies:**
- `fastapi[standard]` — web framework (includes uvicorn, pydantic v2)
- `pydantic-settings` — configuration management
- `sqlalchemy[asyncio]` — ORM with async support
- `asyncpg` — async PostgreSQL driver
- `alembic` — database migrations
- `redis[hiredis]` — Redis client with fast C parser
- `structlog` — structured logging
- `httpx` — async HTTP client (for TrueLayer and WhatsApp API calls)
- `anthropic` — official Anthropic SDK
- `cryptography` — for AES-256-GCM encryption of PII
- `python-jose[cryptography]` — JWT handling for onboarding tokens
- `pydantic[email]` — email validation
- `tenacity` — retry logic with exponential backoff
- `sentry-sdk[fastapi]` — error tracking (set up now, configure later)

**Dev dependencies** (under `[project.optional-dependencies]`):
- `pytest` + `pytest-asyncio` — async test runner
- `pytest-cov` — coverage reporting
- `httpx` — also used for test client
- `factory-boy` — test data factories (much better than writing fixture dicts by hand)
- `faker` — generates realistic fake data for tests
- `ruff` — linting (already in pre-commit, also runnable directly)
- `mypy` — type checking
- `pre-commit` — hook runner

Pin major versions explicitly (e.g., `fastapi>=0.111,<1.0`). Do not use `*` as a version constraint on any production dependency. The lockfile (`uv.lock`) captures exact versions — this is what ensures reproducibility.

**Acceptance criteria:**
- [ ] `uv sync` installs all dependencies without errors
- [ ] `uv sync --dev` installs dev dependencies without errors
- [ ] `uv lock --check` passes (lockfile matches pyproject.toml)
- [ ] `python -c "import fastapi, sqlalchemy, anthropic, structlog"` succeeds
- [ ] `uv.lock` is committed to git
- [ ] `pip install` is never used — only `uv`

**Testing requirements:**  
Delete `.venv/`, run `uv sync`, verify imports work. Run `uv lock --check` to verify lockfile is up to date. This simulates what CI does.

---

### Task 2.3 — Next.js Frontend Scaffold (Web Onboarding)

**Objective:**  
Create the minimal Next.js project for the bank connection consent flow. This is not the main product UI — it's the single web page users visit to connect their bank. It must exist as a project, properly configured, before the Open Banking integration needs it. Do not build UI yet — just the scaffold.

**Files to create:**
```
frontend/
  package.json
  package-lock.json             # or pnpm-lock.yaml if using pnpm
  tsconfig.json
  next.config.ts
  .eslintrc.json
  app/
    layout.tsx                  # root layout
    page.tsx                    # placeholder home page
    connect/
      page.tsx                  # placeholder for bank connection flow (Task 6.x)
    api/
      health/
        route.ts                # health check endpoint
  components/
    (empty, ready for Task 6.x)
  lib/
    api.ts                      # typed API client for backend calls
```

**Implementation details:**

Use Next.js 14+ with the App Router (not Pages Router — App Router is the current standard and handles server components, which we'll want for secure token validation).

TypeScript is non-negotiable for the frontend — the onboarding flow handles security-sensitive operations (token validation, OAuth callbacks) and type safety catches entire categories of bugs at compile time.

Use `pnpm` as the package manager for the frontend — faster than npm, more efficient disk usage, better monorepo support.

Minimal dependencies at this stage:
- `next`
- `react` + `react-dom`
- `typescript`
- `tailwindcss` — utility CSS framework, mobile-first (the onboarding page is opened on phones)
- `@tanstack/react-query` — for data fetching in client components (avoid if possible, prefer server components)

Do not add a component library yet — premature UI framework choices are hard to undo. Raw Tailwind is sufficient for a simple consent flow.

Set up `next.config.ts` with:
- `output: 'standalone'` — needed for Docker deployment
- Strict CSP headers — the consent flow handles OAuth tokens, CSP is a security requirement
- No inline scripts allowed (CSP)

The `lib/api.ts` file should export a typed fetch wrapper that: includes the base URL from environment variables, handles errors consistently, and returns typed responses. This prevents scattered `fetch()` calls throughout the codebase.

**Acceptance criteria:**
- [ ] `pnpm install` installs dependencies without errors
- [ ] `pnpm run dev` starts the dev server on port 3000
- [ ] `GET /api/health` returns `{"status": "ok"}`
- [ ] `pnpm run build` produces a production build without errors
- [ ] TypeScript strict mode is enabled and `pnpm run type-check` passes
- [ ] ESLint passes on the scaffold

**Testing requirements:**  
Run the dev server, visit `http://localhost:3000` and `http://localhost:3000/api/health`. Run `pnpm run build` and verify no errors. Run `pnpm run type-check`.

---

## Section 3: Database Setup

### Task 3.1 — SQLAlchemy Models and Database Connection

**Objective:**  
Define the Python-layer representation of every database table from the schema in `ARCHITECTURE.md`. These models are the single source of truth for how data is structured throughout the application. Every other part of the system depends on getting this right.

**Files to create:**
```
backend/
  db/
    __init__.py
    connection.py               # async database engine + session factory
    base.py                     # declarative base + shared model mixins
    models/
      __init__.py               # exports all models
      user.py                   # User model
      bank_connection.py        # BankConnection model
      account.py                # Account model
      transaction.py            # Transaction model
      conversation.py           # Conversation model
      monthly_summary.py        # MonthlySummary model
      recurring_payment.py      # RecurringPayment model
      audit_log.py              # AuditLog model
      onboarding_token.py       # OnboardingToken model
```

**Implementation details:**

Use SQLAlchemy 2.0 style (not legacy 1.x style). SQLAlchemy 2.0 has dramatically improved async support and the new `Mapped[]` type annotation syntax integrates with mypy properly.

**`connection.py`** creates:
- `async_engine` using `create_async_engine` with `asyncpg` driver
- Connection pool settings: `pool_size=10`, `max_overflow=20`, `pool_pre_ping=True` (validates connections before use — prevents "connection closed" errors after idle periods)
- `AsyncSessionLocal` — a session factory
- `get_db()` — an async context manager / FastAPI dependency that yields a session and handles rollback on exception

**`base.py`** defines:
- `Base` — SQLAlchemy `DeclarativeBase` subclass
- `TimestampMixin` — adds `created_at` and `updated_at` with server defaults and auto-update
- `UUIDMixin` — adds `id` as a UUID primary key with `gen_random_uuid()` server default

**Model design notes:**
- Every model inherits `Base`, `TimestampMixin`, and `UUIDMixin`
- Use `Mapped[type]` annotations for all columns — this enables mypy type checking
- Use `mapped_column()` not `Column()` — this is the SQLAlchemy 2.0 API
- Encrypted fields: defined as `Mapped[bytes]` (stored as `BYTEA`), with corresponding Python properties that decrypt on read using the `EncryptedField` descriptor (defined in Task 3.3)
- Foreign keys use `ON DELETE CASCADE` where appropriate (deleting a user cascades to all their data)
- All `ENUM`-like fields use SQLAlchemy `Enum` type with explicit string values — not Python enums, because database migrations with Python enums are painful

**`AuditLog` model** is special:
- No `updated_at` column — it is append-only
- SQLAlchemy event listener prevents `UPDATE` statements on this model in application code
- In production this will be enforced via database RLS too (Task 3.4)

**Acceptance criteria:**
- [ ] `from backend.db.models import User, Transaction, BankConnection` imports cleanly
- [ ] All models have correct column types matching the schema in `ARCHITECTURE.md`
- [ ] `TimestampMixin` correctly populates `created_at` on insert and `updated_at` on update
- [ ] `get_db()` as a FastAPI dependency provides a session and rolls back on exception
- [ ] mypy reports no errors on the models directory

**Testing requirements:**  
Write unit tests that instantiate each model with valid data and verify field types. Write an integration test (using a real test database) that creates a `User`, reads it back, and confirms `created_at` was set. Test that updating a `User` changes `updated_at`.

---

### Task 3.2 — Database Migrations with Alembic

**Objective:**  
Create the migration system that manages schema changes across all environments (local, staging, production). Every schema change must be captured as a migration. Migrations must be reversible. You must never run raw `CREATE TABLE` statements — always go through Alembic.

**Files to create:**
```
alembic.ini                     # Alembic configuration
alembic/
  env.py                        # migration environment (connects to DB, imports models)
  versions/
    0001_initial_schema.py      # first migration: all tables from ARCHITECTURE.md
```

**Implementation details:**

Configure Alembic to:
- Read `DATABASE_URL` from the application's `Settings` object (not hardcoded in `alembic.ini`)
- Use async migrations (required for `asyncpg`) via `run_async_migrations()`
- Auto-detect model changes: set `target_metadata = Base.metadata` in `env.py`

`alembic/env.py` requires careful setup for async. The standard Alembic template is synchronous — you need to use `asyncio.run()` to run the migration function. Alembic's own documentation has an async example — follow it exactly.

The first migration `0001_initial_schema.py` creates all tables from `ARCHITECTURE.md`:
- Write it by running `alembic revision --autogenerate -m "initial schema"` against a clean database, then review and clean up the generated file
- Add indexes explicitly — autogenerate often misses complex indexes
- Add the `CHECK` constraints (e.g., `onboarding_status IN ('pending','connecting',...)`) — these are not generated automatically
- Add comments on columns that will confuse future-you (e.g., why `whatsapp_phone_hash` stores a hash not the phone number)

Migration naming convention: `NNNN_short_description.py` where `NNNN` is a zero-padded sequential number. Do not use the default Alembic random hash filenames — they are impossible to reason about in a list.

Add two scripts to `scripts/`:
- `scripts/migrate.sh` — runs `alembic upgrade head` (applies all pending migrations)
- `scripts/rollback.sh` — runs `alembic downgrade -1` (reverts the last migration)

**Acceptance criteria:**
- [ ] `alembic upgrade head` on a fresh database creates all tables without errors
- [ ] `alembic downgrade base` drops all tables cleanly
- [ ] `alembic upgrade head` after `downgrade base` recreates everything correctly (idempotent)
- [ ] All indexes from `ARCHITECTURE.md` exist in the database (verify with `\di` in psql)
- [ ] All `CHECK` constraints are present (verify with `\d+ tablename` in psql)
- [ ] `alembic current` shows the correct migration head
- [ ] A second run of `alembic upgrade head` is a no-op (no errors, "already at head")

**Testing requirements:**  
Run the full upgrade/downgrade/upgrade cycle in CI. Write a test that verifies the number of tables after migration matches the expected count. Verify that inserting a row with an invalid `CHECK` constraint value raises a database error.

---

### Task 3.3 — Application-Level Encryption

**Objective:**  
Implement the encryption layer for PII fields (names, emails, bank tokens). This is a security requirement identified in the architecture. It must exist before any PII is stored — retrofitting encryption to existing data is painful and error-prone.

**Files to create:**
```
backend/
  core/
    encryption.py               # AES-256-GCM encryption/decryption + key management
  db/
    encrypted_field.py          # SQLAlchemy TypeDecorator for encrypted columns
```

**Implementation details:**

**`encryption.py`** implements:
- `EncryptionService` class with `encrypt(plaintext: str) -> bytes` and `decrypt(ciphertext: bytes) -> str`
- Algorithm: AES-256-GCM (authenticated encryption — provides both confidentiality and integrity)
- Each call to `encrypt()` generates a new random 12-byte nonce — the nonce is prepended to the ciphertext in the stored bytes
- The key is loaded from `Settings.ENCRYPTION_KEY` in local/dev, and from AWS KMS in production
- A `LocalKeyBackend` and a `KMSKeyBackend` implement a common `KeyBackend` protocol — the application uses whichever the environment specifies. This allows full local development without AWS.
- Never log the key, the plaintext, or the decrypted value

**`encrypted_field.py`** defines `EncryptedString` — a SQLAlchemy `TypeDecorator` on top of `LargeBinary`:
- `process_bind_param()`: encrypts on write (Python str → bytes)
- `process_result_value()`: decrypts on read (bytes → Python str)
- Returns `None` for `None` values (nullable fields)

Usage in models:
```python
# In user.py:
full_name: Mapped[Optional[str]] = mapped_column(EncryptedString, nullable=True)
```

This is clean — the encryption is invisible to the rest of the codebase.

**Key rotation:** Design `EncryptionService` so that decryption can accept a `key_version` parameter. This enables future key rotation (re-encrypt with new key, drop old key) without downtime. Store `key_version` as the first byte of the ciphertext. Start at version 1.

**Acceptance criteria:**
- [ ] `EncryptionService().encrypt("hello")` returns bytes
- [ ] `EncryptionService().decrypt(ciphertext)` returns `"hello"` for any ciphertext produced by `encrypt("hello")`
- [ ] Two calls to `encrypt("hello")` return different bytes (different nonces)
- [ ] Corrupting any byte of the ciphertext causes `decrypt()` to raise an error (integrity check)
- [ ] A `User` saved with `full_name="Alice"` is stored as bytes in the database (verify via direct psql query)
- [ ] Reading the `User` back via SQLAlchemy returns `full_name="Alice"`
- [ ] The raw database row does NOT contain the string "Alice"

**Testing requirements:**  
Unit tests: encrypt/decrypt roundtrip, nonce uniqueness, tamper detection. Integration tests: save encrypted model, read it back, verify plaintext. Test the `None` case. Test that the database column contains bytes, not plaintext (query via raw SQL).

---

### Task 3.4 — Database Access Patterns and Row-Level Security

**Objective:**  
Implement the data access layer (repository pattern) and configure PostgreSQL Row-Level Security (RLS) to enforce per-user data isolation at the database level. This is the most important security control in the system: even if the application layer has a bug and passes the wrong `user_id` to a query, the database will return zero rows.

**Files to create:**
```
backend/
  db/
    repositories/
      __init__.py
      base.py                   # base repository with common CRUD operations
      user.py                   # UserRepository
      transaction.py            # TransactionRepository
      bank_connection.py        # BankConnectionRepository
      conversation.py           # ConversationRepository
    rls.py                      # RLS policy setup + session context variable setter
  tests/
    integration/
      test_rls.py               # tests that RLS actually works
```

**Implementation details:**

**Repository pattern:**  
Services do not write raw SQLAlchemy queries. They call repository methods. This has three benefits: testability (repositories can be mocked), single location for query optimisation, and consistent error handling.

`base.py` defines `BaseRepository` with:
- `get_by_id(id: UUID) -> Model | None`
- `create(data: dict) -> Model`
- `update(id: UUID, data: dict) -> Model`
- `delete(id: UUID) -> None` (soft delete — sets `deleted_at`)

`TransactionRepository` adds:
- `get_by_user_date_range(user_id, date_from, date_to) -> list[Transaction]`
- `get_by_user_category(user_id, category, date_from, date_to) -> list[Transaction]`
- `get_recurring(user_id) -> list[Transaction]`
- `get_anomalous(user_id, min_score) -> list[Transaction]`
- `upsert_many(transactions: list[dict]) -> int` — bulk insert with conflict handling (for transaction sync)

**Row-Level Security:**  
Create a second database user `app_user` with no superuser privileges. The application connects as `app_user`.

Alembic migration (add as `0002_rls_policies.py`) applies RLS:
```sql
-- Apply to each table with user_id
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON transactions
  FOR ALL TO app_user
  USING (user_id = current_setting('app.current_user_id', true)::uuid);
```

The `true` argument to `current_setting` means it returns NULL (not an error) if the variable is not set — this allows the migration runner (which runs as superuser) to still create tables.

`rls.py` provides `set_rls_context(session, user_id)` — sets `app.current_user_id` for the current session. Call this at the start of every request handler, after authenticating the user.

The audit log table gets a different policy — `INSERT` only for `app_user`, never `UPDATE` or `DELETE`.

**Acceptance criteria:**
- [ ] Connecting as `app_user` and querying `transactions` without setting `app.current_user_id` returns zero rows (not an error, zero rows)
- [ ] Setting `app.current_user_id = 'user-a-uuid'` causes queries to return only user A's transactions
- [ ] Attempting to query user A's data while logged in as user B (different `app.current_user_id`) returns zero rows
- [ ] The `app_user` database role cannot `UPDATE` or `DELETE` from `audit_log`
- [ ] The application can `INSERT` into `audit_log`
- [ ] Alembic migrations still run correctly (run as superuser, not `app_user`)

**Testing requirements:**  
`test_rls.py` must be an integration test (real database). Test: create two users and their transactions, set context to user A, verify only user A's transactions are returned. Set context to user B, verify only user B's. This test is a regression guard — if RLS is ever accidentally disabled, this test catches it.

---

## Section 4: Backend Setup

### Task 4.1 — FastAPI Application Foundation

**Objective:**  
Create the FastAPI application shell with the routing structure, middleware stack, and health check endpoints. Every future endpoint hangs off this foundation. Getting the middleware order wrong is a very common mistake — security middleware must run before business logic.

**Files to create:**
```
backend/
  api/
    __init__.py
    app.py                      # FastAPI app factory
    middleware.py               # custom middleware (request ID, logging, timing)
    dependencies.py             # shared FastAPI dependencies (db session, current user)
    routers/
      __init__.py
      health.py                 # /health and /ready endpoints
      webhooks.py               # WhatsApp webhook (placeholder for Task 5.x)
      onboarding.py             # bank connection flow (placeholder for Task 6.x)
      users.py                  # user management endpoints
  main.py                       # entrypoint: uvicorn startup
```

**Implementation details:**

`app.py` defines a `create_app()` factory function (not a module-level `app` instance). The factory pattern allows creating different app instances for tests (with different settings) versus production.

**Middleware stack (order matters — outermost runs first on request, last on response):**
1. `CORSMiddleware` — restrict origins to your own frontend domain only; `"*"` is not acceptable for a financial application
2. `RequestIDMiddleware` (custom) — generates a UUID `X-Request-ID` header if not present, adds it to structlog context
3. `TimingMiddleware` (custom) — logs request method, path, status code, and duration on every response
4. `DatabaseSessionMiddleware` — makes a DB session available per request (via `request.state.db`)

**Endpoints:**
- `GET /health` — returns `{"status": "ok", "version": "..."}` — used by load balancer health checks; must not require auth; must not query the database
- `GET /ready` — returns `{"status": "ok"}` if DB and Redis are reachable, `503` if not — used by Kubernetes/ECS readiness probes to determine if this instance should receive traffic
- `GET /` — returns a minimal response (not a 404) — some load balancers hit the root path

**`dependencies.py`** defines:
- `get_db()` — yields an `AsyncSession` from the session factory
- `get_current_user()` — placeholder for now; will validate WhatsApp identity in Task 5.x

**Error handling:**  
Add a global exception handler that catches `MonikaError` subclasses and returns structured JSON error responses. Catches unhandled exceptions and returns a generic 500 with a request ID (never expose stack traces to the client).

**Startup and shutdown events:**  
- On startup: verify database connectivity, verify Redis connectivity, log startup parameters (app version, environment, enabled features)
- On shutdown: close database connection pool, close Redis connection

**Acceptance criteria:**
- [ ] `uvicorn backend.main:app --reload` starts without errors
- [ ] `GET /health` returns `200 {"status": "ok"}`
- [ ] `GET /ready` returns `200` when database and Redis are running
- [ ] `GET /ready` returns `503` when database is down (test by stopping Docker)
- [ ] Every request has an `X-Request-ID` in the response header
- [ ] Every request produces a structured log line including method, path, status, and duration
- [ ] An unhandled exception returns `500` with a `request_id` field but no stack trace

**Testing requirements:**  
Use FastAPI's `TestClient` (or `AsyncClient` from httpx for async tests). Test all three health endpoints. Test the 500 handler. Test that CORS rejects requests from disallowed origins. Verify `X-Request-ID` is present on responses.

---

### Task 4.2 — User Management Service

**Objective:**  
Implement the user registration and management logic. Users are created when they first message Monika on WhatsApp (Task 5.x calls this). User management also handles GDPR operations: data access and account deletion. This must be solid before any other service tries to create or look up users.

**Files to create:**
```
backend/
  services/
    user.py                     # UserService class
  api/
    routers/
      users.py                  # user management endpoints
  schemas/
    user.py                     # Pydantic request/response schemas
  tests/
    unit/
      test_user_service.py
    integration/
      test_user_api.py
```

**Implementation details:**

`UserService` methods:
- `get_or_create_by_whatsapp(waba_id: str, phone_number: str) -> tuple[User, bool]` — the `bool` indicates whether the user was created (True) or already existed (False). Called every time a WhatsApp message arrives — must be fast and idempotent. Stores `SHA-256(phone_number)` as the hash. Never stores the raw phone number.
- `get_by_id(user_id: UUID) -> User | None`
- `update_onboarding_status(user_id: UUID, status: str) -> User`
- `record_terms_acceptance(user_id: UUID, version: str) -> User`
- `export_user_data(user_id: UUID) -> dict` — assembles all data for GDPR subject access request
- `delete_user(user_id: UUID) -> None` — GDPR erasure: soft-delete user, revoke bank tokens, zero out PII, add audit log entry. This is irreversible — add an explicit confirmation step.

**Schemas (`schemas/user.py`):**
- `UserResponse` — what is returned when a user is looked up (no PII in responses — only name if decryption is explicitly requested, and even then only return to authenticated user)
- `TermsAcceptanceRequest` — body for accepting terms
- `DeleteAccountRequest` — requires `confirmation: "I understand this is permanent"` as a deliberate friction mechanism

**Audit logging:**  
Every method that reads or modifies user data must write to `audit_log`. Use the following `event_type` values: `user_created`, `user_data_accessed`, `user_data_exported`, `user_deleted`, `terms_accepted`.

**Hashing:**  
SHA-256 is one-way. When a WhatsApp message arrives, we receive the phone number in the webhook. We hash it immediately and look up by hash. The raw number must not be stored in any variable beyond the immediate hashing step — assign to a local variable, hash it, then lose the reference.

**Acceptance criteria:**
- [ ] `get_or_create_by_whatsapp()` with a new phone number creates a user and returns `(user, True)`
- [ ] `get_or_create_by_whatsapp()` with an existing phone number returns the same user and `(user, False)`
- [ ] Two different phone numbers produce different hashes
- [ ] The same phone number always produces the same hash
- [ ] After `delete_user()`, the user record has `deleted_at` set and PII fields are `null`
- [ ] After `delete_user()`, the phone hash is zeroed out (user cannot be looked up)
- [ ] Every service method writes an entry to `audit_log`
- [ ] `export_user_data()` returns a complete dict including all transactions and conversations

**Testing requirements:**  
Unit tests: test each service method with mocked database. Test the hash is consistent. Test that delete zeroes PII. Integration tests: create user via API, verify database state. Test idempotency of `get_or_create`. Test the full delete flow including audit log entries.

---

### Task 4.3 — Redis Client and Session Management

**Objective:**  
Set up the Redis client and the session/cache layer that every other service depends on. Redis is used for: conversation state, rate limiting, cached aggregations, and onboarding token validation (as a fast lookup before database hit).

**Files to create:**
```
backend/
  core/
    redis.py                    # Redis client + connection pool
    cache.py                    # typed cache wrapper
    rate_limiter.py             # per-user rate limiting
  tests/
    unit/
      test_cache.py
    integration/
      test_rate_limiter.py
```

**Implementation details:**

**`redis.py`:**  
Use `redis.asyncio` (the async Redis client, part of the `redis` package). Create a connection pool on startup. Provide a `get_redis()` dependency for FastAPI (same pattern as `get_db()`).

The Redis URL from settings supports: `redis://localhost:6379` locally, `redis://:password@host:6379` in production.

**`cache.py`** provides a typed wrapper:
- `Cache.get(key: str, type: Type[T]) -> T | None` — deserialises JSON to the given type
- `Cache.set(key: str, value: Any, ttl: int) -> None` — serialises to JSON, sets TTL
- `Cache.delete(key: str) -> None`
- `Cache.get_or_set(key: str, factory: Callable, ttl: int, type: Type[T]) -> T` — cache-aside pattern

Key naming convention: use `{namespace}:{user_id}:{resource}` e.g., `subscriptions:abc123:list`. This makes cache invalidation easier — you can target all keys for a user with `subscriptions:abc123:*`.

**`rate_limiter.py`:**  
Implement a sliding window rate limiter using Redis sorted sets (this is the correct algorithm — fixed window has burst issues). Per-user limits:
- WhatsApp message processing: 20 messages per minute (prevents spam / runaway loops)
- Bank connection attempts: 5 per hour
- Data export requests: 1 per 24 hours

`RateLimiter.check_and_increment(key: str, limit: int, window_seconds: int) -> bool` — returns True if allowed, False if rate limited. Uses Redis `ZADD` + `ZREMRANGEBYSCORE` + `ZCOUNT` in a pipeline.

**Acceptance criteria:**
- [ ] `Cache.set("test:key", {"hello": "world"}, ttl=60)` stores a value in Redis
- [ ] `Cache.get("test:key", dict)` retrieves and deserialises it
- [ ] After TTL expires (test with TTL=1), `Cache.get()` returns `None`
- [ ] `Cache.get_or_set()` calls the factory only on cache miss, not on cache hit
- [ ] Rate limiter allows 20 requests per minute, blocks the 21st
- [ ] Rate limiter is per-user — user A being rate-limited does not affect user B
- [ ] After the window resets, requests are allowed again

**Testing requirements:**  
Unit tests: mock Redis, test cache get/set/delete logic. Integration tests: real Redis, test TTL expiry, test rate limiter blocking and window reset. Test that rate limiter keys expire (no leaked keys).

---

### Task 4.4 — Background Worker Infrastructure

**Objective:**  
Set up the infrastructure for running background jobs — the async workers that sync transactions, categorise them, and run analytics. These workers consume from SQS queues in production, but run as simple in-process loops locally. The local/production parity must be clean.

**Files to create:**
```
backend/
  workers/
    __init__.py
    base.py                     # BaseWorker: message fetching, error handling, retry logic
    transaction_sync.py         # fetches new transactions from TrueLayer
    categorisation.py           # categorises raw transactions
    aggregation.py              # computes monthly summaries (placeholder for Task 6.x)
  core/
    queue.py                    # queue abstraction (local: in-memory asyncio.Queue; prod: SQS)
scripts/
  run-worker.sh                 # starts a named worker process
```

**Implementation details:**

**Queue abstraction (`queue.py`):**  
Define a `Queue` protocol with `send(message: dict)` and `receive() -> AsyncIterator[dict]`. Implement two backends:
- `LocalQueue` — wraps `asyncio.Queue`. Used in local development and tests. Zero external dependencies.
- `SQSQueue` — wraps boto3's SQS client. Used in staging and production. Messages are JSON-serialised.

The `Settings.QUEUE_BACKEND` variable selects which implementation is injected. This means workers can be tested locally without SQS.

**`base.py` BaseWorker:**  
Workers follow a standard pattern:
1. `receive()` — get next message from queue
2. `validate_message()` — check message has required fields
3. `process()` — do the work (implemented by subclass)
4. `ack()` — delete message from queue on success
5. On error: log the error, increment error counter, dead-letter the message after 3 retries

Use `tenacity` for retry logic with exponential backoff. Log each retry attempt. Never silently swallow exceptions.

**`transaction_sync.py`:**  
The sync worker receives a message `{"user_id": "...", "connection_id": "..."}`. It:
1. Loads the bank connection from the database
2. Calls TrueLayer to fetch transactions since `sync_cursor` (placeholder until Task 6.x)
3. Upserts transactions using `TransactionRepository.upsert_many()`
4. Updates `sync_cursor` and `last_sync_at` on the connection
5. Enqueues a message to the categorisation queue for each new transaction

**`run-worker.sh`:**  
Accepts a worker name argument (`./scripts/run-worker.sh transaction_sync`). Sets up the Python path, activates the virtual environment, and runs the worker in a loop with restart-on-crash logic.

**Acceptance criteria:**
- [ ] `LocalQueue` can send and receive messages within the same process
- [ ] `BaseWorker` retries a failing `process()` call up to 3 times with backoff
- [ ] After 3 failures, the message is dead-lettered (moved to error log / dead-letter queue)
- [ ] Worker processes messages one at a time (no accidental parallelism causing duplicate processing)
- [ ] `./scripts/run-worker.sh transaction_sync` starts the worker without errors (even if it immediately waits for messages)
- [ ] A worker that crashes is restarted by the shell script

**Testing requirements:**  
Unit tests: test `BaseWorker` retry logic with a mock `process()` that fails then succeeds. Test that dead-lettering occurs after max retries. Integration tests: send a message to `LocalQueue`, verify the worker receives and processes it.

---

### Task 4.5 — Audit Logging Service

**Objective:**  
Implement the central audit logging service. Every action that accesses, modifies, or deletes user financial data must be logged. This is both a regulatory requirement (FCA expects an audit trail) and a security control (enables incident investigation). Audit logs must be immutable — once written, never changed.

**Files to create:**
```
backend/
  services/
    audit.py                    # AuditService
  core/
    audit_middleware.py         # middleware that auto-logs data access
  tests/
    unit/
      test_audit_service.py
    integration/
      test_audit_immutability.py
```

**Implementation details:**

`AuditService` provides a single method: `log(event_type: str, user_id: UUID | None, event_data: dict, request_context: dict | None)`. It is the only way to write to `audit_log`.

`event_type` values must come from a controlled `AuditEventType` enum — no free-form strings. Controlled vocabulary prevents inconsistency. Events include:
- `USER_CREATED`, `USER_DELETED`, `USER_DATA_EXPORTED`
- `BANK_CONNECTED`, `BANK_DISCONNECTED`, `BANK_TOKEN_REFRESHED`
- `TRANSACTIONS_FETCHED`, `TRANSACTIONS_QUERIED`
- `CONVERSATION_STARTED`, `MESSAGE_RECEIVED`, `MESSAGE_SENT`
- `TOOL_CALLED`, `TOOL_RESULT_RETURNED`
- `ONBOARDING_TOKEN_GENERATED`, `ONBOARDING_TOKEN_USED`
- `CONSENT_GRANTED`, `CONSENT_REVOKED`

`event_data` is a free-form dict but with rules:
- Never include plaintext PII (names, emails, account numbers)
- Never include OAuth tokens or encryption keys
- Always include IDs, counts, and status codes

**Immutability enforcement:**  
Two layers:
1. SQLAlchemy event listener on `AuditLog` that raises `ImmutableRecordError` if `UPDATE` or `DELETE` is attempted via the ORM
2. PostgreSQL RLS policy (set up in Task 3.4) that denies `UPDATE` and `DELETE` for `app_user`

**`audit_middleware.py`:**  
A FastAPI middleware that extracts the request context (IP hash, user agent, request ID) and adds it to the structlog context. This context is automatically available when `AuditService.log()` is called from within a request — no need to manually pass request context through every function call.

IP addresses are hashed (SHA-256) before storage — we need to detect repeated requests from the same source for security analysis, but we do not need to store the actual IP address (GDPR minimisation).

**Acceptance criteria:**
- [ ] `AuditService.log(AuditEventType.USER_CREATED, user_id=..., event_data={...})` inserts a row into `audit_log`
- [ ] Attempting `session.execute(update(AuditLog).where(...))` raises `ImmutableRecordError`
- [ ] Attempting `DELETE FROM audit_log` as `app_user` raises a PostgreSQL permission error
- [ ] `audit_log` rows have `request_id` populated when called within an HTTP request context
- [ ] IP address is stored as a hash, not as a plaintext IP string
- [ ] `AuditEventType` with an unrecognised value raises a validation error at call time

**Testing requirements:**  
Unit tests: test `AuditService.log()` with each event type. Test that unknown event types are rejected. Integration tests: write a log entry, verify it is in the database, verify it cannot be updated or deleted. Verify that attempting to update via SQLAlchemy raises an exception.

---

## Section 5: WhatsApp Integration

### Task 5.1 — WhatsApp Webhook Receiver

**Objective:**  
Receive and validate inbound messages from Meta's WhatsApp Cloud API. This is the entry point for every user interaction. Security is critical: any endpoint that processes inbound messages and triggers AI agent work is a target. HMAC signature verification is the gatekeeping control.

**Files to create:**
```
backend/
  api/
    routers/
      webhooks.py               # GET (verification) + POST (message handling)
  services/
    whatsapp/
      __init__.py
      webhook.py                # WhatsAppWebhookService: parse + validate
      models.py                 # Pydantic models for WhatsApp webhook payload
  tests/
    unit/
      test_webhook_validation.py
    integration/
      test_webhook_endpoint.py
```

**Implementation details:**

**Webhook verification (GET `/webhook/whatsapp`):**  
Meta sends a GET request with `hub.mode`, `hub.verify_token`, and `hub.challenge` query parameters when you first register a webhook URL. Your endpoint must:
1. Check `hub.mode == "subscribe"`
2. Check `hub.verify_token` matches `Settings.WHATSAPP_VERIFY_TOKEN`
3. Return `hub.challenge` as a plain text 200 response
This is a one-time setup, but the endpoint must remain active — Meta can re-verify at any time.

**Webhook message receiver (POST `/webhook/whatsapp`):**  
Every incoming message arrives here. Meta can and does send duplicate webhooks. Processing must be:
1. **Immediately acknowledge** — return `200 OK` within 5 seconds or Meta retries. Never do processing before returning 200.
2. **Validate signature** — compute `HMAC-SHA256(body, app_secret)`, compare to `X-Hub-Signature-256` header. Reject with 403 if invalid. This is the security control that proves the webhook came from Meta.
3. **Deduplicate** — check `wa_message_id` in Redis (TTL 24 hours). If already seen, return 200 but do not process.
4. **Enqueue** — put the validated message onto the inbound message queue. Return 200.

**`models.py`** defines Pydantic models matching Meta's webhook JSON structure. The structure is nested and somewhat complex — model it completely, including the fields you don't use yet. Pydantic will silently ignore extra fields, but you want the fields you care about to be typed.

Key fields to extract from a message webhook:
- `entry[0].changes[0].value.messages[0].id` — the `wa_message_id`
- `entry[0].changes[0].value.messages[0].from` — sender's phone number
- `entry[0].changes[0].value.messages[0].text.body` — message text
- `entry[0].changes[0].value.messages[0].type` — `"text"`, `"interactive"`, etc.
- `entry[0].changes[0].value.metadata.phone_number_id` — your WhatsApp business phone number ID

**Timing:**  
HMAC comparison must use `hmac.compare_digest()` not `==`. This prevents timing attacks where an attacker guesses the signature byte by byte based on how long the comparison takes.

**Acceptance criteria:**
- [ ] `GET /webhook/whatsapp` with correct verify token returns the challenge
- [ ] `GET /webhook/whatsapp` with wrong verify token returns 403
- [ ] `POST /webhook/whatsapp` with valid HMAC signature and a text message returns 200 within 500ms
- [ ] `POST /webhook/whatsapp` with invalid HMAC signature returns 403
- [ ] A second POST with the same `wa_message_id` returns 200 but does not enqueue the message again (deduplication)
- [ ] The endpoint returns 200 even if queue enqueue fails (fail open — better to lose a message than to cause Meta to spam retries)
- [ ] No processing of any kind happens before the 200 response is returned

**Testing requirements:**  
Unit tests: test HMAC validation (valid, invalid, missing header), deduplication logic. Integration tests: POST a real webhook payload with a computed HMAC, verify it enqueues. POST a duplicate, verify no double-processing. Test the timing — measure that the endpoint responds in < 500ms even with Redis lookup.

---

### Task 5.2 — WhatsApp Message Sender

**Objective:**  
Implement the service that sends messages from Monika to users. Every outbound message — whether a response to a query, a proactive alert, or an onboarding link — goes through this service. It must handle Meta's API, retry failures, and respect WhatsApp's rate limits.

**Files to create:**
```
backend/
  services/
    whatsapp/
      sender.py                 # WhatsAppSenderService
      templates.py              # message template definitions
  tests/
    unit/
      test_whatsapp_sender.py
    integration/
      test_whatsapp_send.py     # uses Meta sandbox/test mode
```

**Implementation details:**

`WhatsAppSenderService` methods:

- `send_text(waba_id: str, text: str) -> str` — sends a plain text message. Returns the `wa_message_id` from Meta's response.
- `send_template(waba_id: str, template_name: str, parameters: list[str]) -> str` — sends a pre-approved template message. Used for proactive messages (onboarding links, alerts).
- `send_interactive_buttons(waba_id: str, body: str, buttons: list[dict]) -> str` — sends a message with up to 3 quick-reply buttons.
- `send_reaction(waba_id: str, message_id: str, emoji: str) -> None` — reacts to a message. Used to show "processing" state (e.g., 🤔 while the agent works).
- `mark_read(waba_id: str, message_id: str) -> None` — marks a message as read (shows read receipts to the user).

**API details:**  
All calls go to `https://graph.facebook.com/v19.0/{phone_number_id}/messages` with `Authorization: Bearer {access_token}`. Use `httpx.AsyncClient` with:
- `timeout=30` seconds (Meta's API can be slow)
- Retry on 5xx with `tenacity` (max 3 attempts, exponential backoff 1s/2s/4s)
- Do NOT retry on 4xx — these indicate a configuration error, not a transient failure
- Log every API call with request and response (but redact the phone number in logs)

**Rate limiting:**  
Meta imposes rate limits by phone number (1,000 messages per second at scale; much lower in test). Implement a token bucket rate limiter in Redis specific to outbound messages. At launch: limit to 10 messages per second per WhatsApp number.

**`templates.py`:**  
Define Python dataclasses for each approved template. Template parameters must match the approved template exactly (Meta rejects mismatched parameter counts). Having typed template definitions prevents runtime errors from mismatched parameter lists.

**Typing indicator:**  
Before the agent starts processing, send a "reaction" (🤔 or 👀) to the user's message. This tells the user Monika has received their message and is working on it. WhatsApp does not have a native "typing..." indicator for business accounts in the same way as personal accounts.

**Acceptance criteria:**
- [ ] `send_text()` successfully delivers a message to the Meta test number
- [ ] `send_text()` retries on 503 response and succeeds on second attempt
- [ ] `send_text()` raises `ExternalServiceError` after 3 failed retries
- [ ] `send_text()` does NOT retry on 400 (bad request)
- [ ] `wa_message_id` is returned and can be stored for read receipt tracking
- [ ] Phone number is not visible in log output (redacted)
- [ ] `send_template()` with wrong number of parameters raises `ValueError` before making the API call

**Testing requirements:**  
Unit tests: test retry logic (mock httpx to return 503 twice then 200), test that 400 responses are not retried, test template parameter validation. Integration tests require a Meta test account — skip in CI unless test credentials are available in secrets.

---

### Task 5.3 — Inbound Message Processor

**Objective:**  
Process messages from the inbound queue: look up or create the user, route to the AI agent, and send the response. This is the central orchestration loop that ties everything together. It must be robust — a crash here means a user gets no response.

**Files to create:**
```
backend/
  workers/
    message_processor.py        # consumes inbound message queue
  services/
    conversation.py             # ConversationService: session management + history
  tests/
    unit/
      test_message_processor.py
      test_conversation_service.py
```

**Implementation details:**

**Message processing flow:**
1. Receive message from queue: `{waba_id, phone_number, wa_message_id, text, timestamp}`
2. Get or create user via `UserService.get_or_create_by_whatsapp()`
3. Check if user is in onboarding state — if so, send onboarding link instead of processing query
4. Send "reaction" to acknowledge receipt via `WhatsAppSenderService.send_reaction()`
5. Load conversation history via `ConversationService.get_recent_history()`
6. Call `AgentService.process_message()` (placeholder until Task 7.x — return stub response for now)
7. Send response via `WhatsAppSenderService.send_text()`
8. Save the exchange (user message + assistant response) to `conversations` table
9. Write audit log entry

**`ConversationService`:**
- `get_recent_history(user_id, session_id, limit=20) -> list[ConversationMessage]` — loads the last N turns from the database, formats them for the Claude API (`{"role": "user", "content": "..."}` format)
- `get_or_create_session(user_id) -> str` — returns the current session ID. A new session starts if the user has been inactive for > 2 hours.
- `save_exchange(user_id, session_id, user_message, assistant_response, tool_calls, model, latency_ms)` — saves both sides of the conversation atomically
- `get_user_context(user_id) -> dict` — assembles the user context dict injected into the system prompt: account types, join date, estimated income, number of connected banks

**Session management:**  
Store `{user_id: session_id}` in Redis with a 2-hour TTL. On each message, check if a session exists. If not (first message or timeout), create a new `session_id = uuid4()`. The TTL resets on each message — so a session persists as long as the conversation is active.

**Error handling in the processor:**  
If the agent call fails: send a friendly fallback message ("Sorry, I'm having trouble right now — try again in a moment."). If the WhatsApp send fails: log the error, mark the message as failed in the audit log. If the user lookup fails: this is serious — log, alert, dead-letter the message.

**Acceptance criteria:**
- [ ] A message from a new phone number creates a new user and processes the message
- [ ] A message from an existing user loads their conversation history
- [ ] A 2+ hour gap between messages starts a new session (new session_id)
- [ ] Messages within 2 hours use the same session_id
- [ ] If agent processing fails, a fallback message is sent (not silence)
- [ ] The exchange is saved to `conversations` table after every successful interaction
- [ ] The audit log records `MESSAGE_RECEIVED` and `MESSAGE_SENT` events

**Testing requirements:**  
Unit tests: test session creation/continuation logic, test fallback on agent failure, test conversation history loading. Integration test: send two messages with a mocked agent, verify both are saved to the database with the same session_id.

---

### Task 5.4 — Onboarding Flow (WhatsApp Side)

**Objective:**  
Implement the WhatsApp side of the user onboarding flow: detect a new user, send them the onboarding link, and handle state transitions. The onboarding link triggers the web flow (Task 6.x), but the WhatsApp prompting logic lives here.

**Files to create:**
```
backend/
  services/
    onboarding.py               # OnboardingService
  db/
    repositories/
      onboarding_token.py       # OnboardingTokenRepository
  tests/
    unit/
      test_onboarding_service.py
```

**Implementation details:**

`OnboardingService` methods:
- `generate_onboarding_link(user_id: UUID) -> str` — creates a cryptographically random 256-bit token, stores it in `onboarding_tokens` table with 15-minute expiry, returns the full URL `https://app.monika.ai/connect?token={token}`
- `validate_and_consume_token(token: str) -> UUID` — looks up the token, checks it hasn't expired and hasn't been used, marks it as used, returns the `user_id`. Raises `AuthenticationError` if invalid.
- `handle_new_user_message(user_id: UUID, waba_id: str) -> None` — sends the welcome message and onboarding link via WhatsApp
- `check_onboarding_complete(user_id: UUID) -> bool` — checks if the user has at least one active bank connection

**Onboarding state machine:**  
Users move through these states (stored on the `User` model):
- `pending` → user created, no bank connected — send onboarding link
- `connecting` → onboarding link clicked, bank OAuth in progress
- `active` → at least one bank connection confirmed
- `suspended` → account suspended (future use)

Every message from a `pending` user (except explicit "help" or "stop" commands) triggers a gentle reminder to complete onboarding. After 3 messages without completing onboarding, reduce reminder frequency.

**Token security:**  
- Token must be `secrets.token_urlsafe(32)` (256 bits of entropy from the OS CSPRNG)
- Stored as-is in the database (it is already random — no need to hash a random token)
- 15-minute expiry — short enough to limit attack window, long enough for the user to tap the link
- Single-use — used tokens are marked but not deleted (for audit trail)
- Never log the token value

**Acceptance criteria:**
- [ ] `generate_onboarding_link()` returns a URL containing a 43-character base64url token
- [ ] `validate_and_consume_token()` returns the correct `user_id` for a valid token
- [ ] `validate_and_consume_token()` raises `AuthenticationError` for an expired token
- [ ] `validate_and_consume_token()` raises `AuthenticationError` for an already-used token
- [ ] `validate_and_consume_token()` raises `AuthenticationError` for a non-existent token
- [ ] A `pending` user receives the welcome message and onboarding link on their first message
- [ ] The onboarding token is not visible in any log output

**Testing requirements:**  
Unit tests: test token generation uniqueness (generate 1000, verify all unique), test all invalid token scenarios, test state transitions. Integration test: generate token, validate it, verify it's marked as used, verify second validation fails.

---

## Section 6: Open Banking Integration

### Task 6.1 — TrueLayer Client

**Objective:**  
Build the typed Python client for TrueLayer's API. All TrueLayer calls go through this client — no scattered `httpx` calls in other services. The client handles authentication, token refresh, error mapping, and retries. This is the most external-dependency-heavy component and must be robust to TrueLayer API changes.

**Files to create:**
```
backend/
  services/
    banking/
      __init__.py
      truelayer/
        __init__.py
        client.py               # TrueLayerClient: all API calls
        models.py               # Pydantic models for TrueLayer API responses
        errors.py               # TrueLayer error types + mapping
        auth.py                 # OAuth token exchange + refresh
  tests/
    unit/
      test_truelayer_client.py
    integration/
      test_truelayer_sandbox.py # uses TrueLayer sandbox environment
```

**Implementation details:**

**`client.py` `TrueLayerClient` class:**

Constructor takes an `access_token` (already retrieved and decrypted by the banking service). The client itself does not manage token storage — that is the `BankingService`'s job.

Methods:
- `get_accounts() -> list[TrueLayerAccount]`
- `get_transactions(account_id: str, from_date: date, to_date: date) -> list[TrueLayerTransaction]`
- `get_balance(account_id: str) -> TrueLayerBalance`
- `get_identity() -> TrueLayerIdentity` (optional — some banks support this)

All methods:
- Use `httpx.AsyncClient` with connection pooling
- Set `User-Agent: Monika/1.0` header
- Include `Authorization: Bearer {access_token}`
- TrueLayer's base URL for data API: `https://api.truelayer.com/data/v1`
- Handle `429 Too Many Requests` — back off for the `Retry-After` seconds
- Handle `401 Unauthorized` — raise `TokenExpiredError` (signals to BankingService to refresh)
- Handle `403 Forbidden` — raise `ConsentRevokedError` (user revoked consent at the bank)
- Map all other 4xx/5xx to `TrueLayerAPIError` with the status code and response body

**`models.py`:**  
Model TrueLayer's response format precisely. Key models:
- `TrueLayerTransaction`: `transaction_id`, `amount`, `currency`, `description`, `transaction_type`, `transaction_category`, `timestamp`, `merchant_name` (optional), `merchant_category_code` (optional)
- `TrueLayerAccount`: `account_id`, `account_type`, `display_name`, `currency`, `account_number`
- `TrueLayerBalance`: `current`, `available`, `currency`, `update_timestamp`

**`auth.py`:**  
- `exchange_code_for_tokens(code: str) -> OAuthTokens` — exchanges the auth code from the OAuth callback for access + refresh tokens
- `refresh_access_token(refresh_token: str) -> OAuthTokens` — gets a new access token using the refresh token
- Token endpoint: `https://auth.truelayer.com/connect/token`
- Client credentials: `client_id` and `client_secret` from settings

**Sandbox mode:**  
TrueLayer provides a sandbox environment (`api.truelayer-sandbox.com`) with test banks and test data. The client must use the sandbox when `Settings.TRUELAYER_ENVIRONMENT == "sandbox"`. All integration tests use the sandbox.

**Acceptance criteria:**
- [ ] `get_accounts()` returns a list of `TrueLayerAccount` objects in sandbox
- [ ] `get_transactions()` returns a list of `TrueLayerTransaction` objects in sandbox
- [ ] A `401` response from TrueLayer raises `TokenExpiredError`
- [ ] A `429` response causes the client to pause for `Retry-After` seconds then retry
- [ ] `exchange_code_for_tokens()` returns a valid `OAuthTokens` object in sandbox
- [ ] All API calls include the correct `Authorization` header
- [ ] No TrueLayer credentials appear in log output

**Testing requirements:**  
Unit tests: mock httpx, test error mapping (401 → TokenExpiredError, 403 → ConsentRevokedError, 429 → backoff). Integration tests: use TrueLayer sandbox credentials to make real API calls; verify the response models parse correctly. These integration tests need `TRUELAYER_SANDBOX_ACCESS_TOKEN` in secrets.

---

### Task 6.2 — Banking Service (Consent Management)

**Objective:**  
Implement the high-level banking service that manages the full lifecycle of a bank connection: initiating consent, handling the OAuth callback, storing encrypted tokens, and managing consent expiry. This is the orchestration layer above the TrueLayer client.

**Files to create:**
```
backend/
  services/
    banking/
      service.py                # BankingService: consent lifecycle management
  api/
    routers/
      onboarding.py             # web onboarding endpoints (bank connection flow)
  tests/
    unit/
      test_banking_service.py
    integration/
      test_bank_connection_flow.py
```

**Implementation details:**

`BankingService` methods:
- `initiate_connection(user_id: UUID, redirect_uri: str) -> str` — calls TrueLayer to generate a hosted consent URL. Returns the URL to redirect the user to.
- `handle_oauth_callback(user_id: UUID, code: str) -> BankConnection` — exchanges the code for tokens, fetches initial account data, creates `BankConnection` and `Account` records, stores encrypted tokens, enqueues initial transaction sync.
- `get_connection(connection_id: UUID) -> BankConnection | None`
- `list_connections(user_id: UUID) -> list[BankConnection]`
- `disconnect(connection_id: UUID) -> None` — revokes the TrueLayer consent, deletes tokens, marks connection as `revoked`
- `refresh_token_if_needed(connection_id: UUID) -> str` — checks token expiry; if within 30 minutes of expiry, refreshes and stores the new token. Returns the current valid access token.

**OAuth callback handling in `onboarding.py`:**  
The web onboarding flow callback endpoint is `GET /connect/callback`. It receives `code` and `state` from TrueLayer. The `state` parameter must contain the signed `user_id` (so you know which user is completing the OAuth flow). Sign `state` using `HMAC-SHA256(user_id, SECRET_KEY)` when generating the TrueLayer consent URL; verify it on the callback. This prevents CSRF attacks on the OAuth flow.

**Token storage:**  
`access_token_enc` and `refresh_token_enc` are stored as encrypted bytes using `EncryptedString` from Task 3.3. The decrypted token is used only within the `BankingService` and the `TrueLayerClient` — it must not be serialised to JSON, logged, or returned from API endpoints.

**Consent URL generation:**  
TrueLayer's hosted auth URL includes: `client_id`, `redirect_uri`, `response_type=code`, `scope=accounts balance transactions`, `state={signed_user_id}`. TrueLayer hosts the bank picker — you do not need to build one.

**Acceptance criteria:**
- [ ] `initiate_connection()` returns a valid TrueLayer consent URL
- [ ] After completing the OAuth flow in the TrueLayer sandbox, `handle_oauth_callback()` creates a `BankConnection` record
- [ ] The stored access token is bytes (encrypted) when queried directly from the database
- [ ] Decrypting the stored token returns the original token value
- [ ] `refresh_token_if_needed()` updates the stored token when it's near expiry
- [ ] `disconnect()` marks the connection as `revoked` and removes token bytes from the database
- [ ] An invalid `state` parameter in the OAuth callback raises `AuthenticationError`

**Testing requirements:**  
Unit tests: test state signing/verification, test token storage/retrieval cycle, test refresh logic (mock clock to simulate near-expiry). Integration test: use TrueLayer sandbox to run a full OAuth flow — initiate, complete, verify connection created, verify token decrypts correctly.

---

### Task 6.3 — Transaction Sync Worker

**Objective:**  
Implement the worker that fetches transactions from TrueLayer and saves them to the database. This is the most critical background job — without it, the AI agent has no data to work with. It must handle pagination, deduplication, incremental fetching, and graceful handling of bank API errors.

**Files to create:**
```
backend/
  workers/
    transaction_sync.py         # TransactionSyncWorker (fills in the placeholder)
  services/
    banking/
      sync.py                   # TransactionSyncService: business logic for sync
  tests/
    integration/
      test_transaction_sync.py
```

**Implementation details:**

`TransactionSyncService.sync_connection(connection_id: UUID) -> SyncResult`:

1. Load `BankConnection` and all its `Account` records
2. Call `BankingService.refresh_token_if_needed()` — never call TrueLayer with an expired token
3. For each account:
   a. Determine date range: if `sync_cursor` is set, fetch from `sync_cursor` date to today; if first sync, fetch last 90 days
   b. Call `TrueLayerClient.get_transactions(account_id, from_date, to_date)`
   c. Call `TrueLayerClient.get_balance(account_id)` — update account balance
   d. Transform TrueLayer transactions to our `Transaction` model format (see below)
   e. Compute `dedup_hash` for each transaction: `SHA-256(f"{account_id}:{transaction_date}:{amount}:{raw_description}")`
   f. Call `TransactionRepository.upsert_many()` — insert new, skip existing (ON CONFLICT DO NOTHING on `dedup_hash`)
   g. Enqueue each new transaction to the categorisation queue
4. Update `sync_cursor` to today's date
5. Update `last_sync_at` and `last_sync_status = "success"` on the connection
6. Return `SyncResult` with counts: fetched, inserted, skipped

**Transaction transformation (TrueLayer → our model):**  
- `merchant_name_clean`: apply basic normalisation (strip trailing "LTDPLCCO", normalise "AMZN*XXXXXX" to "Amazon", etc.). This is a lookup dictionary at this stage; ML later.
- `transaction_type`: TrueLayer uses `DEBIT`/`CREDIT` — map to our schema values
- `amount`: TrueLayer returns positive amounts with a separate debit/credit indicator — normalise to signed amounts (debits negative, credits positive)
- `is_salary`: flag transactions matching `salary_indicators` list (keywords like "SALARY", "PAYROLL", "BACS" combined with being a credit > £1000)

**Error handling:**  
- If TrueLayer returns `TokenExpiredError`: call `BankingService.refresh_token_if_needed()`, retry once
- If TrueLayer returns `ConsentRevokedError`: mark connection as `revoked`, do not retry, notify user via WhatsApp
- If TrueLayer returns a 5xx: mark `last_sync_status = "error"`, log the error, retry at next scheduled interval (not immediately — this reduces thundering herd on TrueLayer during outages)

**Scheduling:**  
The sync worker is triggered by EventBridge Scheduler every 6 hours for all active connections. Locally, trigger manually via `./scripts/run-worker.sh transaction_sync --user-id {id}`.

**Acceptance criteria:**
- [ ] First sync fetches 90 days of transactions from TrueLayer sandbox
- [ ] Subsequent sync fetches only transactions since `sync_cursor`
- [ ] Duplicate transactions (same `dedup_hash`) are not inserted twice
- [ ] Balance is updated on the `Account` record after each sync
- [ ] `last_sync_at` and `last_sync_status` are updated after sync
- [ ] A revoked consent triggers a WhatsApp notification and marks the connection as revoked
- [ ] Amounts are negative for debits and positive for credits in our database

**Testing requirements:**  
Integration test: run a full sync against TrueLayer sandbox, verify transactions are in the database, run again, verify no duplicates created. Test error scenarios: mock TrueLayer to return `TokenExpiredError`, verify refresh is triggered. Test the revoked consent path.

---

### Task 6.4 — Transaction Categorisation

**Objective:**  
Categorise raw transactions into meaningful categories (groceries, dining, transport, etc.). This is what makes the AI agent's spending queries accurate. Accuracy is more important than coverage — it's better to leave a transaction uncategorised than to wrongly categorise it.

**Files to create:**
```
backend/
  services/
    categorisation/
      __init__.py
      pipeline.py               # CategorizationPipeline: orchestrates all stages
      rules.py                  # rule-based categorisation (MCC codes + merchant patterns)
      merchant_map.py           # merchant name → category mapping dictionary
      llm_categoriser.py        # LLM fallback for ambiguous transactions
  workers/
    categorisation.py           # worker that processes the categorisation queue
  tests/
    unit/
      test_categorisation_pipeline.py
      test_rules.py
```

**Implementation details:**

**Category taxonomy** (standardise this now — changing it later requires migrating all data):
```
income/salary
income/freelance
income/benefits
income/other

housing/rent
housing/mortgage
housing/utilities
housing/maintenance

transport/public
transport/fuel
transport/parking
transport/taxi

groceries
dining/restaurants
dining/takeaway
dining/coffee

entertainment/streaming
entertainment/cinema
entertainment/events
entertainment/gaming

health/pharmacy
health/gym
health/medical

shopping/clothing
shopping/electronics
shopping/amazon
shopping/general

finance/savings
finance/investments
finance/loans
finance/fees

travel/flights
travel/hotels
travel/holidays

personal/haircare
personal/gifts

education

transfers/internal
transfers/p2p

other/unknown
```

**Stage 1 — MCC code lookup (`rules.py`):**  
Map Merchant Category Codes to categories. MCC is a 4-digit code assigned to merchants by card networks — it's reliable when present. Build a dictionary of the 50–100 most common MCCs. Example: MCC 5411 → `groceries`, MCC 5812 → `dining/restaurants`.

**Stage 2 — Merchant pattern matching (`merchant_map.py`):**  
A dictionary of known merchant names to categories. Cover at minimum: the top 200 UK merchants by transaction volume. Include regex patterns for merchants with variable names (e.g., `AMZN\*.*` → `shopping/amazon`, `UBER \*.*` → `transport/taxi`). Apply patterns in order — most specific first.

**Stage 3 — Claude Haiku LLM fallback (`llm_categoriser.py`):**  
For transactions that don't match stages 1 or 2, or have low confidence, call Claude Haiku in batch mode. Batch 50 transactions per API call (Haiku is cheap; batching amortises latency). The prompt asks Haiku to return a JSON array of `{transaction_id, category, confidence}` objects. Parse the response strictly — if it doesn't parse, mark as `other/unknown`.

Never use Claude Haiku for high-confidence categorisations — only when rules fail. Target: stages 1+2 cover ≥ 85% of transactions; Haiku covers the remaining 15%.

**`CategorizationPipeline.categorise(transaction: Transaction) -> CategoryResult`:**
1. Try MCC lookup → if found, return with `confidence=1.0, method="rule"`
2. Try merchant pattern match → if found, return with `confidence=0.95, method="rule"`
3. If not found: add to batch queue for Haiku; return `None` (the worker collects batches)

**Acceptance criteria:**
- [ ] `TESCO STORES 1234` → `groceries` (merchant pattern)
- [ ] `DELIVEROO LONDON` → `dining/takeaway`
- [ ] `NETFLIX.COM` → `entertainment/streaming`
- [ ] `PAYROLL BACS 12345` → `income/salary`
- [ ] `AMZN*A1B2C3` → `shopping/amazon` (regex pattern)
- [ ] A transaction with MCC 5411 → `groceries` regardless of merchant name
- [ ] An unknown merchant falls through to LLM categorisation
- [ ] LLM response that doesn't parse as valid JSON results in `other/unknown`, not an exception
- [ ] Categorisation result includes `confidence` and `method` fields

**Testing requirements:**  
Unit tests: test each stage with sample transaction descriptions. Test the regex patterns with common variants. Test the LLM fallback path (mock Haiku response). Test malformed LLM response handling. Integration test: run the full pipeline on 50 real transactions from the sandbox; manually verify categorisations are correct (this is a qualitative check, not automated).

---

### Task 6.5 — Web Onboarding Flow (Frontend)

**Objective:**  
Build the single web page that users visit to connect their bank. This is a security-sensitive flow (it handles OAuth tokens) on a mobile browser. It must be simple, fast, and clearly trustworthy. No design flair — clarity and trust signals matter more.

**Files to create:**
```
frontend/
  app/
    connect/
      page.tsx                  # bank connection landing page
      callback/
        page.tsx                # OAuth callback handler
      success/
        page.tsx                # post-connection success screen
      error/
        page.tsx                # error screen with clear next steps
  components/
    BankConnectButton.tsx       # CTA button with loading states
    TrustBadges.tsx             # FCA authorised, security badges
    ErrorMessage.tsx            # user-friendly error display
  lib/
    api.ts                      # (expand from scaffold: add onboarding endpoints)
```

**Implementation details:**

**`connect/page.tsx`** (the landing page, accessed via the WhatsApp link):
1. Extract `token` from URL query parameter
2. Call backend `POST /api/onboarding/validate-token` to verify the token is valid
3. If invalid/expired: redirect to `/connect/error?reason=expired`
4. If valid: show the connection screen:
   - Monika logo and name
   - "Connect your bank to get started" headline
   - Brief explanation of what access is requested (read-only, what data, why)
   - "Connect securely" button (triggers the TrueLayer redirect)
   - FCA authorised badge, padlock icon, "Your bank login details are never shared" text

The page must not show anything until the token is validated — prevent the page from being rendered without a valid token (this prevents phishing pages that mimic the UI without a real token).

**`connect/callback/page.tsx`** (returned to after TrueLayer OAuth):
1. Extract `code` and `state` from URL parameters
2. Call backend `POST /api/onboarding/callback` with the code and state
3. Show a loading spinner — do not flash the URL parameters to the user
4. On success: redirect to `/connect/success`
5. On error: redirect to `/connect/error?reason=connection_failed`

**`connect/success/page.tsx`:**
- "You're all set! 🎉" (the one acceptable use of an emoji in the UI)
- "Go back to WhatsApp and ask me anything about your finances."
- Deeplink back to WhatsApp conversation if possible (`whatsapp://send?phone={business_number}`)
- This page has no further interactivity — users should go to WhatsApp

**Security requirements for the frontend:**
- CSP headers block inline scripts and external resources
- The `token` in the URL query parameter must be removed from the URL after validation (use `window.history.replaceState()`) to prevent it appearing in browser history or server logs
- The `code` from the OAuth callback must be sent to the backend immediately and then removed from the URL

**Mobile optimisation:**  
This page is opened on a phone. Requirements:
- Single column layout, large tap targets (min 44px)
- No horizontal scrolling
- Text is readable without zooming (min 16px body text)
- Loading states for all async operations (no blank screens)
- Fast — no heavy JavaScript bundles

**Acceptance criteria:**
- [ ] Visiting `/connect?token=validtoken` shows the connection landing page
- [ ] Visiting `/connect?token=expiredtoken` redirects to the error page
- [ ] Visiting `/connect?token=` (no token) redirects to the error page
- [ ] The "Connect securely" button redirects to TrueLayer's hosted OAuth flow
- [ ] After completing TrueLayer OAuth, the user is redirected back to `/connect/callback`
- [ ] The callback page calls the backend and redirects to `/connect/success`
- [ ] The URL token parameter is removed from the browser history after validation
- [ ] The page renders correctly on a 375px viewport (iPhone SE)
- [ ] `Lighthouse` accessibility score > 90

**Testing requirements:**  
Test on a real mobile device (not just responsive mode in Chrome DevTools). Test the expired token path. Test on slow 3G connection (Chrome DevTools throttling). Run Lighthouse.

---

## Section 7: AI Agent Framework

### Task 7.1 — Anthropic Client and Base Agent

**Objective:**  
Set up the Anthropic SDK integration and the base agent class that manages the conversation loop. The agent is the most complex component in the system. Starting with a clean abstraction here makes everything else easier to build and test.

**Files to create:**
```
backend/
  services/
    agent/
      __init__.py
      client.py                 # Anthropic API client wrapper
      base.py                   # BaseAgent: conversation loop management
      prompts/
        __init__.py
        system.py               # system prompt builder
        disclaimers.py          # FCA disclaimer constants
  tests/
    unit/
      test_agent_base.py
    integration/
      test_agent_client.py
```

**Implementation details:**

**`client.py` `AnthropicClient`:**  
Wraps the official `anthropic` Python SDK. Provides:
- `create_message(system: str, messages: list, tools: list, model: str, max_tokens: int) -> MessageResponse`
- Model selection: default to `claude-sonnet-4-6` for conversation; `claude-haiku-4-5-20251001` for batch categorisation
- Retry on rate limits (`anthropic.RateLimitError`) with exponential backoff
- Retry on overload (`anthropic.APIStatusError` with 529) with backoff
- Log every call: model, input tokens, output tokens, latency (no message content in logs — PII risk)
- Raise `ExternalServiceError` after max retries

**`base.py` `BaseAgent`:**  
The agent loop:
```
1. Build system prompt (user context injected here)
2. Load conversation history from ConversationService
3. Add current user message to history
4. Call Anthropic API
5. If response contains tool_use blocks:
   a. Extract all tool calls
   b. Execute all tool calls (in parallel using asyncio.gather)
   c. Add tool results to the message history
   d. Call Anthropic API again with tool results
   e. Repeat until response contains no tool calls (or max 5 iterations)
6. Extract final text response
7. Apply post-processing (disclaimer injection, response validation)
8. Return final response
```

**Tool call parallelism:**  
When Claude returns multiple tool calls in one response (e.g., `get_income_summary` AND `get_upcoming_commitments` AND `get_current_balance`), execute them all simultaneously with `asyncio.gather()`. This is the correct behaviour per the Claude API spec — do not execute tool calls sequentially by default.

**Max iterations guard:**  
Set a hard limit of 5 tool-call iterations per message. If the agent hasn't produced a text response after 5 rounds of tool calls, return a fallback: "I'm having trouble answering that right now — could you rephrase your question?" Log a warning with the full tool call chain for debugging.

**`system.py` `SystemPromptBuilder`:**  
Builds the system prompt dynamically. Takes `user_context: dict` as input. Sections:
1. Identity and persona (static)
2. Constraints and FCA rules (static)
3. User context (dynamic — injected from database)
4. Current date and user's local time (dynamic)
5. Tool availability note (static — Claude already knows from the tool schemas)

The final prompt is cached in Redis for 15 minutes per user — it changes rarely (only when user adds a bank or their context changes), so there's no need to rebuild it on every message.

**`disclaimers.py`:**  
Define the exact FCA disclaimer text as a constant. Never paraphrase it in the system prompt. The system prompt instructs Claude: "When providing mortgage affordability estimates, savings projections, or any forward-looking financial calculations, append EXACTLY this disclaimer with no modifications: [constant text]". Using `EXACTLY` reduces hallucinated disclaimer variations.

**Acceptance criteria:**
- [ ] `AnthropicClient.create_message()` returns a valid response using the Claude API
- [ ] A response containing tool use blocks triggers tool execution
- [ ] Multiple tool calls in one response are executed in parallel (verify via timing — should not be sequential)
- [ ] After 5 iterations without a text response, the fallback message is returned
- [ ] Token counts (input + output) are logged for every API call
- [ ] The system prompt includes the user's name and account type when user context is provided

**Testing requirements:**  
Unit tests: test the tool-call loop logic (mock API responses), test the max iteration guard, test parallel tool execution (verify asyncio.gather is called with multiple coroutines). Integration test: send a real message to Claude with a mocked tool that returns pre-defined data; verify the agent uses the tool result in its response.

---

### Task 7.2 — Tool Implementation: Spending Queries

**Objective:**  
Implement the first set of agent tools — spending queries. These are the highest-frequency user requests and the core value of the product. Get these right first: they validate the tool calling architecture end-to-end with real data.

**Files to create:**
```
backend/
  services/
    agent/
      tools/
        __init__.py             # ToolRegistry: maps tool names to implementations
        schemas.py              # tool input/output Pydantic schemas
        spending.py             # get_spending_by_category, get_merchant_history
        subscriptions.py        # get_subscriptions
        trends.py               # get_spending_trends
      tool_executor.py          # validates input, calls tool, validates output, logs
```

**Implementation details:**

**`ToolRegistry`:**  
A dictionary mapping tool name strings (as Claude calls them) to async functions. Tools are registered via a `@tool` decorator that also validates the schema and adds to the registry. The `tool_executor.py` looks up the tool by name and calls it.

**`tool_executor.py` `ToolExecutor.execute(tool_name: str, tool_input: dict, user_id: UUID) -> dict`:**

Critical security step: **validate `user_id` before every tool call**. The `user_id` passed to this function comes from the authenticated session — it is NOT taken from `tool_input`. Even if Claude constructs a tool call with a different `user_id` in the input (e.g., due to prompt injection), the `ToolExecutor` ignores it and uses the session `user_id`. This is the most important security invariant in the agent.

Steps:
1. Look up tool in `ToolRegistry` — raise `ToolNotFoundError` if unknown
2. Validate `tool_input` against the tool's input schema (Pydantic) — raise `ToolInputValidationError` if invalid
3. Inject `user_id` (from session, not from input)
4. Execute the tool function
5. Validate output against the tool's output schema
6. Write audit log entry: `TOOL_CALLED` with tool name and (sanitised) inputs
7. Return the result dict

**`spending.py` tool implementations:**

`get_spending_by_category(user_id, categories, date_from, date_to, group_by=None)`:
- Query `transactions` table: filter by `user_id`, `transaction_date` range, `category IN categories`
- Aggregate: total amount, transaction count
- If `group_by` specified: break down by day/week/month (use PostgreSQL `date_trunc`)
- Add context: compare to previous equivalent period (e.g., if querying this month, also return last month total)
- Return: `{total: float, count: int, top_merchants: list, trend_vs_prior: float, breakdown: list}`

`get_merchant_history(user_id, merchant_query, date_from, date_to)`:
- Fuzzy match `merchant_name_clean` using PostgreSQL `ILIKE '%{merchant_query}%'`
- Return: `{merchant: str, total: float, count: int, transactions: list, first_seen: date, last_seen: date}`
- Limit to 50 transactions in the return — the agent doesn't need every transaction, just the summary plus enough for context

**`subscriptions.py`:**

`get_subscriptions(user_id, include_annual=True, sort_by="amount")`:
- Query `recurring_payments` table for active subscriptions for this user
- If `recurring_payments` is empty (hasn't been computed yet), run a lightweight detection query: find transactions where `is_subscription = True` from the `transactions` table
- Calculate annual cost (multiply monthly by 12, or use actual data for annual subscriptions)
- Return: `{total_monthly: float, total_annual: float, count: int, items: list[{name, amount, frequency, last_seen, next_expected}]}`

**Date handling:**  
Tools receive `date_from` and `date_to` as strings. Validate and parse them. Cap `date_from` to 90 days ago (or the user's earliest transaction date) — never allow unbounded queries.

**Acceptance criteria:**
- [ ] `get_spending_by_category(user_id, ["groceries"], "2024-01-01", "2024-01-31")` returns a sum of all grocery transactions in January
- [ ] Results are always for the authenticated `user_id`, regardless of what `tool_input` contains
- [ ] `get_merchant_history(user_id, "TESCO")` matches "TESCO STORES 1234", "TESCO ONLINE", etc.
- [ ] `get_subscriptions()` returns Netflix, Spotify, etc. if present in transactions
- [ ] A tool call with an invalid date range raises `ToolInputValidationError`
- [ ] Every tool call creates an `TOOL_CALLED` audit log entry
- [ ] Tool execution is logged with tool name and duration (ms)

**Testing requirements:**  
Unit tests: test each tool with mocked database returning known data; verify output format. Test `user_id` injection (pass a different `user_id` in `tool_input`, verify the session user_id is used instead). Integration tests: seed the database with known transactions, run each tool, verify correct aggregations.

---

### Task 7.3 — Tool Implementation: Financial Analysis

**Objective:**  
Implement the higher-value analysis tools: safe-to-spend calculation, income detection, upcoming commitments, anomaly detection, and mortgage affordability. These tools are where Monika differentiates from a simple transaction search — they require multi-step reasoning over financial data.

**Files to create:**
```
backend/
  services/
    agent/
      tools/
        safe_to_spend.py        # get_safe_to_spend
        income.py               # get_income_summary
        commitments.py          # get_upcoming_commitments
        anomaly.py              # get_anomalous_transactions
        affordability.py        # calculate_mortgage_affordability
    financial/
      safe_to_spend.py          # SafeToSpendCalculator (business logic, separate from tool)
      income_detector.py        # IncomeDetector (business logic)
      affordability.py          # AffordabilityCalculator (business logic)
```

**Implementation details:**

**Safe-to-spend calculation (`financial/safe_to_spend.py`):**  
`SafeToSpendCalculator.calculate(user_id, horizon_days=7) -> SafeToSpendResult`:
1. Get current balance across all active accounts (from `accounts.available_balance`)
2. Get upcoming known commitments in the next `horizon_days` days: query `recurring_payments` where `next_expected_date <= today + horizon_days`
3. Get predicted upcoming commitments: for subscriptions with `frequency=monthly`, predict the next charge date based on `last_seen_date + 30 days`
4. Buffer: add 10% safety buffer on top of upcoming commitments (users forget things)
5. Month-to-date spending pace: if user has spent 80% of their typical monthly discretionary spend in the first 15 days of the month, flag this
6. Savings target: if user has an active savings goal, reserve that amount
7. `safe_to_spend = balance - upcoming_commitments_total - (savings_target_remaining) - buffer`
8. Return: breakdown of each deduction so the agent can explain the calculation

**Income detection (`financial/income_detector.py`):**  
`IncomeDetector.detect(user_id, months=3) -> IncomeResult`:
- Query credits > £500 with `is_salary=True` or matching salary keywords
- Group by approximate date (salary arrives on similar dates each month)
- Detect monthly regularity: if 2+ credits of similar amount on similar dates → likely salary
- Estimate gross from net using HMRC's 20% basic rate assumption (note as estimate)
- Return: `{estimated_net_monthly: float, confidence: str, salary_transactions: list, other_income: list}`
- Do NOT be overconfident — financial data is messy; return a range if uncertain

**Upcoming commitments (`tools/commitments.py`):**  
`get_upcoming_commitments(user_id, horizon_days=30)`:
- Combine: known direct debits (recurring transactions), predicted subscription charges, any loan/mortgage payments detected
- Sort by date ascending
- Flag "high priority" for amounts > £100 or rent/mortgage
- Return: `{total: float, count: int, items: list[{name, amount, date, confidence, is_high_priority}]}`

**Anomaly detection (`tools/anomaly.py`):**  
`get_anomalous_transactions(user_id, min_anomaly_score=0.7, limit=10)`:
- Query `transactions` where `anomaly_score >= min_anomaly_score`, order by score desc
- The `anomaly_score` is computed by the anomaly detection worker (a separate background job)
- For MVP, the anomaly worker uses rule-based scoring: duplicate charges, amount > 3x merchant average, new subscription merchant, unusually large debit
- Return: `{items: list[{transaction, reason, score}]}` where `reason` is a human-readable explanation of why it was flagged

**Mortgage affordability (`tools/affordability.py`):**  
`calculate_mortgage_affordability(user_id, target_property_value, deposit_amount=None, mortgage_term_years=25) -> AffordabilityResult`:
- Get estimated income from `IncomeDetector`
- Estimate gross income: `net_monthly * 12 / 0.8` (rough; varies by tax code)
- Standard lender multipliers: 4x–4.5x annual gross income
- Current average 2-year fixed rate (hardcoded at launch, make it configurable): ~4.5%
- Monthly repayment: standard annuity formula `P * r * (1+r)^n / ((1+r)^n - 1)`
- After-mortgage budget: `net_monthly - mortgage_payment - other_fixed_commitments`
- Return: `{max_borrowing_estimate: float, monthly_repayment_estimate: float, after_mortgage_monthly: float, deposit_required: float, affordability_rating: str, disclaimer: str}`
- `disclaimer` field contains the mandatory FCA disclaimer text — the tool returns it so Claude cannot forget to include it

**Acceptance criteria:**
- [ ] `get_safe_to_spend()` with £2000 balance and £800 upcoming DDs returns ≤ £1200
- [ ] `get_safe_to_spend()` includes the buffer calculation in the breakdown
- [ ] `get_income_summary()` correctly identifies a monthly £2800 salary credit as income
- [ ] `calculate_mortgage_affordability()` result includes the FCA disclaimer in the `disclaimer` field
- [ ] `get_anomalous_transactions()` returns a transaction that is 5x the merchant's usual amount
- [ ] All tools return within 500ms on a database with 10,000 transactions

**Testing requirements:**  
Unit tests: test each calculator with known inputs and expected outputs (these are mathematical functions — they should be deterministic). Test edge cases: no income detected, zero balance, no upcoming commitments. Integration tests: seed the database with specific transaction patterns (known salary, known DDs, known anomaly) and verify each tool returns the expected result.

---

### Task 7.4 — Agent Integration and End-to-End Flow

**Objective:**  
Wire the agent into the message processing pipeline and verify the end-to-end flow: WhatsApp message → agent → tool calls → database → response → WhatsApp. This is the first complete working version of the product.

**Files to create:**
```
backend/
  services/
    agent/
      monika_agent.py           # MonikaAgent: the production agent instance
      response_validator.py     # validates agent responses before sending
  tests/
    integration/
      test_end_to_end.py        # full flow integration test
      test_agent_with_tools.py  # agent + real tools + real database
```

**Implementation details:**

**`monika_agent.py` `MonikaAgent`:**  
Instantiates the `BaseAgent` with:
- The full tool set (all tools from Tasks 7.2 and 7.3)
- The `SystemPromptBuilder`
- The `ToolExecutor` with user context injected
- `AnthropicClient`

Exposes a single method: `process(user_id: UUID, message: str, session_id: str) -> AgentResponse`.

`AgentResponse` contains: `text: str`, `tool_calls_made: list[str]`, `model: str`, `input_tokens: int`, `output_tokens: int`, `latency_ms: int`.

**`response_validator.py` `ResponseValidator`:**  
Before the agent response is sent to the user, run these checks:
1. **Number hallucination check:** Extract all numbers from the response. For each number, verify it appears in at least one tool result returned during this conversation turn. If a number appears in the response but not in any tool result, flag it. Log a warning and replace with: "I wasn't able to verify that figure — let me check again."
2. **Disclaimer check:** If the response triggered the `calculate_mortgage_affordability` tool, verify the disclaimer text is present in the response. If missing, append it.
3. **Length check:** If the response is > 500 words, flag it. Long responses are usually a sign the agent is over-explaining. Log for review (do not auto-truncate — truncating financial information could be dangerous).
4. **Sensitive data check:** Scan the response for patterns that look like full account numbers, sort codes, or card numbers. These should never appear in a response — they should always be masked.

**WhatsApp message formatting:**  
WhatsApp supports a limited subset of formatting:
- `*bold*` — wrap numbers and merchant names in bold
- `_italic_` — use sparingly for emphasis
- No markdown tables — use bullet lists instead
- Emoji: permitted but used sparingly (1–2 per response max)
- Line breaks: use double `\n` for visual paragraph separation

Add a `format_for_whatsapp(text: str) -> str` function that post-processes the agent's response:
- Convert any markdown formatting to WhatsApp formatting
- Ensure line breaks are correct
- Truncate to 4096 characters (WhatsApp's message limit) with a note if truncated

**Acceptance criteria:**
- [ ] Sending "how much did I spend on groceries last month?" results in a WhatsApp message with the correct grocery total (from seeded test data)
- [ ] The response is delivered in < 10 seconds end-to-end
- [ ] A response containing a mortgage estimate includes the FCA disclaimer
- [ ] A number in the response that doesn't appear in tool results triggers a validation warning (logged)
- [ ] The conversation is saved to the database after every exchange
- [ ] Sending a second message in the same session references context from the first message

**Testing requirements:**  
Integration test `test_end_to_end.py`:
1. Seed the database with 3 months of test transactions for a test user
2. Send "how much did I spend last month?" via the message processor (bypassing WhatsApp — use the internal service directly)
3. Verify the response contains a number that matches the seeded data total
4. Send a follow-up question ("what was my biggest category?") and verify the agent uses the same session context
5. Verify both exchanges are saved in the database
6. Verify the audit log has entries for both messages

---

### Task 7.5 — Proactive Alerts and Anomaly Detection Worker

**Objective:**  
Implement the background job that analyses transactions for anomalies and sends proactive WhatsApp alerts. This is the "wow moment" feature — when Monika notices something the user didn't ask about and proactively tells them. It builds trust and creates word-of-mouth.

**Files to create:**
```
backend/
  workers/
    anomaly_detection.py        # AnomalyDetectionWorker
    aggregation.py              # AggregationWorker: nightly monthly summaries
  services/
    financial/
      anomaly_scorer.py         # AnomalyScorer: computes anomaly scores
    notification.py             # NotificationService: decides what to send, when
  tests/
    unit/
      test_anomaly_scorer.py
    integration/
      test_anomaly_worker.py
```

**Implementation details:**

**`anomaly_scorer.py` `AnomalyScorer`:**  
Runs on each new transaction batch after sync. Scoring rules (each contributing to a 0.0–1.0 score):
- **Duplicate charge:** Same merchant, same amount, within 5 days → score 0.9
- **Large deviation:** Amount > 3x the merchant's average transaction amount → score 0.7–0.85 (scale with deviation size)
- **New subscription:** `is_subscription=True` but merchant has not appeared before → score 0.8
- **Unusual hour:** Transaction at 2–5am UK time for a non-travel merchant → score 0.5 (less important on its own)
- **Large round-number debit:** Round amounts > £500 from unfamiliar merchants → score 0.6

`score_transaction(transaction: Transaction, user_history: UserTransactionHistory) -> float`

The `UserTransactionHistory` pre-computes merchant averages, frequency, and first-seen dates. It is loaded once per user per anomaly detection run, not per transaction (performance).

**`anomaly_detection.py` `AnomalyDetectionWorker`:**  
Runs nightly (via EventBridge Scheduler). For each active user:
1. Load new transactions (since last anomaly scan)
2. Load the user's transaction history for context
3. Score each new transaction
4. Save `anomaly_score` to the transaction record
5. If any transaction score > 0.8, add to "alert queue" for the user
6. Send at most 1 proactive alert per user per day (rate limited in Redis)

**`notification.py` `NotificationService`:**  
Decides what to send and when:
- Batch multiple anomalies into a single message (don't send 5 separate messages)
- Prioritise: duplicate charges first, new unknown subscriptions second, large amounts third
- Apply quiet hours: no proactive messages between 10pm and 8am UK time
- Check user opt-in status before sending any proactive message

`format_alert_message(anomalies: list[AnomalyAlert]) -> str` — formats the alert using WhatsApp-compatible text.

**`aggregation.py` `AggregationWorker`:**  
Runs nightly. For each active user, recompute `monthly_summaries` for the current and previous month:
1. Aggregate transactions by category for the month
2. Calculate totals, counts
3. Upsert into `monthly_summaries` table

This pre-computation is what makes the agent's spending queries fast — instead of aggregating thousands of transactions at query time, the agent queries pre-computed summaries.

**Acceptance criteria:**
- [ ] A duplicate charge (same merchant, same amount, 2 days apart) gets an anomaly score > 0.85
- [ ] A typical grocery transaction (normal amount, known merchant) gets an anomaly score < 0.1
- [ ] A user with 3 anomalies receives a single WhatsApp message listing all 3
- [ ] No alert is sent between 10pm and 8am
- [ ] No more than 1 proactive alert per user per day
- [ ] `AggregationWorker` correctly computes monthly totals for a seeded dataset
- [ ] Monthly summary matches the sum of individual transactions (verify mathematically)

**Testing requirements:**  
Unit tests: test each anomaly scoring rule independently. Test the quiet hours logic (mock datetime). Integration tests: seed transactions including a deliberate duplicate charge and a large anomaly; run the anomaly worker; verify the anomaly scores are set correctly and the notification is generated.

---

## Phase 1 Completion Checklist

Before declaring Phase 1 complete, verify all of the following:

### End-to-End Test
- [ ] New user sends a WhatsApp message for the first time
- [ ] User receives the welcome message and an onboarding link
- [ ] User clicks the link on mobile, connects a bank via TrueLayer sandbox
- [ ] Monika sends "I've connected to [Bank]. I can see [N] transactions." message
- [ ] User asks "how much did I spend on groceries last month?"
- [ ] Monika responds with the correct total within 10 seconds
- [ ] User asks "what subscriptions am I paying for?"
- [ ] Monika responds with the list
- [ ] User asks "how much can I safely spend this weekend?"
- [ ] Monika responds with a calculated figure and breakdown
- [ ] Monika sends a proactive alert for a seeded duplicate charge

### Security Checks
- [ ] No plaintext phone numbers in the database
- [ ] No OAuth tokens in plaintext in the database
- [ ] RLS prevents cross-user data access (verified by test)
- [ ] HMAC verification blocks unsigned webhook payloads
- [ ] Onboarding tokens expire and cannot be reused
- [ ] Audit log cannot be modified or deleted

### Code Quality
- [ ] `pre-commit run --all-files` passes with no issues
- [ ] `pytest` passes with > 80% coverage on business logic
- [ ] `mypy` passes with no errors
- [ ] No `TODO` or `FIXME` comments in code that shipped
- [ ] `uv lock --check` passes (lockfile up to date)

### Operations
- [ ] The system recovers from a database restart without losing any messages
- [ ] The system recovers from a Redis restart (sessions recreated cleanly)
- [ ] Worker crash and restart loses at most one in-flight message
- [ ] All service startup failures produce clear error messages with the missing configuration variable named explicitly

---

## Phase 2 Preview (Not in Scope Now)

After Phase 1 is complete and the system is live with real users, Phase 2 will address:
- Production AWS deployment (Terraform, ECS, RDS, ElastiCache)
- Monitoring and alerting (CloudWatch alarms, PagerDuty)
- Transaction categorisation ML model (trained on accumulated real data)
- Multi-bank support (up to 3 connections per user)
- Budget setting and savings goal tracking
- User feedback and rating system
- Consent renewal reminders (proactive, before expiry)
- SOC 2 Type II audit readiness

---

*This document is a living specification. Update task acceptance criteria as implementation reveals edge cases not anticipated here.*
