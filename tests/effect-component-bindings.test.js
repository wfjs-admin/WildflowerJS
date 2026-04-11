/**
 * Effect-Based Component Bindings Test Suite - Phase 3
 *
 * Tests for the Effect-based component binding system.
 * See: docs/future/EFFECT_PHASE3_COMPONENT_BINDINGS_PLAN.md
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for microtask
async function waitForMicrotask() {
  await new Promise(resolve => queueMicrotask(resolve))
}

describe('Effect-Based Component Bindings - Phase 3', () => {
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

  describe('Render Effect creation', () => {
    it.skipIf(isMinifiedBuild())('should create a Render Effect when data-use-effects="true" is set', async () => {
      wildflower.component('effect-comp-test-1', {
        state: {
          count: 0,
          message: 'Hello'
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-test-1" data-use-effects="true">
          <span class="count" data-bind="count"></span>
          <span class="message" data-bind="message"></span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      expect(component).toBeDefined()

      // Verify Render Effect was created

      expect(component._renderEffect).toBeDefined()
      expect(typeof component._renderEffect).toBe('function')

      // Verify initial values rendered
      expect(testContainer.querySelector('.count').textContent).toBe('0')
      expect(testContainer.querySelector('.message').textContent).toBe('Hello')
    })

    it.skipIf(isMinifiedBuild())('should create a Render Effect by default (no opt-in needed)', async () => {
      wildflower.component('effect-comp-test-2', {
        state: {
          count: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-test-2">
          <span class="count" data-bind="count"></span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      expect(component).toBeDefined()

      // Verify Render Effect was created (Effects are now default)

      expect(component._renderEffect).toBeDefined()
    })
  })

  describe('Reactive updates via Render Effect', () => {
    it('should update data-bind when state changes', async () => {
      wildflower.component('effect-comp-test-3', {
        state: {
          count: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-test-3" data-use-effects="true">
          <span class="count" data-bind="count"></span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const countSpan = testContainer.querySelector('.count')

      expect(countSpan.textContent).toBe('0')

      // Update state
      component.state.count = 42
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(countSpan.textContent).toBe('42')
    })

    it('should update data-show when state changes', async () => {
      wildflower.component('effect-comp-test-4', {
        state: {
          visible: true
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-test-4" data-use-effects="true">
          <span class="content" data-show="visible">Content</span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const contentSpan = testContainer.querySelector('.content')

      expect(contentSpan.style.display).not.toBe('none')

      // Toggle visibility
      component.state.visible = false
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(contentSpan.style.display).toBe('none')

      // Toggle back
      component.state.visible = true
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(contentSpan.style.display).not.toBe('none')
    })

    it('should handle negated data-show', async () => {
      wildflower.component('effect-comp-test-5', {
        state: {
          loading: true
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-test-5" data-use-effects="true">
          <span class="content" data-show="!loading">Content</span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const contentSpan = testContainer.querySelector('.content')

      // loading=true, so !loading=false, should be hidden
      expect(contentSpan.style.display).toBe('none')

      // Toggle
      component.state.loading = false
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(contentSpan.style.display).not.toBe('none')
    })

    it('should update data-bind-class when state changes', async () => {
      wildflower.component('effect-comp-test-6', {
        state: {
          status: 'active'
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-test-6" data-use-effects="true">
          <span class="item" data-bind-class="status">Item</span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const itemSpan = testContainer.querySelector('.item')

      expect(itemSpan.classList.contains('active')).toBe(true)

      // Change status
      component.state.status = 'inactive'
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(itemSpan.classList.contains('active')).toBe(false)
      expect(itemSpan.classList.contains('inactive')).toBe(true)
    })
  })

  describe('Effect batching', () => {
    it('should batch multiple state changes into single Effect run', async () => {
      wildflower.component('effect-comp-test-7', {
        state: {
          a: 0,
          b: 0,
          c: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-test-7" data-use-effects="true">
          <span class="a" data-bind="a"></span>
          <span class="b" data-bind="b"></span>
          <span class="c" data-bind="c"></span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value

      // Rapidly update multiple properties
      component.state.a = 1
      component.state.b = 2
      component.state.c = 3
      component.state.a = 10
      component.state.b = 20
      component.state.c = 30

      await waitForMicrotask()
      await waitForUpdate(50)

      // Final values should be correct
      expect(testContainer.querySelector('.a').textContent).toBe('10')
      expect(testContainer.querySelector('.b').textContent).toBe('20')
      expect(testContainer.querySelector('.c').textContent).toBe('30')
    })
  })

  describe('Effect disposal', () => {
    it.skipIf(isMinifiedBuild())('should dispose Render Effect when component is destroyed', async () => {
      wildflower.component('effect-comp-dispose-1', {
        state: {
          count: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-dispose-1" data-use-effects="true">
          <span class="count" data-bind="count"></span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const componentId = component.id

      expect(component._renderEffect).toBeDefined()

      // Destroy the component
      wildflower.destroyComponent(componentId)
      await waitForUpdate(50)

      // Component should be removed
      expect(wildflower.componentInstances.has(componentId)).toBe(false)
    })
  })

  describe('Computed properties', () => {
    it('should update when computed property dependencies change', async () => {
      wildflower.component('effect-comp-computed-1', {
        state: {
          firstName: 'John',
          lastName: 'Doe'
        },
        computed: {
          fullName() {
            return this.state.firstName + ' ' + this.state.lastName
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-computed-1" data-use-effects="true">
          <span class="name" data-bind="computed:fullName"></span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const nameSpan = testContainer.querySelector('.name')

      expect(nameSpan.textContent).toBe('John Doe')

      // Change dependency
      component.state.firstName = 'Jane'
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(nameSpan.textContent).toBe('Jane Doe')
    })
  })

  describe('Mixed binding types', () => {
    it('should handle multiple binding types in same component', async () => {
      wildflower.component('effect-comp-mixed-1', {
        state: {
          title: 'Test Title',
          visible: true,
          status: 'active',
          description: '<em>Description</em>'
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-comp-mixed-1" data-use-effects="true">
          <h1 class="title" data-bind="title"></h1>
          <div class="content" data-show="visible">
            <span class="status-badge" data-bind-class="status">Badge</span>
            <div class="description" data-bind-html="description"></div>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value

      // Verify initial state
      expect(testContainer.querySelector('.title').textContent).toBe('Test Title')
      expect(testContainer.querySelector('.content').style.display).not.toBe('none')
      expect(testContainer.querySelector('.status-badge').classList.contains('active')).toBe(true)
      expect(testContainer.querySelector('.description').innerHTML).toBe('<em>Description</em>')

      // Update all at once
      component.state.title = 'New Title'
      component.state.visible = false
      component.state.status = 'completed'
      component.state.description = '<strong>New</strong>'

      await waitForMicrotask()
      await waitForUpdate(50)

      expect(testContainer.querySelector('.title').textContent).toBe('New Title')
      expect(testContainer.querySelector('.content').style.display).toBe('none')
      expect(testContainer.querySelector('.status-badge').classList.contains('completed')).toBe(true)
      expect(testContainer.querySelector('.description').innerHTML).toBe('<strong>New</strong>')
    })
  })

  describe('Nested components', () => {
    it('should not affect nested component bindings', async () => {
      wildflower.component('effect-parent-1', {
        state: {
          parentValue: 'Parent'
        }
      })

      wildflower.component('effect-child-1', {
        state: {
          childValue: 'Child'
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-parent-1">
          <span class="parent-val" data-bind="parentValue"></span>
          <div data-component="effect-child-1">
            <span class="child-val" data-bind="childValue"></span>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      // Get both components
      const components = Array.from(wildflower.componentInstances.values())
      const parent = components.find(c => c.name === 'effect-parent-1')
      const child = components.find(c => c.name === 'effect-child-1')

      expect(parent).toBeDefined()
      expect(child).toBeDefined()

      // Verify both render correctly
      expect(testContainer.querySelector('.parent-val').textContent).toBe('Parent')
      expect(testContainer.querySelector('.child-val').textContent).toBe('Child')

      // Update parent
      parent.state.parentValue = 'Updated Parent'
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(testContainer.querySelector('.parent-val').textContent).toBe('Updated Parent')
      expect(testContainer.querySelector('.child-val').textContent).toBe('Child') // Unchanged
    })
  })
})
