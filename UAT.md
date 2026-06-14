# Monika — UAT Runbook

User Acceptance Testing guide for **Phase 1**. This walks a tester from a clean
checkout to exercising every user-facing capability and confirming the
acceptance criteria.

---

## 1. Prerequisites

- Node.js 20+
- Docker + Docker Compose (for PostgreSQL, Redis, Adminer)
- An Anthropic API key (for the AI agent). TrueLayer/WhatsApp credentials are
  **optional** for UAT — the mock bank provider and the `/agent/chat` HTTP
  endpoint let you exercise the full flow without external accounts.

---

## 2. One-Time Setup

```bash
# 1. Install dependencies
npm ci

# 2. Start infrastructure (Postgres + Redis + Adminer)
docker compose up -d

# 3. Configure environment
cp .env.example .env
# Edit .env and set, at minimum:
#   ENCRYPTION_KEY   →  openssl rand -hex 32
#   SECRET_KEY       →  openssl rand -hex 32   (any string ≥ 32 chars)
#   ANTHROPIC_API_KEY→  your key
#   ADMIN_PASSWORD   →  any value ≥ 8 chars

# 4. Apply migrations and seed demo data
npm run db:migrate:deploy
npm run db:seed

# 5. Start the server
npm run dev          # http://localhost:3000
```

---

## 3. Automated Smoke Test (run first)

With the server running, in a second terminal:

```bash
npm run e2e
```

**Pass criteria:** the script prints a green checklist with no red failures —
onboarding, mock-bank connection, transaction import, and the spending /
subscription / balance questions all return data-driven answers, and the admin
dashboard is reachable.

If the smoke test is green, proceed to manual scenarios. If it fails, capture
the output and stop — manual testing will not be meaningful.

---

## 4. Health & Readiness

| Check | Command | Expected |
|-------|---------|----------|
| Liveness | `curl localhost:3000/health` | `{"status":"ok",...}` |
| Readiness | `curl localhost:3000/ready` | `{"status":"ok","checks":{"database":{"ok":true,...}}}` |
| Webhook handshake | `curl "localhost:3000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=ping"` | `403` (no verify token set) |

---

## 5. Manual Test Scenarios

Each scenario can be driven through `POST /agent/chat` with a JSON body
`{"message": "...", "userId": "<uuid>"}`. Use a seeded user's id (see
`npm run db:studio` → User table, or the id printed by `npm run e2e`).

> Tip: a brand-new user with no linked bank should always receive a **connect
> your bank** prompt rather than another user's data — this is the cross-user
> isolation guarantee and should be spot-checked in every data scenario.

### 5.1 Onboarding
| # | Message | Expected |
|---|---------|----------|
| O1 | First-ever message | Welcome + asks for first name |
| O2 | Provide name | Asks to accept Terms (links) |
| O3 | `YES` | Asks marketing consent |
| O4 | `YES`/`NO` | Onboarding complete, shows example questions |

### 5.2 Core Money Questions (bank-linked user)
| # | Message | Expected |
|---|---------|----------|
| S1 | "How much did I spend on groceries last month?" | A £ figure matching seeded data |
| S2 | "What subscriptions am I paying for?" | Lists recurring merchants (e.g. Netflix, Spotify) |
| S3 | "What's my balance?" | Current account balance |
| S4 | "How much can I safely spend this weekend?" | Safe-to-spend figure + reasoning |
| S5 | "Can I afford a £400k mortgage?" | Estimate **with FCA disclaimer** ("not financial advice…") |
| S6 | "What are my upcoming bills?" | List of due payments in the next window |
| S7 | "Show me my spending trends" | Category trend summary |
| S8 | "What's my net worth?" | Assets/liabilities summary |

### 5.3 Cross-User Isolation (security)
| # | Setup | Expected |
|---|-------|----------|
| X1 | Ask any S-scenario as a user with **no** bank connection | A connect-bank prompt — **never** another user's figures |

### 5.4 Response Safety (validator)
| # | Check | Expected |
|---|-------|----------|
| V1 | Any affordability/safe-to-spend reply | Contains FCA disclaimer, exactly once |
| V2 | Any reply | ≤ 4096 chars; WhatsApp formatting (`*bold*`, no markdown headers) |
| V3 | Trigger a reply that would include a sort code / card number | Shown as `[REDACTED]` |

### 5.5 WhatsApp Webhook Security
| # | Action | Expected |
|---|--------|----------|
| W1 | POST `/webhooks/whatsapp` with no `X-Hub-Signature-256` | `403` |
| W2 | POST with a valid signature but `X-Hub-Timestamp` 6 min old | `403` (replay protection) |
| W3 | POST with valid signature + current timestamp | `200` |

### 5.6 Admin Dashboard
Open `http://localhost:3000/admin` (basic auth: `ADMIN_USERNAME` /
`ADMIN_PASSWORD`). Confirm Users, Transactions, Offers, Opportunities,
Conversations, Analytics, and Audit pages all load.

### 5.7 Background Jobs (optional, advanced)
The opportunity/analytics workers run on cron schedules. To exercise them
without waiting, enqueue a job manually (e.g. via a REPL or a small script
calling `getOpportunityQueue().add('monthly-aggregation', {})`) and confirm a
`MonthlySummary` row appears and the worker logs `completed`.

---

## 6. Acceptance Criteria (sign-off checklist)

- [ ] `npm run e2e` passes end-to-end
- [ ] All Section 5.2 core questions return correct, data-driven answers
- [ ] Cross-user isolation (X1) holds — no data leakage
- [ ] FCA disclaimer present on affordability/safe-to-spend (V1)
- [ ] Sensitive data redaction works (V3)
- [ ] Webhook rejects unsigned (W1) and replayed (W2) requests, accepts valid (W3)
- [ ] Admin dashboard pages all load (5.6)
- [ ] No plaintext phone numbers or unencrypted tokens in the DB (spot-check via Adminer)

---

## 7. Reporting Issues

For each failure capture: the scenario id, the exact message sent, the userId,
the full response, and the relevant server log lines. File against the
`claude/ecstatic-volta-Hy412` branch.
