/**
 * WildflowerJS Pool Props Tests - Vitest Browser Mode
 *
 * Tests for pool-level props — shared data injected by the parent,
 * available to all pool item expressions via the `props.` prefix.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForRAF() {
  await new Promise(resolve => requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve())
  }))
  await new Promise(resolve => setTimeout(resolve, 10))
}

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

function getInstance(wildflower, el) {
  const compEl = el.closest ? el.closest('[data-component]') : el.querySelector('[data-component]')
  const target = compEl || el
  return wildflower.componentInstances.get(target.dataset.componentId)
}

describe('Pool Props (Parent-Injected Shared Data)', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._contextRegistry) {
      wildflower._contextRegistry.contexts?.clear()
      wildflower._contextRegistry.contextsByType?.clear()
      wildflower._contextRegistry.contextsByComponent?.clear()
      wildflower._contextRegistry.dependencies?.clear()
      wildflower._contextRegistry._contextTypeCache?.clear()
      wildflower._contextRegistry._contextModificationCounter = 0
    }

    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (wildflower._poolLoopRunning) {
      wildflower._poolLoopRunning = false
      if (wildflower._poolLoopId) {
        cancelAnimationFrame(wildflower._poolLoopId)
        wildflower._poolLoopId = null
      }
    }

    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // =========================================================================
  // 1. Basic Props Access
  // =========================================================================
  describe('Basic Props', () => {

    it('pool items can reference props.* in data-bind expressions', async () => {
      testContainer.innerHTML = `
        <div data-component="props-basic-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="props.currency + price"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('props-basic-test', {
        state: {},
        pools: {
          items: {
            props: { currency: '$' }
          }
        },
        init() {
          this.pools.items.add([
            { id: 1, price: '9.99' },
            { id: 2, price: '24.50' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      const spans = testContainer.querySelectorAll('.item span')
      expect(spans[0].textContent).toBe('$9.99')
      expect(spans[1].textContent).toBe('$24.50')
    })

    it('pool items can reference props.* in data-bind-class expressions', async () => {
      testContainer.innerHTML = `
        <div data-component="props-class-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item">
                <span data-bind="name"
                      data-bind-class="id === props.selectedId ? 'selected' : ''"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('props-class-test', {
        state: {},
        pools: {
          items: {
            props: { selectedId: 2 }
          }
        },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Carol' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      const spans = testContainer.querySelectorAll('.item span')
      expect(spans[0].className).not.toContain('selected')
      expect(spans[1].className).toContain('selected')
      expect(spans[2].className).not.toContain('selected')
    })

    it('pool items can reference props.* in data-show expressions', async () => {
      testContainer.innerHTML = `
        <div data-component="props-show-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item">
                <span data-bind="name"></span>
                <button data-show="props.canEdit">Edit</button>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('props-show-test', {
        state: {},
        pools: {
          items: {
            props: { canEdit: false }
          }
        },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      const buttons = testContainer.querySelectorAll('.item button')
      expect(buttons[0].style.display).toBe('none')
      expect(buttons[1].style.display).toBe('none')
    })
  })

  // =========================================================================
  // 2. Props Update
  // =========================================================================
  describe('Props Update', () => {

    it('changing props reflects on next rAF flush for live pools', async () => {
      testContainer.innerHTML = `
        <div data-component="props-update-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="props.currency + price"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('props-update-test', {
        state: {},
        pools: {
          items: {
            props: { currency: '$' }
          }
        },
        init() {
          this.pools.items.add([
            { id: 1, price: '9.99' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      expect(testContainer.querySelector('.item span').textContent).toBe('$9.99')

      // Change props
      instance.pools.items.props.currency = '€'

      await waitForRAF()
      await waitForRAF()

      expect(testContainer.querySelector('.item span').textContent).toBe('€9.99')
    })
  })

  // =========================================================================
  // 3. Props with Static Pools
  // =========================================================================
  describe('Props + Static Pool', () => {

    it('props work with data-pool-static on initial render', async () => {
      testContainer.innerHTML = `
        <div data-component="props-static-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="props.prefix + name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('props-static-test', {
        state: {},
        pools: {
          items: {
            props: { prefix: 'Dr. ' }
          }
        },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const spans = testContainer.querySelectorAll('.item span')
      expect(spans[0].textContent).toBe('Dr. Alice')
      expect(spans[1].textContent).toBe('Dr. Bob')
    })
  })

  // =========================================================================
  // 4. Props Access via API
  // =========================================================================
  describe('Props API', () => {

    it('pool.props is accessible and mutable', async () => {
      testContainer.innerHTML = `
        <div data-component="props-api-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('props-api-test', {
        state: {},
        pools: {
          items: {
            props: { theme: 'dark', locale: 'en-US' }
          }
        },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      expect(instance.pools.items.props.theme).toBe('dark')
      expect(instance.pools.items.props.locale).toBe('en-US')

      instance.pools.items.props.theme = 'light'
      expect(instance.pools.items.props.theme).toBe('light')
    })

    it('pool without props declaration has empty props object', async () => {
      testContainer.innerHTML = `
        <div data-component="props-default-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('props-default-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      expect(instance.pools.items.props).toBeDefined()
      expect(typeof instance.pools.items.props).toBe('object')
    })
  })
})
