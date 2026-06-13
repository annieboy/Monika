/**
 * Application configuration.
 *
 * Validated with Zod at startup — the process exits immediately with a clear
 * error message if a required variable is missing or invalid, rather than
 * failing mysteriously later at point-of-use.
 */
import { config as dotenvConfig } from 'dotenv'
import { z } from 'zod'

// Load .env before parsing process.env. Safe to call multiple times — dotenv
// skips variables that are already set in the environment.
dotenvConfig()

const hexKey64 = z
  .string()
  .refine((v) => v === '' || (v.length === 64 && /^[0-9a-fA-F]+$/.test(v)), {
    message: 'Must be a 64-character hex string. Generate: openssl rand -hex 32',
  })

const configSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().url().startsWith('postgresql://'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Admin dashboard
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(8, 'Must be at least 8 characters').default('changeme1'),

  // Encryption
  ENCRYPTION_KEY: hexKey64.default(''),
  SECRET_KEY: z.string().min(32, 'Must be at least 32 characters. Generate: openssl rand -hex 32').default(''),

  // TrueLayer (Open Banking)
  TRUELAYER_CLIENT_ID: z.string().default(''),
  TRUELAYER_CLIENT_SECRET: z.string().default(''),
  TRUELAYER_REDIRECT_URI: z.string().default('http://localhost:3000/banking/callback'),
  TRUELAYER_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),

  // AI
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),

  // Error monitoring
  SENTRY_DSN: z.string().default(''),

  // WhatsApp
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),

  // Affiliate networks
  AWIN_PUBLISHER_ID: z.string().default(''),
  AWIN_API_KEY: z.string().default(''),
  CJ_PUBLISHER_ID: z.string().default(''),
  CJ_API_KEY: z.string().default(''),
  IMPACT_ACCOUNT_SID: z.string().default(''),
  IMPACT_AUTH_TOKEN: z.string().default(''),
  AFFILIATE_POSTBACK_SECRET: z.string().default(''),
})

export type Config = z.infer<typeof configSchema>

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env)

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    // eslint-disable-next-line no-console
    console.error(`\n[config] Configuration error — fix these environment variables:\n${errors}\n`)
    process.exit(1)
  }

  const cfg = result.data

  // In production, secrets must be explicitly set — empty defaults are not acceptable.
  if (cfg.NODE_ENV === 'production') {
    const missing: string[] = []
    if (!cfg.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY (generate: openssl rand -hex 32)')
    if (!cfg.SECRET_KEY) missing.push('SECRET_KEY (generate: openssl rand -hex 32)')
    if (cfg.ADMIN_PASSWORD === 'changeme1') missing.push('ADMIN_PASSWORD (change from default)')
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[config] Production secrets not configured:\n${missing.map((m) => `  ${m}`).join('\n')}\n`,
      )
      process.exit(1)
    }
  }

  return cfg
}

export const config = loadConfig()
