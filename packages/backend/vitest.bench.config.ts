import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.bench.ts'],
    benchmark: {
      include: ['tests/**/*.bench.ts'],
      outputFile: './bench-results.json',
    },
  },
});
