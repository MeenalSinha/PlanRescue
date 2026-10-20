import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // The smoke test starts a real server process; run test files one at a time
    // so output and ports are easy to reason about.
    fileParallelism: false,
  },
});
