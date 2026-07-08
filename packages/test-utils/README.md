# @wildflowerjs/test-utils

Testing utilities for WildflowerJS applications. Provides helpers for loading the framework, managing test state, and waiting for reactive updates.

## Requirements

### Prerequisites
- Node.js 16.0.0 or higher
- Vitest 1.0.0 or higher (recommended)

### Recommended: Vitest Browser Mode

For accurate DOM testing, use Vitest Browser Mode with Playwright:

```bash
npm install -D vitest @vitest/browser playwright
```

Create `vitest.browser.config.js`:
```javascript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true
    },
    include: ['test-new/**/*.test.js']
  }
})
```

### Environment Variables

| Variable | Values | Description |
|----------|--------|-------------|
| `WILDFLOWER_DIST` | `source`, `core`, `lite`, `spa`, `full` | Distribution mode to test against |

### Troubleshooting

**Tests fail with "wildflower is not defined"**
- Ensure `loadFramework()` is called in `beforeAll`
- Check that script paths are correct for your project structure

**Tests interfere with each other**
- Add `resetFramework()` and `initContextSystem()` in `beforeEach`
- Ensure `cleanup()` is called in `afterEach`

**DOM assertions fail unexpectedly**
- Add `await waitForUpdate()` after state changes
- Use `await waitForCompleteRender()` after `_scanForDynamicComponents()`

## Installation

```bash
npm install @wildflowerjs/test-utils --save-dev
```

## Quick Start

### With Vitest (Recommended)

```javascript
import { describe, it, expect } from 'vitest'
import { setupWildflowerTests, waitForUpdate } from '@wildflowerjs/test-utils/vitest'

describe('Counter Component', () => {
  const { getContainer, getWildflower } = setupWildflowerTests()

  it('should increment count', async () => {
    const wildflower = getWildflower()
    const container = getContainer()

    // Define component
    wildflower.component('counter', {
      state: { count: 0 },
      increment() {
        this.state.count++
      }
    })

    // Set up DOM
    container.innerHTML = `
      <div data-component="counter">
        <span data-bind="count" class="count"></span>
        <button data-action="increment">+</button>
      </div>
    `

    // Initialize
    wildflower._scanForDynamicComponents()
    await waitForUpdate()

    // Assert initial state
    expect(container.querySelector('.count').textContent).toBe('0')

    // Trigger action
    container.querySelector('button').click()
    await waitForUpdate()

    // Assert updated state
    expect(container.querySelector('.count').textContent).toBe('1')
  })
})
```

### Manual Setup

```javascript
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
  loadFramework,
  resetFramework,
  waitForUpdate,
  createTestContainer,
  initContextSystem
} from '@wildflowerjs/test-utils'

describe('My Tests', () => {
  let container, cleanup

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    resetFramework()
    initContextSystem()
    const result = createTestContainer()
    container = result.container
    cleanup = result.cleanup
  })

  afterEach(() => {
    cleanup()
  })

  it('should work', async () => {
    // Your test here
  })
})
```

## API Reference

### Core Utilities

#### `loadFramework(options?)`

Load the WildflowerJS framework.

```javascript
// Load source files (default)
await loadFramework()

// Load minified core build
await loadFramework({ mode: 'core' })

// Load custom scripts
await loadFramework({ scripts: ['/my/custom/build.js'] })
```

**Options:**
- `mode`: `'source' | 'core' | 'lite' | 'spa' | 'full'`
- `scripts`: `string[]` - Custom script paths (overrides mode)

#### `resetFramework()`

Reset all framework state between tests. Clears components, stores, templates, and caches.

```javascript
beforeEach(() => {
  resetFramework()
})
```

#### `waitForUpdate(ms?)`

Wait for framework to process reactive updates.

```javascript
instance.state.count++
await waitForUpdate()
expect(element.textContent).toBe('1')
```

#### `waitForCompleteRender()`

Wait for complete render cycle including microtask queue.

```javascript
wildflower._scanForDynamicComponents()
await waitForCompleteRender()
```

#### `createTestContainer(options?)`

Create a test container element.

```javascript
const { container, cleanup } = createTestContainer()
container.innerHTML = `<div data-component="test">...</div>`
// ... run tests
cleanup()
```

**Options:**
- `visible`: `boolean` - Make container visible for debugging
- `id`: `string` - Container ID

#### `getComponent(target)`

Get a component instance by name or element.

```javascript
const instance = getComponent('my-component')
const instance = getComponent(element)
```

#### `triggerAction(element, eventType?)`

Trigger an action on an element.

```javascript
const button = container.querySelector('[data-action="submit"]')
await triggerAction(button)
await triggerAction(button, 'mouseenter')
```

#### `waitForState(instance, path, expected, timeout?)`

Wait for a specific state value.

```javascript
await waitForState(instance, 'loading', false)
await waitForState(instance, 'user.name', 'John', 2000)
```

#### `hasFeature(feature)`

Check if a feature is available in the current build.

```javascript
if (hasFeature('portals')) {
  // Test portal functionality
}
```

#### `skipIfNoFeature(feature, testFn)`

Skip test if feature is not available.

```javascript
it('should use portals', skipIfNoFeature('portals', async () => {
  // Test code
}))
```

### Vitest Integration

#### `setupWildflowerTests(options?)`

Setup complete test environment with automatic beforeAll/beforeEach/afterEach hooks.

```javascript
describe('My Component', () => {
  const { getContainer, getWildflower } = setupWildflowerTests()

  it('should render', async () => {
    const wildflower = getWildflower()
    const container = getContainer()
    // ...
  })
})
```

**Options:**
- `visible`: `boolean` - Make container visible for debugging
- `mode`: `DistMode` - Distribution mode to load
- `containerId`: `string` - Test container ID

#### `mountComponent(name, definition, template, options?)`

Mount a component for testing with automatic setup.

```javascript
const { instance, element, cleanup } = await mountComponent(
  'counter',
  {
    state: { count: 0 },
    increment() { this.state.count++ }
  },
  `<div data-component="counter">
    <span data-bind="count"></span>
  </div>`
)

expect(element.querySelector('span').textContent).toBe('0')
cleanup()
```

#### `createTestHarness(name)`

Fluent API for component testing.

```javascript
const { instance, element } = await createTestHarness('counter')
  .withState({ count: 0 })
  .withMethods({
    increment() { this.state.count++ }
  })
  .withTemplate(`
    <div data-component="counter">
      <span data-bind="count"></span>
    </div>
  `)
  .mount()
```

## Distribution Modes

The test utilities support testing different framework builds:

| Mode | Description |
|------|-------------|
| `source` | Individual source files (default) |
| `core` | Minified core build |
| `lite` | Lightweight build (fewer features) |
| `spa` | SPA build with router |
| `full` | Full build with all features |

```javascript
// Set via environment variable
WILDFLOWER_DIST=core npx vitest run

// Or in test setup
await loadFramework({ mode: 'core' })
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import type { ComponentInstance, WildflowerInstance } from '@wildflowerjs/test-utils'

const instance: ComponentInstance = getComponent('my-comp')!
const wildflower: WildflowerInstance = getWildflower()
```

## License

MIT
