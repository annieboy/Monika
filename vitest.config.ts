import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Load test environment variables before any test file runs
    setupFiles: ['./src/test/setup.ts'],
    // Each test file gets its own context — no shared state between files
    isolate: true,
    // Show each test name in output (useful in CI)
    reporter: 'verbose',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/test/**',
        'src/index.ts',
        'src/app.ts',            // server bootstrap — exercised by integration tests
        'src/lib/prisma.ts',     // Prisma singleton initialisation
        'src/lib/monitoring.ts', // observability setup — no business logic
        'src/routes/admin/**',   // admin UI template renderers — HTML only
        'src/routes/dev/**',     // dev-only routes
        'src/routes/landing/**', // static marketing page
        'src/routes/legal/**',   // static legal page
        '**/*.d.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
})
