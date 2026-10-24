import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Run with: npm run test:selector  (from site/)
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: { include: ['tests/selector/**/*.test.ts'], environment: 'node', testTimeout: 120_000 },
});
