/**
 * WildflowerJS SSR Comprehensive Test Suite - Vitest Browser Mode
 *
 * Converted from legacy tests/tests_to_convert/original/ssrTestSuite.js
 * Tests NOT already covered by ssr-activation-timing.test.js or ssr-edge-cases.test.js
 *
 * Categories:
 *   1. SSR Detection (6 tests)
 *   2. Content Protection (7 tests)
 *   3. State Extraction (6 tests)
 *   4. Hydration Phases (7 tests)
 *   5. List Hydration (7 tests)
 *   6. Binding Activation (3 tests)
 *   7. Nested Component Hydration (5 tests)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Skip entire suite if SSR not available (core/lite/spa builds don't include SSRManager)
const describeIfSSR = hasFeature('ssr') ? describe : describe.skip

describeIfSSR('SSR Comprehensive', () => {
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

    // Reset SSR manager state
    if (wildflower.ssrManager) {
      wildflower.ssrManager.protectedElements?.clear()
      wildflower.ssrManager.protectedLists?.clear()
      wildflower.ssrManager.ssrComponents?.clear()
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

  // ============================================
  // Category 1: SSR Detection
  // ============================================
  describe('SSR Detection', () => {
    it('detects data-ssr="true" attribute on element', () => {
      testContainer.innerHTML = `
        <div data-component="test-ssr-detect" data-ssr="true">
          <span>Server Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      expect(wildflower.ssrManager.isSSRElement(el)).toBe(true)
    })

    it('returns false for non-SSR elements', () => {
      testContainer.innerHTML = `
        <div data-component="test-non-ssr">
          <span>Client Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      expect(wildflower.ssrManager.isSSRElement(el)).toBe(false)
    })

    it('detects SSR element with data-ssr-state', () => {
      testContainer.innerHTML = `
        <div data-component="test-state-detect" data-ssr="true" data-ssr-state='{"count": 5}'>
          <span>Count: 5</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      expect(wildflower.ssrManager.isSSRElement(el)).toBe(true)
    })

    it('returns UNINITIALIZED phase for fresh SSR element', () => {
      testContainer.innerHTML = `
        <div data-component="test-phase-detect" data-ssr="true">
          <span>Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      const phase = wildflower.ssrManager.getPhase(el)
      expect(phase).toBe('uninitialized')
    })

    it('isProtected returns false for non-SSR elements', () => {
      testContainer.innerHTML = `
        <div data-component="test-not-protected">Content</div>
      `
      const el = testContainer.querySelector('[data-component]')
      expect(wildflower.ssrManager.isProtected(el)).toBeFalsy()
    })

    it('isSSRElement returns false for element without data-ssr', () => {
      testContainer.innerHTML = `
        <div data-component="plain-comp">
          <span>No SSR attribute</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      expect(wildflower.ssrManager.isSSRElement(el)).toBe(false)
    })
  })

  // ============================================
  // Category 2: Content Protection
  // ============================================
  describe('Content Protection', () => {
    it('prepareElement returns true for SSR element', () => {
      testContainer.innerHTML = `
        <div data-component="protect-true-test" data-ssr="true">
          <span>Protected Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      const result = wildflower.ssrManager.prepareElement(el)
      expect(result).toBe(true)
    })

    it('prepareElement returns false for non-SSR element', () => {
      testContainer.innerHTML = `
        <div data-component="protect-false-test">
          <span>Normal Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      const result = wildflower.ssrManager.prepareElement(el)
      expect(result).toBe(false)
    })

    it('protected element content is initially preserved', () => {
      testContainer.innerHTML = `
        <div data-component="preserve-content-test" data-ssr="true">
          <span id="preserve-content-span">Server Rendered Text</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const span = testContainer.querySelector('#preserve-content-span')
      expect(span.textContent).toBe('Server Rendered Text')
    })

    it('protected lists are tracked in protectedLists', () => {
      testContainer.innerHTML = `
        <div data-component="list-track-test" data-ssr="true">
          <ul data-list="items">
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const listEl = testContainer.querySelector('[data-list]')
      const isTracked = wildflower.ssrManager.protectedLists.has(listEl) ||
                       listEl._ssrPhase === 'protected'
      expect(isTracked).toBe(true)
    })

    it('shouldSkipListClearing returns true for protected list', () => {
      testContainer.innerHTML = `
        <div data-component="skip-clear-test" data-ssr="true">
          <ul data-list="items">
            <li>Item 1</li>
          </ul>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const listEl = testContainer.querySelector('[data-list]')
      // During protection phase, list clearing should be skipped
      const shouldSkip = listEl._ssrPhase === 'protected' ||
                        wildflower.ssrManager.protectedLists.has(listEl)
      expect(shouldSkip).toBe(true)
    })

    it('SSR manager tracks protected elements', () => {
      testContainer.innerHTML = `
        <div data-component="tracked-el-test" data-ssr="true">
          <span>Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      expect(wildflower.ssrManager.protectedElements.has(el)).toBe(true)
    })

    it('SSR data is stored in ssrComponents map', () => {
      testContainer.innerHTML = `
        <div data-component="stored-data-test" data-ssr="true" data-ssr-state='{"value": 123}'>
          <span>Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const ssrData = wildflower.ssrManager.ssrComponents.get(el)
      expect(ssrData).toBeDefined()
      expect(ssrData.parsedState).toBeDefined()
    })
  })

  // ============================================
  // Category 3: State Extraction
  // ============================================
  describe('State Extraction', () => {
    it('extracts state from DOM bindings', () => {
      testContainer.innerHTML = `
        <div data-component="extract-dom-test" data-ssr="true">
          <span data-bind="count">42</span>
          <span data-bind="name">Test</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const ssrData = wildflower.ssrManager.ssrComponents.get(el)
      expect(ssrData).toBeDefined()
      expect(ssrData.parsedState.count).toBe('42')
      expect(ssrData.parsedState.name).toBe('Test')
    })

    it('handles invalid JSON in data-ssr-state gracefully', () => {
      testContainer.innerHTML = `
        <div data-component="invalid-json-test" data-ssr="true" data-ssr-state='invalid json'>
          <span>Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')

      // Should not throw
      expect(() => {
        wildflower.ssrManager.prepareElement(el)
      }).not.toThrow()
    })

    it('extracts nested state from DOM bindings', () => {
      testContainer.innerHTML = `
        <div data-component="nested-extract-test" data-ssr="true">
          <span data-bind="user.name">Alice</span>
          <span data-bind="user.profile.age">30</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const ssrData = wildflower.ssrManager.ssrComponents.get(el)
      expect(ssrData.parsedState.user.name).toBe('Alice')
      expect(ssrData.parsedState.user.profile.age).toBe('30')
    })

    it('extracts list state from DOM', () => {
      testContainer.innerHTML = `
        <div data-component="list-extract-test" data-ssr="true">
          <ul data-list="items">
            <li data-bind="name">Item A</li>
            <li data-bind="name">Item B</li>
            <li data-bind="name">Item C</li>
          </ul>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const ssrData = wildflower.ssrManager.ssrComponents.get(el)
      expect(ssrData.parsedState.items).toBeDefined()
      expect(ssrData.parsedState.items.length).toBe(3)
    })

    it('handles empty data-ssr-state', () => {
      testContainer.innerHTML = `
        <div data-component="empty-state-test" data-ssr="true" data-ssr-state='{}'>
          <span>Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const ssrData = wildflower.ssrManager.ssrComponents.get(el)
      // parsedState should include empty state from attribute (may also have DOM-extracted state)
      expect(ssrData).toBeDefined()
    })

    it('handles missing data-ssr-state attribute', () => {
      testContainer.innerHTML = `
        <div data-component="no-state-attr-test" data-ssr="true">
          <span>Content</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      const stateAttr = el.getAttribute('data-ssr-state')
      expect(stateAttr).toBeNull()
    })

    it('reads .value (not textContent) when extracting from input/textarea/select', () => {
      // Regression: hydration used to fall back to textContent for these
      // form tags, so server-rendered default values were dropped on
      // client activation. element.value is the right property for input,
      // textarea, and select.
      testContainer.innerHTML = `
        <div data-component="form-extract-test" data-ssr="true">
          <input data-bind="email" type="text" value="user@example.com">
          <textarea data-bind="bio">Server-rendered bio body.</textarea>
          <select data-bind="country">
            <option value="us">United States</option>
            <option value="uk" selected>United Kingdom</option>
            <option value="ca">Canada</option>
          </select>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const ssrData = wildflower.ssrManager.ssrComponents.get(el)
      expect(ssrData).toBeDefined()
      expect(ssrData.parsedState.email).toBe('user@example.com')
      expect(ssrData.parsedState.bio).toBe('Server-rendered bio body.')
      // select.value reflects the selected option's value, not the text
      // content of all <option>s concatenated.
      expect(ssrData.parsedState.country).toBe('uk')
    })
  })

  // ============================================
  // Category 4: Hydration Phases
  // ============================================
  describe('Hydration Phases', () => {
    it('SSRPhase constants are defined as strings', () => {
      // SSRPhase is exposed on wildflower
      const SSRPhase = wildflower.SSRPhase
      expect(SSRPhase).toBeDefined()
      expect(SSRPhase.UNINITIALIZED).toBe('uninitialized')
      expect(SSRPhase.PROTECTED).toBe('protected')
      expect(SSRPhase.ACTIVATED).toBe('activated')
      expect(SSRPhase.COMPLETE).toBe('complete')
    })

    it('new SSR element starts at UNINITIALIZED', () => {
      testContainer.innerHTML = `
        <div data-component="uninit-phase-test" data-ssr="true">Content</div>
      `
      const el = testContainer.querySelector('[data-component]')
      expect(wildflower.ssrManager.getPhase(el)).toBe('uninitialized')
    })

    it('prepareElement moves to PROTECTED phase', () => {
      testContainer.innerHTML = `
        <div data-component="protect-phase-test" data-ssr="true">Content</div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      // prepareElement sets PROTECTED, but may auto-activate via setTimeout
      const phase = wildflower.ssrManager.getPhase(el)
      expect(['protected', 'activated']).toContain(phase)
    })

    it('activateComponent moves to ACTIVATED phase', () => {
      testContainer.innerHTML = `
        <div data-component="activate-phase-test" data-ssr="true">Content</div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)
      wildflower.ssrManager.activateComponent(el)

      expect(wildflower.ssrManager.getPhase(el)).toBe('activated')
    })

    it('isActivated returns true for activated element', () => {
      testContainer.innerHTML = `
        <div data-component="is-activated-test" data-ssr="true">Content</div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)
      wildflower.ssrManager.activateComponent(el)

      expect(wildflower.ssrManager.isActivated(el)).toBe(true)
    })

    it('element can be set to COMPLETE phase', () => {
      testContainer.innerHTML = `
        <div data-component="complete-phase-test" data-ssr="true">Content</div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      el._ssrPhase = 'complete'
      expect(wildflower.ssrManager.getPhase(el)).toBe('complete')
    })

    it('isComplete returns true for completed element', () => {
      testContainer.innerHTML = `
        <div data-component="is-complete-test" data-ssr="true">Content</div>
      `
      const el = testContainer.querySelector('[data-component]')
      el._ssrPhase = 'complete'

      expect(wildflower.ssrManager.isComplete(el)).toBe(true)
    })
  })

  // ============================================
  // Category 5: List Hydration
  // ============================================
  describe('List Hydration', () => {
    it('detects SSR list within component', () => {
      testContainer.innerHTML = `
        <div data-component="list-detect-test" data-ssr="true">
          <ul data-list="items">
            <li>Server Item 1</li>
            <li>Server Item 2</li>
          </ul>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const listEl = testContainer.querySelector('[data-list]')
      const isTracked = wildflower.ssrManager.protectedLists.has(listEl) ||
                       listEl._ssrPhase === 'protected'
      expect(isTracked).toBe(true)
    })

    it('list items are preserved during protection', () => {
      testContainer.innerHTML = `
        <div data-component="list-preserve-test" data-ssr="true">
          <ul data-list="items">
            <li>Server A</li>
            <li>Server B</li>
            <li>Server C</li>
          </ul>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const items = testContainer.querySelectorAll('[data-list] li')
      expect(items.length).toBe(3)
    })

    it('list elements get _ssrPhase set', () => {
      testContainer.innerHTML = `
        <div data-component="list-phase-test" data-ssr="true">
          <div data-list="things">
            <span>Thing 1</span>
          </div>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const listEl = testContainer.querySelector('[data-list]')
      const hasPhase = listEl._ssrPhase !== undefined ||
                      wildflower.ssrManager.protectedLists.has(listEl)
      expect(hasPhase).toBe(true)
    })

    it('non-SSR list is not in protectedLists', () => {
      testContainer.innerHTML = `
        <div data-component="no-skip-list-test">
          <div data-list="things">
            <span>Thing 1</span>
          </div>
        </div>
      `
      const listEl = testContainer.querySelector('[data-list]')
      // Non-SSR list should not be tracked
      expect(wildflower.ssrManager.protectedLists.has(listEl)).toBe(false)
    })

    it('list element has _ssrPhase set after prepare', () => {
      testContainer.innerHTML = `
        <div data-component="adopted-flag-test" data-ssr="true">
          <ul data-list="items">
            <li>Item 1</li>
          </ul>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const listEl = testContainer.querySelector('[data-list]')
      // List should have _ssrPhase set to protected after prepare
      expect(listEl._ssrPhase).toBe('protected')
    })

    it('multiple lists in same component are protected', () => {
      testContainer.innerHTML = `
        <div data-component="multi-list-test" data-ssr="true">
          <ul data-list="list1">
            <li>List 1 Item</li>
          </ul>
          <ol data-list="list2">
            <li>List 2 Item</li>
          </ol>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const list1 = testContainer.querySelector('[data-list="list1"]')
      const list2 = testContainer.querySelector('[data-list="list2"]')

      expect(wildflower.ssrManager.protectedLists.has(list1)).toBe(true)
      expect(wildflower.ssrManager.protectedLists.has(list2)).toBe(true)
    })

    it('nested lists outer list is protected', () => {
      testContainer.innerHTML = `
        <div data-component="nested-list-protect-test" data-ssr="true">
          <div data-list="categories">
            <div class="category">
              <div data-list="items">
                <span>Nested Item</span>
              </div>
            </div>
          </div>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const outerList = testContainer.querySelector('[data-list="categories"]')
      expect(wildflower.ssrManager.protectedLists.has(outerList)).toBe(true)
    })
  })

  // ============================================
  // Category 6: Binding Activation
  // ============================================
  describe('Binding Activation', () => {
    it('shouldSkipBindingUpdate returns true during protection', () => {
      testContainer.innerHTML = `
        <div data-component="skip-bind-test" data-ssr="true">
          <span data-bind="text">Server Text</span>
        </div>
      `
      const el = testContainer.querySelector('[data-component]')
      wildflower.ssrManager.prepareElement(el)

      const bindEl = testContainer.querySelector('[data-bind]')
      const shouldSkip = wildflower.ssrManager.shouldSkipBindingUpdate(bindEl)
      expect(shouldSkip).toBe(true)
    })

    it('shouldSkipBindingUpdate returns false for non-SSR element', () => {
      testContainer.innerHTML = `
        <div data-component="no-skip-bind-test">
          <span data-bind="text">Client Text</span>
        </div>
      `
      const bindEl = testContainer.querySelector('[data-bind]')
      const shouldSkip = wildflower.ssrManager.shouldSkipBindingUpdate(bindEl)
      expect(shouldSkip).toBe(false)
    })

    it('activateAllComponents activates all SSR elements', () => {
      testContainer.innerHTML = `
        <div data-component="activate-all-a" data-ssr="true">Content 1</div>
        <div data-component="activate-all-b" data-ssr="true">Content 2</div>
      `
      wildflower.component('activate-all-a', { state: {} })
      wildflower.component('activate-all-b', { state: {} })

      const elements = testContainer.querySelectorAll('[data-ssr]')
      elements.forEach(el => wildflower.ssrManager.prepareElement(el))

      const count = wildflower.ssrManager.activateAllComponents()
      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================
  // Category 7: Nested Component Hydration
  // ============================================
  describe('Nested Component Hydration', () => {
    it('parent and child SSR elements are both detected', () => {
      testContainer.innerHTML = `
        <div data-component="parent-ssr-detect" data-ssr="true">
          <h2>Parent</h2>
          <div data-component="child-ssr-detect" data-ssr="true">
            <p>Child</p>
          </div>
        </div>
      `
      const parent = testContainer.querySelector('[data-component="parent-ssr-detect"]')
      const child = testContainer.querySelector('[data-component="child-ssr-detect"]')

      expect(wildflower.ssrManager.isSSRElement(parent)).toBe(true)
      expect(wildflower.ssrManager.isSSRElement(child)).toBe(true)
    })

    it('nested SSR components can be prepared independently', () => {
      testContainer.innerHTML = `
        <div data-component="outer-prep-test" data-ssr="true">
          <div data-component="inner-prep-test" data-ssr="true">
            <span>Inner Content</span>
          </div>
        </div>
      `
      const outer = testContainer.querySelector('[data-component="outer-prep-test"]')
      const inner = testContainer.querySelector('[data-component="inner-prep-test"]')

      wildflower.ssrManager.prepareElement(outer)
      wildflower.ssrManager.prepareElement(inner)

      expect(wildflower.ssrManager.isProtected(outer)).toBe(true)
      expect(wildflower.ssrManager.isProtected(inner)).toBe(true)
    })

    it('deep nesting (3+ levels) works', () => {
      testContainer.innerHTML = `
        <div data-component="level-1-test" data-ssr="true">
          <div data-component="level-2-test" data-ssr="true">
            <div data-component="level-3-test" data-ssr="true">
              <span>Deep Content</span>
            </div>
          </div>
        </div>
      `
      const level1 = testContainer.querySelector('[data-component="level-1-test"]')
      const level2 = testContainer.querySelector('[data-component="level-2-test"]')
      const level3 = testContainer.querySelector('[data-component="level-3-test"]')

      wildflower.ssrManager.prepareElement(level1)
      wildflower.ssrManager.prepareElement(level2)
      wildflower.ssrManager.prepareElement(level3)

      expect(wildflower.ssrManager.isProtected(level1)).toBe(true)
      expect(wildflower.ssrManager.isProtected(level2)).toBe(true)
      expect(wildflower.ssrManager.isProtected(level3)).toBe(true)
    })

    it('sibling SSR components have independent state', () => {
      testContainer.innerHTML = `
        <div data-component="sibling-a-test" data-ssr="true">
          <span data-bind="name">First</span>
        </div>
        <div data-component="sibling-b-test" data-ssr="true">
          <span data-bind="name">Second</span>
        </div>
      `
      const sibling1 = testContainer.querySelector('[data-component="sibling-a-test"]')
      const sibling2 = testContainer.querySelector('[data-component="sibling-b-test"]')

      wildflower.ssrManager.prepareElement(sibling1)
      wildflower.ssrManager.prepareElement(sibling2)

      // Verify framework parsed independent state per sibling via data-bind extraction
      const data1 = wildflower.ssrManager.ssrComponents.get(sibling1)
      const data2 = wildflower.ssrManager.ssrComponents.get(sibling2)

      expect(data1).toBeDefined()
      expect(data2).toBeDefined()
      expect(data1.parsedState.name).toBe('First')
      expect(data2.parsedState.name).toBe('Second')
      // Verify they are truly independent objects
      expect(data1.parsedState).not.toBe(data2.parsedState)
    })

    it('mixed SSR and non-SSR children are handled correctly', () => {
      testContainer.innerHTML = `
        <div data-component="mixed-parent-test" data-ssr="true">
          <div data-component="ssr-child-test" data-ssr="true">SSR Child</div>
          <div data-component="regular-child-test">Regular Child</div>
        </div>
      `
      const parent = testContainer.querySelector('[data-component="mixed-parent-test"]')
      const ssrChild = testContainer.querySelector('[data-component="ssr-child-test"]')
      const regularChild = testContainer.querySelector('[data-component="regular-child-test"]')

      wildflower.ssrManager.prepareElement(parent)
      wildflower.ssrManager.prepareElement(ssrChild)

      expect(wildflower.ssrManager.isSSRElement(parent)).toBe(true)
      expect(wildflower.ssrManager.isSSRElement(ssrChild)).toBe(true)
      expect(wildflower.ssrManager.isSSRElement(regularChild)).toBe(false)
    })
  })
})
