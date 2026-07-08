import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import path from 'path'

// Get distribution mode from environment variable
// Options: 'full-dev' (default), 'core', 'lite', 'spa', 'full', plus -dev variants
const distMode = process.env.WILDFLOWER_DIST || 'full-dev'

export default defineConfig({
  // Set root to parent directory so we can access dist/
  root: path.resolve(__dirname, '..'),

  // Inject the dist mode as a global constant for tests
  define: {
    __WILDFLOWER_DIST__: JSON.stringify(distMode),
  },

  test: {
    // Use browser mode with Playwright (Vitest 4.x syntax)
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [
        { browser: 'chromium' }
      ],
      headless: true,
    },

    // Include only tests in tests directory
    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],

    // Exclude archived tests and benchmarks (run benchmarks explicitly)
    exclude: [
      'tests/archive/**',
      'tests/benchmark-*.test.js',
    ],

    // Test timeout
    testTimeout: 30000,

    // Isolate test files for better reliability
    isolate: true,

    // Global test APIs
    globals: true,

    // Custom reporters - default plus assertion counter
    reporters: ['default', path.resolve(__dirname, 'assertion-reporter.js')],
  },

  // Serve static files from project root
  publicDir: false,
})
