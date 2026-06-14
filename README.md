# Monika — AI-Powered Personal Finance Assistant

WhatsApp-native financial intelligence for UK consumers, built on Open Banking.

**Stack:** TypeScript · Node.js · Fastify · PostgreSQL · Prisma · Redis

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 10 | Bundled with Node.js |
| Docker + Compose | ≥ 25 | [docs.docker.com](https://docs.docker.com/get-docker/) |

---

## Running Locally

### 1. Clone and install

```bash
git clone <repo-url> monika
cd monika
npm install
```

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 16** on `localhost:5432`
- **Redis 7** on `localhost:6379`
- **Adminer** (database UI) on [localhost:8080](http://localhost:8080)

Wait a few seconds for PostgreSQL to initialise, then verify:

```bash
docker compose ps           # all services should show "healthy"
docker compose logs postgres --tail 5
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set the minimum values required to start:

```env
DATABASE_URL=postgresql://monika:monika@localhost:5432/monika
SECRET_KEY=<any-string-at-least-32-chars>
ENCRYPTION_KEY=<64-char-hex-string>   # openssl rand -hex 32
```

The following can be left blank until you implement those integrations:
- `TRUELAYER_*` — needed for Open Banking (Task 6)
- `ANTHROPIC_API_KEY` — needed for AI agent (Task 7)
- `WHATSAPP_*` — needed for WhatsApp integration (Task 5)

### 4. Apply database migrations

```bash
npm run db:migrate
```

This creates all tables, indexes, and enums. Prisma also regenerates the
TypeScript client automatically.

To inspect the database visually:

```bash
npm run db:studio     # opens Prisma Studio at localhost:5555
# OR open Adminer at localhost:8080
# Server: postgres, User: monika, Password: monika, Database: monika
```

### 5. Start the dev server

```bash
npm run dev
```

The server starts on [http://localhost:3000](http://localhost:3000).
`tsx watch` hot-reloads on file changes — no restart needed during development.

---

## Verifying It Works

Run these commands to verify each part of the system:

```bash
# Liveness check — is the server alive?
curl http://localhost:3000/health

# Readiness check — is the database connected?
curl http://localhost:3000/ready

# WhatsApp webhook verification (Meta calls this during setup)
curl "http://localhost:3000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=ping"
# → 403 (expected — WHATSAPP_VERIFY_TOKEN not set)

# WhatsApp inbound message — HMAC signature is mandatory; an unsigned
# request is rejected (this is a security control, not a stub):
curl -X POST http://localhost:3000/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"entry":[]}'
# → 403 (expected — missing X-Hub-Signature-256)

# AI agent chat — fully wired (classify → route → analytics → validate):
curl -X POST http://localhost:3000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"How much did I spend on groceries?","userId":"<uuid>"}'
# → a data-driven natural-language reply (or a connect-bank prompt
#   if the user has no linked account)
```

For the **full automated end-to-end smoke test** (simulates onboarding →
connect mock bank → ask spending/subscription/balance questions → check the
admin dashboard), start the server and run:

```bash
npm run e2e
```

Expected `/health` response:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "startedAt": "2026-06-07T...",
  "uptime": 3
}
```

Expected `/ready` response (database connected):
```json
{
  "status": "ok",
  "checks": {
    "database": { "ok": true, "latencyMs": 4 }
  }
}
```

---

## Project Structure

```
monika/
├── src/
│   ├── index.ts              # Server entry point — starts Fastify, handles shutdown
│   ├── app.ts                # App factory — registers plugins and routes
│   ├── config.ts             # Env config validated with Zod (fails fast on startup)
│   ├── logger.ts             # Pino logger — pretty in dev, JSON in production
│   ├── lib/
│   │   └── prisma.ts         # PrismaClient singleton
│   ├── plugins/
│   │   └── prisma.ts         # Fastify plugin — attaches prisma to app instance
│   └── routes/
│       ├── health.ts         # GET /health (liveness), GET /ready (readiness)
│       ├── webhooks/
│       │   └── whatsapp.ts   # POST /webhooks/whatsapp — stub, Task 5.1
│       ├── banking/
│       │   └── index.ts      # /banking/connect, /banking/callback — stub, Task 6.2
│       └── agent/
│           └── index.ts      # POST /agent/chat — stub, Task 7.1
├── prisma/
│   ├── schema.prisma         # Full database schema (9 models, 12 enums)
│   ├── migrations/           # Generated SQL migrations (committed to git)
│   └── seed.ts               # Database seeder (placeholder)
├── scripts/
│   ├── setup.sh              # One-shot setup for fresh clones
│   └── reset-db.sh           # Wipe and recreate local database
├── docs/
│   ├── ARCHITECTURE.md       # Full product and technical architecture
│   └── IMPLEMENTATION_PLAN.md # Phase-by-phase build plan (35 tasks)
├── docker-compose.yml        # PostgreSQL, Redis, Adminer
├── .env.example              # All environment variables documented
├── package.json
├── tsconfig.json
└── .eslintrc.json
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server (`node dist/index.js`) |
| `npm run typecheck` | Type-check without emitting files |
| `npm run lint` | ESLint — zero warnings policy |
| `npm run lint:fix` | ESLint auto-fix |
| `npm run format` | Prettier format |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:migrate:deploy` | Apply migrations (CI/production — no interactive prompt) |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run db:seed` | Seed development data |
| `./scripts/reset-db.sh` | Wipe and recreate local database (confirms before running) |

---

## Database Schema

Nine models covering the full domain:

| Model | Description |
|-------|-------------|
| `User` | Core user record — phone stored as SHA-256 hash only |
| `BankConnection` | TrueLayer/Yapily OAuth consent — tokens encrypted at rest |
| `Account` | Individual bank accounts within a connection |
| `Transaction` | All transactions — categorised, enriched, deduplicated |
| `Conversation` | Chat history with the AI agent, including tool calls |
| `MonthlySummary` | Pre-computed monthly aggregations (nightly refresh) |
| `RecurringPayment` | Detected subscriptions and regular payments |
| `AuditLog` | Immutable audit trail — BigInt ID for ordering guarantees |
| `OnboardingToken` | Short-lived (15min), single-use tokens for bank connection flow |

Encrypted fields (`*Enc`) store ciphertext as `BYTEA`. Encryption/decryption
happens at the application layer — a database compromise exposes ciphertext,
not PII.

---

## Architecture Decisions

**Fastify over Express:** Native TypeScript types, built-in Pino logging, ~2x
throughput, and a plugin system that cleanly separates infrastructure concerns
from route handlers.

**Prisma over raw SQL / Drizzle:** Schema-first approach generates correct
TypeScript types for every query. Migration history is committed as SQL files
so the database state is always reproducible.

**Pino over Winston / Morgan:** Lowest latency JSON logging, native Fastify
integration, and configurable redaction for sensitive fields.

**Zod for config:** Fails immediately at startup with a list of every missing
or invalid variable. No mysterious `undefined` errors at runtime.

**`dotenv` in `config.ts`:** Calling `dotenvConfig()` in the config module
ensures `.env` is loaded before Zod validates `process.env`, regardless of
import order.

---

## Status

**Phase 1 is complete and ready for UAT.** The WhatsApp webhook (HMAC + replay
protection), TrueLayer OAuth flow, and the AI agent (classify → route →
analytics → response validation) are all implemented and covered by the test
suite (1200+ tests). See [`UAT.md`](UAT.md) for the User Acceptance Testing
runbook and manual test scenarios.
