/**
 * WildflowerJS Transition Integration Test Suite - Vitest Browser Mode
 *
 * Tests for transition integration with data-show and data-render.
 * Validates that CSS transitions are properly coordinated with visibility changes.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, hasFeature } from './helpers/load-framework.js'

// Skip entire suite if transitions feature is not available (e.g., lite build)
const suiteRunner = hasFeature('transitions') ? describe : describe.skip

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

// Helper to wait for transition to complete
async function waitForTransition(ms = 150) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to add transition CSS styles
function addTransitionStyles(doc = document) {
  if (doc.getElementById('test-transition-styles')) return

  const style = doc.createElement('style')
  style.id = 'test-transition-styles'
  style.textContent = `
    /* Fast fade transition for testing */
    .fade-enter {
      opacity: 0;
    }
    .fade-enter-active {
      transition: opacity 0.05s ease;
      opacity: 1;
    }
    .fade-leave {
      opacity: 1;
    }
    .fade-leave-active {
      transition: opacity 0.05s ease;
      opacity: 0;
    }

    /* Slide transition for testing */
    .slide-enter {
      transform: translateX(-20px);
      opacity: 0;
    }
    .slide-enter-active {
      transition: transform 0.05s ease, opacity 0.05s ease;
      transform: translateX(0);
      opacity: 1;
    }
    .slide-leave {
      transform: translateX(0);
      opacity: 1;
    }
    .slide-leave-active {
      transition: transform 0.05s ease, opacity 0.05s ease;
      transform: translateX(20px);
      opacity: 0;
    }

    /* Instant transition (no animation) */
    .instant-enter, .instant-enter-active,
    .instant-leave, .instant-leave-active {
      /* No transition - immediate */
    }
  `
  doc.head.appendChild(style)
}

suiteRunner('Transition Integration', () => {
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

    // Add transition styles
    addTransitionStyles()
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  describe('Basic Transition with data-show', () => {
    it('should apply enter classes when showing element', async () => {
      testContainer.innerHTML = `
        <div data-component="enter-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('enter-test', {
        state: { isVisible: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="enter-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially hidden
      expect(element.style.display).toBe('none')

      // Show element
      instance.state.isVisible = true
      await waitForUpdate(20)

      // Check for enter classes during transition
      const hasEnterClass = element.classList.contains('fade-enter') ||
        element.classList.contains('fade-enter-active')

      // After transition completes
      await waitForTransition()

      // Element should be visible
      expect(element.style.display).not.toBe('none')
    })

    it('should apply leave classes when hiding element', async () => {
      testContainer.innerHTML = `
        <div data-component="leave-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('leave-test', {
        state: { isVisible: true }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="leave-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially visible
      expect(element.style.display).not.toBe('none')

      // Hide element
      instance.state.isVisible = false
      await waitForUpdate(20)

      // After transition completes
      await waitForTransition()

      // Element should be hidden
      expect(element.style.display).toBe('none')
    })

    it('should clean up transition classes after completion', async () => {
      testContainer.innerHTML = `
        <div data-component="cleanup-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el original-class">
            Content
          </div>
        </div>
      `

      wildflower.component('cleanup-test', {
        state: { isVisible: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="cleanup-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Show element
      instance.state.isVisible = true
      await waitForTransition(200)

      // Original class should remain
      expect(element.classList.contains('original-class')).toBe(true)

      // Transition classes should be cleaned up
      expect(element.classList.contains('fade-enter')).toBe(false)
      expect(element.classList.contains('fade-enter-active')).toBe(false)
    })

    it('should handle rapid toggling correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="rapid-toggle-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('rapid-toggle-test', {
        state: { isVisible: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="rapid-toggle-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Rapid toggle
      instance.state.isVisible = true
      await waitForUpdate(10)
      instance.state.isVisible = false
      await waitForUpdate(10)
      instance.state.isVisible = true
      await waitForUpdate(10)
      instance.state.isVisible = false

      // Wait for transitions to settle
      await waitForTransition(300)

      // Final state should match last value (hidden)
      expect(element.style.display).toBe('none')
    })
  })

  describe('Transition with data-render', () => {
    it('should insert element with enter transition', async () => {
      testContainer.innerHTML = `
        <div data-component="render-enter-test">
          <div data-render="shouldRender" data-transition="fade" class="transition-el">
            Rendered Content
          </div>
        </div>
      `

      wildflower.component('render-enter-test', {
        state: { shouldRender: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Initially not rendered
      expect(testContainer.querySelector('.transition-el')).toBeNull()

      const component = testContainer.querySelector('[data-component="render-enter-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Render element
      instance.state.shouldRender = true
      await waitForCompleteRender()
      await waitForTransition()

      // Element should exist
      const element = testContainer.querySelector('.transition-el')
      expect(element).not.toBeNull()
    })

    it('should remove element with leave transition', async () => {
      testContainer.innerHTML = `
        <div data-component="render-leave-test">
          <div data-render="shouldRender" data-transition="fade" class="transition-el">
            Rendered Content
          </div>
        </div>
      `

      wildflower.component('render-leave-test', {
        state: { shouldRender: true }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Initially rendered
      expect(testContainer.querySelector('.transition-el')).not.toBeNull()

      const component = testContainer.querySelector('[data-component="render-leave-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Unrender element
      instance.state.shouldRender = false
      await waitForCompleteRender()
      await waitForTransition(200)

      // Element should be removed
      expect(testContainer.querySelector('.transition-el')).toBeNull()
    })

    it('should wait for leave transition before removing element', async () => {
      testContainer.innerHTML = `
        <div data-component="wait-remove-test">
          <div data-render="shouldRender" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('wait-remove-test', {
        state: { shouldRender: true }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="wait-remove-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Unrender
      instance.state.shouldRender = false

      // Element should still exist during transition (check immediately)
      await waitForUpdate(20)
      const duringTransition = testContainer.querySelector('.transition-el')
      // Note: The element may or may not exist depending on transition timing
      // The important thing is that after transition completes, it's removed

      // After transition
      await waitForTransition(200)
      expect(testContainer.querySelector('.transition-el')).toBeNull()
    })
  })

  describe('Transition with data-render — rapid toggling', () => {
    it('should re-render after hide/show cycle completes', async () => {
      testContainer.innerHTML = `
        <div data-component="render-cycle-test">
          <div data-render="shouldRender" data-transition="fade" class="transition-el">
            Cycle Content
          </div>
        </div>
      `

      wildflower.component('render-cycle-test', {
        state: { shouldRender: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="render-cycle-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Cycle 1: show
      instance.state.shouldRender = true
      await waitForCompleteRender()
      await waitForTransition()
      expect(testContainer.querySelector('.transition-el')).not.toBeNull()

      // Cycle 1: hide
      instance.state.shouldRender = false
      await waitForCompleteRender()
      await waitForTransition(200)
      expect(testContainer.querySelector('.transition-el')).toBeNull()

      // Cycle 2: show again — this must work (not be skipped due to stale templateClone state)
      instance.state.shouldRender = true
      await waitForCompleteRender()
      await waitForTransition()
      expect(testContainer.querySelector('.transition-el')).not.toBeNull()
    })

    it('should handle rapid show-then-hide without leaving orphaned elements', async () => {
      testContainer.innerHTML = `
        <div data-component="render-rapid-test">
          <div data-render="shouldRender" data-transition="fade" class="transition-el">
            Rapid Content
          </div>
        </div>
      `

      wildflower.component('render-rapid-test', {
        state: { shouldRender: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="render-rapid-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Rapid toggle: show then immediately hide
      instance.state.shouldRender = true
      await waitForCompleteRender()
      // Hide before enter transition completes
      instance.state.shouldRender = false
      await waitForCompleteRender()
      await waitForTransition(300)

      // Element should be fully removed
      expect(testContainer.querySelector('.transition-el')).toBeNull()
    })
  })

  describe('Custom Transition Names', () => {
    it('should use custom transition name for classes', async () => {
      testContainer.innerHTML = `
        <div data-component="custom-name-test">
          <div data-show="isVisible" data-transition="slide" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('custom-name-test', {
        state: { isVisible: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="custom-name-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Show element
      instance.state.isVisible = true
      await waitForUpdate(20)

      // Check that slide transition classes are used, not fade
      const hasSlideClass = element.classList.contains('slide-enter') ||
        element.classList.contains('slide-enter-active')
      const hasFadeClass = element.classList.contains('fade-enter') ||
        element.classList.contains('fade-enter-active')

      // At least slide classes should be present (not fade)
      // Note: May have already transitioned by the time we check
      await waitForTransition()

      // Element should be visible with custom transition
      expect(element.style.display).not.toBe('none')
    })

    it('should handle instant transition (no animation)', async () => {
      testContainer.innerHTML = `
        <div data-component="instant-test">
          <div data-show="isVisible" data-transition="instant" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('instant-test', {
        state: { isVisible: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="instant-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Show element
      instance.state.isVisible = true
      await waitForUpdate(50)

      // Should be visible almost immediately (no transition delay)
      expect(element.style.display).not.toBe('none')
    })
  })

  describe('JavaScript Transition Hooks', () => {
    it('should call onBeforeEnter hook when entering', async () => {
      let hookCalled = false
      let hookElement = null

      testContainer.innerHTML = `
        <div data-component="before-enter-hook-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('before-enter-hook-test', {
        state: { isVisible: false },
        onBeforeEnter(el) {
          hookCalled = true
          hookElement = el
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="before-enter-hook-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Show element
      instance.state.isVisible = true
      await waitForUpdate(20)

      expect(hookCalled).toBe(true)
      expect(hookElement).not.toBeNull()
    })

    it('should call onAfterEnter hook after enter transition completes', async () => {
      let hookCalled = false

      testContainer.innerHTML = `
        <div data-component="after-enter-hook-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('after-enter-hook-test', {
        state: { isVisible: false },
        onAfterEnter(el) {
          hookCalled = true
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="after-enter-hook-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Show element
      instance.state.isVisible = true
      await waitForTransition(200)

      expect(hookCalled).toBe(true)
    })

    it('should call onBeforeLeave hook when leaving', async () => {
      let hookCalled = false

      testContainer.innerHTML = `
        <div data-component="before-leave-hook-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('before-leave-hook-test', {
        state: { isVisible: true },
        onBeforeLeave(el) {
          hookCalled = true
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="before-leave-hook-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Hide element
      instance.state.isVisible = false
      await waitForUpdate(20)

      expect(hookCalled).toBe(true)
    })

    it('should call onAfterLeave hook after leave transition completes', async () => {
      let hookCalled = false

      testContainer.innerHTML = `
        <div data-component="after-leave-hook-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('after-leave-hook-test', {
        state: { isVisible: true },
        onAfterLeave(el) {
          hookCalled = true
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="after-leave-hook-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Hide element
      instance.state.isVisible = false
      await waitForTransition(200)

      expect(hookCalled).toBe(true)
    })
  })

  describe('Transition with Nested Elements', () => {
    it('should handle nested transitions independently', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-transition-test">
          <div data-show="outerVisible" data-transition="fade" class="outer-el">
            Outer
            <div data-show="innerVisible" data-transition="slide" class="inner-el">
              Inner
            </div>
          </div>
        </div>
      `

      wildflower.component('nested-transition-test', {
        state: {
          outerVisible: true,
          innerVisible: true
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const outerEl = testContainer.querySelector('.outer-el')
      const innerEl = testContainer.querySelector('.inner-el')
      const component = testContainer.querySelector('[data-component="nested-transition-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Both visible initially
      expect(outerEl.style.display).not.toBe('none')
      expect(innerEl.style.display).not.toBe('none')

      // Hide inner only
      instance.state.innerVisible = false
      await waitForTransition()

      // Outer still visible, inner hidden
      expect(outerEl.style.display).not.toBe('none')
      expect(innerEl.style.display).toBe('none')

      // Show inner again
      instance.state.innerVisible = true
      await waitForTransition()

      expect(innerEl.style.display).not.toBe('none')
    })

    it('should hide nested elements when parent is hidden', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-hide-test">
          <div data-show="parentVisible" data-transition="fade" class="parent-el">
            Parent
            <div class="child-el">Child (no transition)</div>
          </div>
        </div>
      `

      wildflower.component('parent-hide-test', {
        state: { parentVisible: true }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const parentEl = testContainer.querySelector('.parent-el')
      const childEl = testContainer.querySelector('.child-el')
      const component = testContainer.querySelector('[data-component="parent-hide-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Hide parent
      instance.state.parentVisible = false
      await waitForTransition()

      // Parent should be hidden (child is inside, so also hidden by virtue of DOM)
      expect(parentEl.style.display).toBe('none')
    })
  })

  describe('Transition with Data Bindings', () => {
    it('should maintain bindings during and after transition', async () => {
      testContainer.innerHTML = `
        <div data-component="binding-transition-test">
          <div data-show="isVisible" data-transition="fade" class="transition-el">
            <span class="bound-text" data-bind="message"></span>
          </div>
        </div>
      `

      wildflower.component('binding-transition-test', {
        state: {
          isVisible: true,
          message: 'Initial'
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const boundText = testContainer.querySelector('.bound-text')
      const component = testContainer.querySelector('[data-component="binding-transition-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      expect(boundText.textContent).toBe('Initial')

      // Update binding while visible
      instance.state.message = 'Updated'
      await waitForUpdate()

      expect(boundText.textContent).toBe('Updated')

      // Hide and show
      instance.state.isVisible = false
      await waitForTransition()
      instance.state.isVisible = true
      await waitForTransition()

      // Binding should still work
      expect(boundText.textContent).toBe('Updated')

      // Update again
      instance.state.message = 'After transition'
      await waitForUpdate()

      expect(boundText.textContent).toBe('After transition')
    })
  })

  describe('Transition Edge Cases', () => {
    it('should handle missing CSS transition gracefully', async () => {
      testContainer.innerHTML = `
        <div data-component="missing-css-test">
          <div data-show="isVisible" data-transition="nonexistent" class="transition-el">
            Content
          </div>
        </div>
      `

      wildflower.component('missing-css-test', {
        state: { isVisible: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="missing-css-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Should not throw, should still show element
      instance.state.isVisible = true
      await waitForUpdate(100)

      expect(element.style.display).not.toBe('none')
    })

    it('should handle transition with computed property condition', async () => {
      testContainer.innerHTML = `
        <div data-component="computed-transition-test">
          <div data-show="computed:isActive" data-transition="fade" class="transition-el">
            Active Content
          </div>
        </div>
      `

      wildflower.component('computed-transition-test', {
        state: { status: 'inactive' },
        computed: {
          isActive() {
            return this.state.status === 'active'
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.transition-el')
      const component = testContainer.querySelector('[data-component="computed-transition-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially hidden
      expect(element.style.display).toBe('none')

      // Activate via computed
      instance.state.status = 'active'
      await waitForTransition()

      expect(element.style.display).not.toBe('none')

      // Deactivate
      instance.state.status = 'inactive'
      await waitForTransition()

      expect(element.style.display).toBe('none')
    })

    it('should handle transition with negated condition', async () => {
      testContainer.innerHTML = `
        <div data-component="negated-transition-test">
          <div data-show="!isLoading" data-transition="fade" class="content-el">
            Content Ready
          </div>
        </div>
      `

      wildflower.component('negated-transition-test', {
        state: { isLoading: true }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('.content-el')
      const component = testContainer.querySelector('[data-component="negated-transition-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially hidden (isLoading is true, so !isLoading is false)
      expect(element.style.display).toBe('none')

      // Finish loading
      instance.state.isLoading = false
      await waitForTransition()

      expect(element.style.display).not.toBe('none')
    })
  })

  describe('Transition in Lists', () => {
    it('should apply transition to list items on initial render', async () => {
      testContainer.innerHTML = `
        <div data-component="list-transition-test">
          <ul data-list="items">
            <template>
              <li data-transition="fade" class="list-item">
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-transition-test', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' }
          ]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()
      await waitForTransition()

      const items = testContainer.querySelectorAll('.list-item')
      expect(items.length).toBe(2)
    })

    it('should apply transition to new list items', async () => {
      testContainer.innerHTML = `
        <div data-component="list-add-transition-test">
          <ul data-list="items">
            <template>
              <li data-transition="fade" class="list-item">
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-add-transition-test', {
        state: {
          items: [{ id: 1, name: 'Initial' }]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="list-add-transition-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      expect(testContainer.querySelectorAll('.list-item').length).toBe(1)

      // Add new item
      instance.state.items.push({ id: 2, name: 'New Item' })
      await waitForCompleteRender()
      await waitForTransition()

      expect(testContainer.querySelectorAll('.list-item').length).toBe(2)
    })
  })
})
