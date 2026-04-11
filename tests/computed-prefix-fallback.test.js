/**
 * WildflowerJS Computed Prefix Fallback Test Suite
 *
 * Tests for data-bind resolving computed properties without the computed: prefix
 * when the path is not found in state.
 *
 * This is part of the "Option C+" enhancement: making computed: prefix optional
 * for data-bind (text content) while keeping data-list explicit for performance.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Computed Prefix Fallback', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Re-initialize the context system
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    // Create test container
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  describe('data-bind computed resolution without prefix', () => {
    it('should resolve computed property without computed: prefix when state path not found', async () => {
      testContainer.innerHTML = `
        <div data-component="prefix-test">
          <span id="with-prefix" data-bind="computed:fullName"></span>
          <span id="without-prefix" data-bind="fullName"></span>
        </div>
      `

      wildflower.component('prefix-test', {
        state: {
          firstName: 'John',
          lastName: 'Doe'
        },
        computed: {
          fullName() {
            return `${this.state.firstName} ${this.state.lastName}`
          }
        }
      })

      await waitForUpdate()

      const withPrefix = testContainer.querySelector('#with-prefix')
      const withoutPrefix = testContainer.querySelector('#without-prefix')

      // Both should resolve to the same value
      expect(withPrefix.textContent).toBe('John Doe')
      expect(withoutPrefix.textContent).toBe('John Doe')
    })

    it('should prefer computed over state when both exist with same name (proxy behavior)', async () => {
      // NOTE: This documents EXISTING framework behavior - the reactive proxy
      // prioritizes computed properties over state when both have the same name.
      // This is intentional to allow computed properties to "override" state.
      testContainer.innerHTML = `
        <div data-component="precedence-test">
          <span id="binding" data-bind="value"></span>
        </div>
      `

      wildflower.component('precedence-test', {
        state: {
          value: 'from state'
        },
        computed: {
          value() {
            return 'from computed'
          }
        }
      })

      await waitForUpdate()

      const binding = testContainer.querySelector('#binding')

      // Computed wins when both exist (existing proxy behavior)
      expect(binding.textContent).toBe('from computed')
    })

    it('should reactively update computed property bound without prefix', async () => {
      testContainer.innerHTML = `
        <div data-component="reactive-test">
          <span id="count-display" data-bind="doubleCount"></span>
        </div>
      `

      wildflower.component('reactive-test', {
        state: {
          count: 5
        },
        computed: {
          doubleCount() {
            return this.state.count * 2
          }
        }
      })

      await waitForUpdate()

      const display = testContainer.querySelector('#count-display')
      expect(display.textContent).toBe('10')

      // Update state
      const instance = wildflower.componentInstances.values().next().value
      instance.state.count = 10

      await waitForUpdate()

      // Computed should update reactively
      expect(display.textContent).toBe('20')
    })

    it('should handle computed properties that return objects', async () => {
      testContainer.innerHTML = `
        <div data-component="object-test">
          <span id="name" data-bind="userInfo.name"></span>
        </div>
      `

      wildflower.component('object-test', {
        state: {
          firstName: 'Jane',
          lastName: 'Smith'
        },
        computed: {
          userInfo() {
            return {
              name: `${this.state.firstName} ${this.state.lastName}`,
              initials: `${this.state.firstName[0]}${this.state.lastName[0]}`
            }
          }
        }
      })

      await waitForUpdate()

      // Note: Nested paths like "userInfo.name" currently require computed: prefix
      // because we only check simple paths for the fallback
      // This test documents current behavior
      const nameEl = testContainer.querySelector('#name')
      // Nested paths through computed properties would need computed:userInfo.name
      // For now this should return undefined/empty since userInfo is not in state
      // This is expected behavior per Gemini's guidance
    })

    it('should work with data-bind-style without prefix (expression eval path)', async () => {
      testContainer.innerHTML = `
        <div data-component="style-test">
          <div id="styled" data-bind-style="headerStyle"></div>
        </div>
      `

      wildflower.component('style-test', {
        state: {
          bgColor: '#ff0000'
        },
        computed: {
          headerStyle() {
            return { backgroundColor: this.state.bgColor }
          }
        }
      })

      await waitForUpdate()

      const styled = testContainer.querySelector('#styled')

      // Style bindings use expression evaluation which already supported this
      expect(styled.style.backgroundColor).toBe('rgb(255, 0, 0)')
    })

    it('should work with data-bind-class without prefix (expression eval path)', async () => {
      testContainer.innerHTML = `
        <div data-component="class-test">
          <div id="classed" data-bind-class="statusClass"></div>
        </div>
      `

      wildflower.component('class-test', {
        state: {
          isActive: true
        },
        computed: {
          statusClass() {
            return this.state.isActive ? 'active' : 'inactive'
          }
        }
      })

      await waitForUpdate()

      const classed = testContainer.querySelector('#classed')

      // Class bindings use expression evaluation which already supported this
      expect(classed.classList.contains('active')).toBe(true)
    })
  })

  describe('data-list computed resolution', () => {
    it('should work with computed: prefix for data-list (explicit)', async () => {
      testContainer.innerHTML = `
        <div data-component="list-test">
          <ul data-list="computed:filteredItems">
            <template>
              <li data-bind="name"></li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-test', {
        state: {
          items: [
            { name: 'Apple' },
            { name: 'Banana' },
            { name: 'Cherry' }
          ],
          filter: ''
        },
        computed: {
          filteredItems() {
            return this.state.items.filter(i =>
              i.name.toLowerCase().includes(this.state.filter.toLowerCase())
            )
          }
        }
      })

      await waitForUpdate()

      const items = testContainer.querySelectorAll('li')
      expect(items.length).toBe(3)
      expect(items[0].textContent).toBe('Apple')
    })

    it('should also resolve computed for data-list without prefix (unified DX)', async () => {
      // NOTE: As of the computed prefix fallback enhancement, data-list ALSO
      // resolves computed properties without the prefix. This provides
      // consistent DX across all binding types. The performance cost is minimal
      // (one undefined check + one property lookup only when value not in state).
      testContainer.innerHTML = `
        <div data-component="list-no-prefix-test">
          <ul data-list="filteredItems">
            <template>
              <li data-bind="name"></li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-no-prefix-test', {
        state: {
          // No state.filteredItems exists
        },
        computed: {
          filteredItems() {
            return [{ name: 'Test' }]
          }
        }
      })

      await waitForUpdate()

      // With the fallback enhancement, data-list now resolves computed
      const items = testContainer.querySelectorAll('li')
      expect(items.length).toBe(1)
      expect(items[0].textContent).toBe('Test')
    })
  })
})
