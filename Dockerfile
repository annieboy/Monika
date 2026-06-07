# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching — only re-runs if lock file changes)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate
RUN npm run build

# Prune dev dependencies so we can copy a lean node_modules
RUN npm prune --omit=dev

# ── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Non-root user for security
RUN addgroup -S monika && adduser -S monika -G monika

WORKDIR /app

# Copy only what the production server needs
COPY --from=builder --chown=monika:monika /app/node_modules ./node_modules
COPY --from=builder --chown=monika:monika /app/dist ./dist
COPY --from=builder --chown=monika:monika /app/prisma ./prisma
COPY --from=builder --chown=monika:monika /app/package.json ./package.json

# Copy startup script
COPY --chown=monika:monika scripts/start.sh ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

USER monika

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["./scripts/start.sh"]
