import { defineConfig } from 'vitest/config';

// Standalone node-environment config for the ReactiveGraph core. The repo's root
// vitest.config.js is stale (references a deleted ./tests/setup.js) and the
// primary suite is browser-mode under test-new/. The core tests are pure logic
// with no DOM, so they run fastest and most simply in plain node.
export default defineConfig({
  // Build-time globals the core references (folded by the bundler in real builds).
  define: {
    __DEV__: 'false',
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['**/core.test.js'],
    testTimeout: 10000,
  },
});
