/**
 * Pino logger.
 *
 * In development: pretty-printed, human-readable output via pino-pretty.
 * In production: JSON, one object per line — suitable for log aggregators
 * (Datadog, CloudWatch, Loki).
 *
 * Usage:
 *   import { logger } from './logger'
 *   logger.info({ userId, action: 'message_received' }, 'Processing WhatsApp message')
 *
 * Child loggers (preferred for services — adds context to every log line):
 *   const log = logger.child({ service: 'banking', connectionId })
 *   log.info('Fetching transactions')
 */
import pino from 'pino'
import { config } from './config.js'

const isDevelopment = config.NODE_ENV === 'development'

export const logger = pino({
  level: config.LOG_LEVEL,

  // Rename msg → message for log aggregator compatibility
  messageKey: 'message',

  // Standard timestamp in ISO 8601
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact sensitive fields — these are never written to logs
  redact: {
    paths: [
      'accessToken',
      'refreshToken',
      'accessTokenEnc',
      'refreshTokenEnc',
      'encryptionKey',
      'whatsappAccessToken',
      'anthropicApiKey',
      'openaiApiKey',
      '*.password',
      '*.secret',
      '*.token',
      'req.headers.authorization',
      'req.headers["x-whatsapp-signature"]',
    ],
    censor: '[REDACTED]',
  },

  // Pretty print in development only
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      }
    : {}),
})
