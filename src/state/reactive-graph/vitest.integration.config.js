import { defineConfig } from 'vitest/config';

// Boots the REAL framework from source under jsdom with EntityHandle injected,
// to see how far the ReactiveGraph facade carries a live component. All
// build-time flags the full module graph references are defined here.
export default defineConfig({
  define: {
    __DEV__: 'false',
    __FEATURE_SSR__: 'false',
    __FEATURE_PLUGINS__: 'true',
    // Enable portals/transitions so their subsystems initialize (the GC path
    // calls _cleanupComponentPortals, which needs _activePortals to exist).
    __FEATURE_PORTALS__: 'true',
    __FEATURE_TRANSITIONS__: 'true',
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['**/integration.test.js'],
    testTimeout: 20000,
  },
});
