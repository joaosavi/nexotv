import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.bench.ts', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Routes, providers, and builder require integration tests (Phase 3+).
      // Excluding them here keeps the 70% threshold achievable for Phase 2
      // pure-function unit tests. Remove these excludes once Phase 3 adds
      // integration coverage.
      exclude: [
        'src/types/**',
        'dist/**',
        'src/routes/**',
        'src/providers/**',
        'src/addon/builder.ts',
        'src/addon/M3UEPGAddon.ts', // async I/O-heavy methods covered in Phase 3 integration tests
        'src/middleware/rateLimiter.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
