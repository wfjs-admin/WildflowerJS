/**
 * Mini Build Smoke Test
 *
 * Verifies that the `wildflower.mini` build:
 *   1. Loads and renders a basic reactive component with data-list
 *   2. Throws a clear error when a component attempts to use `pools: {}`
 *
 * This test runs against the mini build only (vitest.mini.config.js).
 * It does NOT run under the standard browser config because the default
 * build includes pools, and the "pools throws" assertion would fail.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Skip this entire file unless we're actually running the mini build
// (matches 'mini', 'mini-dev', 'mini-min')
const IS_MINI = (typeof __WILDFLOWER_DIST__ !== 'undefined') &&
  typeof __WILDFLOWER_DIST__ === 'string' &&
  __WILDFLOWER_DIST__.startsWith('mini')

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe.skipIf(!IS_MINI)('Mini Build Smoke Test', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('mini build renders a basic reactive component', async () => {
    testContainer.innerHTML = `
      <div data-component="mini-hello">
        <span data-bind="message"></span>
      </div>
    `

    wildflower.component('mini-hello', {
      state: { message: 'hello from mini' }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const span = testContainer.querySelector('span')
    expect(span.textContent).toBe('hello from mini')
  })

  it('mini build renders a data-list', async () => {
    testContainer.innerHTML = `
      <div data-component="mini-list">
        <ul data-list="items">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.component('mini-list', {
      state: {
        items: [
          { id: 1, name: 'alpha' },
          { id: 2, name: 'beta' },
          { id: 3, name: 'gamma' }
        ]
      }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const lis = testContainer.querySelectorAll('li')
    expect(lis.length).toBe(3)
    expect(lis[0].textContent).toBe('alpha')
    expect(lis[2].textContent).toBe('gamma')
  })

  it('mini build throws a clear error when component declares pools', () => {
    expect(() => {
      wildflower.component('mini-pool-fail', {
        state: {},
        pools: { items: {} }
      })
    }).toThrow(/mini build/i)
  })

  it('mini build throws error mentions the component name', () => {
    expect(() => {
      wildflower.component('named-pool-component', {
        pools: { things: {} }
      })
    }).toThrow(/named-pool-component/)
  })

  it('mini build throws error suggests lite or higher', () => {
    expect(() => {
      wildflower.component('suggest-test', {
        pools: { x: {} }
      })
    }).toThrow(/lite/i)
  })
})
