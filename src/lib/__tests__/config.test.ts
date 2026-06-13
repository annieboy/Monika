import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dotenv so dotenvConfig() is a no-op during module re-imports in tests.
// Without this, re-importing config.ts causes dotenv to restore env vars from
// .env, defeating our deliberate deletions.
vi.mock('dotenv', () => ({ config: vi.fn() }))

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('exits with code 1 when DATABASE_URL is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit(1)')
    })

    delete process.env.DATABASE_URL

    await expect(import('../../config.js')).rejects.toThrow('process.exit(1)')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with code 1 when NODE_ENV is invalid', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit(1)')
    })

    process.env.NODE_ENV = 'invalid_env'
    process.env.DATABASE_URL = 'postgresql://localhost/test'

    await expect(import('../../config.js')).rejects.toThrow('process.exit(1)')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with code 1 in production when ENCRYPTION_KEY is empty', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit(1)')
    })

    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.ENCRYPTION_KEY = ''
    process.env.SECRET_KEY = 'c'.repeat(32)
    process.env.ADMIN_PASSWORD = 'securepassword123'

    await expect(import('../../config.js')).rejects.toThrow('process.exit(1)')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with code 1 in production when ADMIN_PASSWORD is the default', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit(1)')
    })

    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    process.env.SECRET_KEY = 'b'.repeat(32)
    process.env.ADMIN_PASSWORD = 'changeme1'

    await expect(import('../../config.js')).rejects.toThrow('process.exit(1)')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with code 1 in production when SECRET_KEY is too short', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit(1)')
    })

    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    process.env.SECRET_KEY = 'tooshort'
    process.env.ADMIN_PASSWORD = 'securepassword123'

    await expect(import('../../config.js')).rejects.toThrow('process.exit(1)')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('succeeds and exports config in development with DATABASE_URL set', async () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'postgresql://localhost/test'

    const mod = await import('../../config.js')
    expect(mod.config).toBeDefined()
    expect(mod.config.NODE_ENV).toBe('development')
    expect(mod.config.DATABASE_URL).toBe('postgresql://localhost/test')
  })

  it('succeeds in production when all required secrets are set', async () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    process.env.SECRET_KEY = 'c'.repeat(32)
    process.env.ADMIN_PASSWORD = 'securepassword123'

    const mod = await import('../../config.js')
    expect(mod.config).toBeDefined()
    expect(mod.config.NODE_ENV).toBe('production')
  })
})
