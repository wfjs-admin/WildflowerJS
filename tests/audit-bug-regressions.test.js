/**
 * WildflowerJS Audit Bug Regression Tests - Vitest Browser Mode
 *
 * Regression tests for bugs identified in the verified codebase audit
 * (docs/future/VERIFIED_AUDIT_SYNTHESIS_1MAR2026.md) and fixed in sprint 1.
 *
 * Bug 1: _cleanupSlotTemplates never called — memory leak on slot component destruction
 * Bug 3: PropsSystem bracket notation on Map — unnecessary re-evaluations
 * Bug 5: _componentMightBeAffected always-true fallback — defeated render filtering
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe.skipIf(isMinifiedBuild())('Audit Bug Regressions', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

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

  // ===================================================================
  // Bug 1: _cleanupSlotTemplates wired into destroyComponent
  // Before fix: slot subscriptions and rendered DOM elements leaked
  // The slot template system uses data-use-template[data-with] to create
  // reactive subscriptions. These subscriptions must be cleaned up when
  // the component is destroyed.
  // ===================================================================

  describe('Bug 1: Slot template cleanup on component destruction', () => {

    // This test requires configurable-templates feature (data-use-template + data-with)
    const itSlots = hasFeature('configurable-templates') ? it : it.skip

    itSlots('cleans up slot subscriptions when component is destroyed', async () => {
      wildflower.component('slot-cleanup-parent', {
        state: {
          currentUser: { name: 'Alice', email: 'alice@test.com' }
        }
      })

      wildflower.component('slot-cleanup-child', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="slot-cleanup-parent">
          <template data-item-template="user-tmpl">
            <div class="card">
              <span class="user-name" data-bind="name"></span>
            </div>
          </template>
          <div data-component="slot-cleanup-child">
            <template data-use-template="user-tmpl" data-with="currentUser"></template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(200)

      // Get the child component instance
      const childEl = testContainer.querySelector('[data-component="slot-cleanup-child"]')
      const childId = childEl.dataset.componentId
      const childInstance = wildflower.componentInstances.get(childId)
      expect(childInstance).toBeTruthy()

      // Verify slot contexts and cleanups were created
      const hadSlotContexts = !!(childInstance._slotContexts && childInstance._slotContexts.size > 0)
      const hadSlotCleanups = !!(childInstance._slotCleanups && childInstance._slotCleanups.length > 0)
      expect(hadSlotContexts || hadSlotCleanups).toBe(true)

      // Destroy the child component
      wildflower.destroyComponent(childId)
      await waitForUpdate(50)

      // Verify slot subscriptions were cleaned up (not leaked)
      if (childInstance._slotContexts) {
        expect(childInstance._slotContexts.size).toBe(0)
      }
      if (childInstance._slotCleanups) {
        expect(childInstance._slotCleanups.length).toBe(0)
      }
    })

    itSlots('cleans up rendered slot DOM elements on destruction', async () => {
      // Use single-component pattern: template defined and used in same component
      wildflower.component('slot-dom-single', {
        state: {
          profile: { name: 'Bob', role: 'Admin' }
        }
      })

      testContainer.innerHTML = `
        <div data-component="slot-dom-single">
          <template data-item-template="profile-tmpl">
            <div class="profile-card">
              <span data-bind="name" class="slot-name"></span>
            </div>
          </template>
          <template data-use-template="profile-tmpl" data-with="profile"></template>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()
      await waitForUpdate(200)

      // Verify template was rendered
      const slotName = testContainer.querySelector('.slot-name')
      expect(slotName).not.toBeNull()
      expect(slotName.textContent).toBe('Bob')

      // Destroy the component
      const compEl = testContainer.querySelector('[data-component="slot-dom-single"]')
      const compId = compEl.dataset.componentId
      const instance = wildflower.componentInstances.get(compId)
      expect(instance).toBeTruthy()

      wildflower.destroyComponent(compId)
      await waitForUpdate(50)

      // Verify slot contexts were cleaned up
      expect(
        instance._slotContexts === undefined || instance._slotContexts.size === 0
      ).toBe(true)
    })
  })

  // ===================================================================
  // Bug 3: PropsSystem _lastEvalResult Map access
  // Before fix: bracket notation on Map returned undefined, causing
  // the change detection to always see oldValue as undefined, triggering
  // unnecessary state change notifications on every computed prop update.
  // After fix: uses .get() for correct Map access.
  // ===================================================================

  describe('Bug 3: Computed prop change detection via _lastEvalResult', () => {

    it('computed prop changes propagate correctly to child via data-prop-*', async () => {
      wildflower.component('parent-eval-result', {
        state: { firstName: 'John', lastName: 'Doe' },
        computed: {
          fullName() { return this.state.firstName + ' ' + this.state.lastName }
        }
      })

      wildflower.component('child-eval-result', {
        props: {
          name: { type: String }
        }
      })

      testContainer.innerHTML = `
        <div data-component="parent-eval-result">
          <div data-component="child-eval-result" data-prop-name="computed:fullName">
            <span data-bind="props.name" id="child-name"></span>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()
      await waitForUpdate(150)

      const childEl = testContainer.querySelector('[data-component="child-eval-result"]')
      const childInstance = wildflower.componentInstances.get(childEl.dataset.componentId)

      // Verify initial prop was received
      expect(childInstance.props.name).toBe('John Doe')

      const childName = testContainer.querySelector('#child-name')
      expect(childName.textContent).toBe('John Doe')

      // Update parent state — computed should re-evaluate and propagate to child
      const parentEl = testContainer.querySelector('[data-component="parent-eval-result"]')
      const parentInstance = wildflower.componentInstances.get(parentEl.dataset.componentId)
      parentInstance.state.firstName = 'Jane'

      await waitForCompleteRender()
      await waitForUpdate(200)

      // Child should have received the updated computed value
      expect(childInstance.props.name).toBe('Jane Doe')
      expect(childName.textContent).toBe('Jane Doe')
    })
  })

  // ===================================================================
  // Bug 5: _componentMightBeAffected over-broad fallback
  // Before fix: returned true for any component with non-empty state
  // when pending changes existed, defeating the optimization filter.
  // After fix: only returns true for components that haven't rendered yet.
  //
  // This is tested behaviorally: updating one component's state should
  // not cause unrelated components to re-evaluate their bindings.
  // ===================================================================

  describe('Bug 5: Component render filtering', () => {

    it('unrelated component state change does not trigger update in other component', async () => {
      let compBRenderCount = 0

      wildflower.component('isolated-comp-a', {
        state: { alpha: 'original' }
      })

      wildflower.component('isolated-comp-b', {
        state: { gamma: 'stable' },
        computed: {
          tracked() {
            compBRenderCount++
            return this.state.gamma.toUpperCase()
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="isolated-comp-a">
          <span data-bind="alpha" id="alpha-val"></span>
        </div>
        <div data-component="isolated-comp-b">
          <span data-bind="computed:tracked" id="gamma-val"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Record comp-b's computed evaluation count after initial render
      const initialRenderCount = compBRenderCount

      // Update comp-a's state — this should NOT trigger comp-b re-evaluation
      const compAEl = testContainer.querySelector('[data-component="isolated-comp-a"]')
      const compA = wildflower.componentInstances.get(compAEl.dataset.componentId)
      compA.state.alpha = 'changed'

      await waitForCompleteRender()
      await waitForUpdate(100)

      // Verify comp-a updated
      expect(testContainer.querySelector('#alpha-val').textContent).toBe('changed')

      // Verify comp-b's computed was NOT re-evaluated (no unnecessary work)
      // Allow at most 1 extra evaluation (effect system may do 1 check)
      expect(compBRenderCount).toBeLessThanOrEqual(initialRenderCount + 1)

      // Verify comp-b's value is unchanged
      expect(testContainer.querySelector('#gamma-val').textContent).toBe('STABLE')
    })
  })
})
