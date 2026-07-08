/**
 * Framework Loader Helper for Vitest Browser Tests
 *
 * This file re-exports utilities from @wildflowerjs/test-utils for backward
 * compatibility with existing tests. New tests can import directly from
 * the test-utils package.
 *
 * Usage in tests:
 *   import { loadFramework, getDistMode } from './helpers/load-framework.js'
 *
 *   beforeAll(async () => {
 *     await loadFramework()
 *   })
 *
 * Or import directly from the package:
 *   import { loadFramework, resetFramework } from '../../packages/test-utils/index.js'
 *
 * Environment variables:
 *
 * WILDFLOWER_DIST (defaults to 'full-dev'):
 *   - 'core': Load /dist/wildflower.min.js
 *   - 'lite': Load /dist/wildflower.lite.min.js
 *   - 'spa': Load /dist/wildflower.spa.min.js
 *   - 'full': Load /dist/wildflower.full.min.js
 *   - 'full-dev' (default): Load /dist/wildflower.full.dev.js
 *
 * NOTE: 'source' mode is DEPRECATED. After the ES6 module migration,
 * the source is in /src/ and must be built to /dist/.
 *
 * Run examples:
 *   npx vitest run --config tests/vitest.browser.config.js
 *   WILDFLOWER_DIST=core npx vitest run --config tests/vitest.browser.config.js
 */

// Re-export all utilities from the test-utils package
export {
  getDistMode,
  getFrameworkScripts,
  hasFeature,
  isMinifiedBuild,
  isMeadowBuild,
  hasConsoleWarnings,
  loadFramework,
  resetFramework,
  waitForUpdate,
  whenSettled,
  waitForCompleteRender,
  waitForDOM,
  createTestContainer,
  getComponent,
  triggerAction,
  waitForState,
  skipIfNoFeature,
  initContextSystem,
  // Phase 3.5: Context registry helpers for stripped templates
  findBoundElement,
  findAllBoundElements,
  // Phase 3.7: List item helper (no DOM attribute, uses _listIndex property)
  getListItems
} from '../../packages/test-utils/index.js'
