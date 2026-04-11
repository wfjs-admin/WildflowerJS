/**
 * WildflowerJS Portals Test Suite - Vitest Browser Mode
 *
 * Comprehensive tests for portal functionality including:
 * - Basic teleportation to target selector
 * - Reactivity preservation from source component
 * - Integration with data-show and data-render
 * - Cleanup on component destroy
 * - Multiple portals and edge cases
 *
 * API: data-portal="selector" - teleports content to specified DOM location
 *
 * NOTE: Portals are stripped from the lite build
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, hasFeature, hasConsoleWarnings } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Skip entire suite if portals not available (lite build)
const describeIfPortals = hasFeature('portals') ? describe : describe.skip

describeIfPortals('Portals', () => {
  let testContainer
  let portalTarget
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
    testContainer.style.top = '-9999px'
    document.body.appendChild(testContainer)

    // Create portal target container (separate from test container)
    portalTarget = document.createElement('div')
    portalTarget.id = 'portal-target'
    portalTarget.style.position = 'absolute'
    portalTarget.style.top = '-9999px'
    document.body.appendChild(portalTarget)
  })

  afterEach(() => {
    // Clean up test container
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
    testContainer = null

    // Clean up portal target
    if (portalTarget && portalTarget.parentNode) {
      portalTarget.parentNode.removeChild(portalTarget)
    }
    portalTarget = null

    // Clean up any portaled content that ended up at body level
    document.querySelectorAll('[data-portaled]').forEach(el => el.remove())
  })

  // ==========================================
  // Basic Portal Functionality
  // ==========================================
  describe('Basic Functionality', () => {
    it('renders content at target selector', async () => {
      wildflower.component('portal-source', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="portaled-content">Hello from portal</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="portal-source"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Content should be in portal target, not in source
      const targetContent = portalTarget.querySelector('.portaled-content')
      expect(targetContent).not.toBeNull()
      expect(targetContent.textContent).toBe('Hello from portal')

      // Original portal element should be empty or hidden
      const sourcePortal = testContainer.querySelector('[data-portal]')
      expect(sourcePortal.querySelector('.portaled-content')).toBeNull()
    })

    it('renders to body when target is body', async () => {
      wildflower.component('portal-to-body', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="body">
              <div class="body-portal" data-portaled>Modal content</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="portal-to-body"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Content should be direct child of body
      const bodyContent = document.body.querySelector('.body-portal')
      expect(bodyContent).not.toBeNull()
      expect(bodyContent.textContent).toBe('Modal content')
    })

    it('maintains DOM structure of portaled content', async () => {
      wildflower.component('structured-portal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal">
                <div class="modal-header">Header</div>
                <div class="modal-body">Body</div>
                <div class="modal-footer">Footer</div>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="structured-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const modal = portalTarget.querySelector('.modal')
      expect(modal).not.toBeNull()
      expect(modal.querySelector('.modal-header').textContent).toBe('Header')
      expect(modal.querySelector('.modal-body').textContent).toBe('Body')
      expect(modal.querySelector('.modal-footer').textContent).toBe('Footer')
    })
  })

  // ==========================================
  // Reactivity in Portals
  // ==========================================
  describe('Reactivity', () => {
    it('maintains reactivity from source component with data-bind', async () => {
      wildflower.component('reactive-portal', {
        state: { message: 'Initial' },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <span class="message" data-bind="message"></span>
              <button class="update-btn" data-action="updateMessage">Update</button>
            </div>
          `
        },
        updateMessage() {
          this.state.message = 'Updated'
        }
      })

      testContainer.innerHTML = '<div data-component="reactive-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Check initial value
      const message = portalTarget.querySelector('.message')
      expect(message.textContent).toBe('Initial')

      // Trigger update via button inside portal
      const button = portalTarget.querySelector('.update-btn')
      button.click()
      await waitForUpdate()

      // Check updated value
      expect(message.textContent).toBe('Updated')
    })

    it('data-action in portal triggers source component method', async () => {
      let actionCalled = false

      wildflower.component('action-portal', {
        state: { count: 0 },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <button class="portal-btn" data-action="increment">Click</button>
              <span class="count" data-bind="count"></span>
            </div>
          `
        },
        increment() {
          actionCalled = true
          this.state.count++
        }
      })

      testContainer.innerHTML = '<div data-component="action-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const button = portalTarget.querySelector('.portal-btn')
      button.click()
      await waitForUpdate()

      expect(actionCalled).toBe(true)
      expect(portalTarget.querySelector('.count').textContent).toBe('1')
    })

    it('data-model in portal updates source component state', async () => {
      wildflower.component('model-portal', {
        state: { inputValue: '' },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <input type="text" class="portal-input" data-model="inputValue">
              <span class="display" data-bind="inputValue"></span>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="model-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const input = portalTarget.querySelector('.portal-input')
      input.value = 'Hello World'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      // Value should be reflected in portaled binding (same portal)
      const display = portalTarget.querySelector('.display')
      expect(display.textContent).toBe('Hello World')
    })

    it('computed properties work in portaled content', async () => {
      wildflower.component('computed-portal', {
        state: { firstName: 'John', lastName: 'Doe' },
        computed: {
          fullName() {
            return `${this.state.firstName} ${this.state.lastName}`
          }
        },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <span class="full-name" data-bind="fullName"></span>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="computed-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      expect(portalTarget.querySelector('.full-name').textContent).toBe('John Doe')
    })
  })

  // ==========================================
  // Integration with data-show
  // ==========================================
  describe('Integration with data-show', () => {
    it('portal with data-show="true" renders content', async () => {
      wildflower.component('show-portal', {
        state: { isVisible: true },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target" data-show="isVisible">
              <div class="conditional-content">Visible</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="show-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const content = portalTarget.querySelector('.conditional-content')
      expect(content).not.toBeNull()
    })

    it('portal with data-show="false" does not render content', async () => {
      wildflower.component('hidden-portal', {
        state: { isVisible: false },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target" data-show="isVisible">
              <div class="conditional-content">Should not appear</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="hidden-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const content = portalTarget.querySelector('.conditional-content')
      expect(content).toBeNull()
    })

    it('toggling data-show adds/removes portaled content', async () => {
      wildflower.component('toggle-portal', {
        state: { showModal: false },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target" data-show="showModal">
              <div class="modal-content">Modal</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="toggle-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Initially hidden
      expect(portalTarget.querySelector('.modal-content')).toBeNull()

      // Show - directly update state via component instance
      const instance = wildflower.getComponent('toggle-portal')
      instance.state.showModal = true
      await waitForUpdate()
      expect(portalTarget.querySelector('.modal-content')).not.toBeNull()

      // Hide
      instance.state.showModal = false
      await waitForUpdate()
      expect(portalTarget.querySelector('.modal-content')).toBeNull()
    })
  })

  // ==========================================
  // Integration with data-render
  // ==========================================
  describe('Integration with data-render', () => {
    it('portal with data-render conditionally adds/removes from DOM', async () => {
      wildflower.component('render-portal', {
        state: { renderModal: false },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target" data-render="renderModal">
              <div class="rendered-content">Rendered</div>
            </div>
          `
        },
      })

      testContainer.innerHTML = '<div data-component="render-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Initially not in DOM
      expect(portalTarget.querySelector('.rendered-content')).toBeNull()

      // Add to DOM - directly update state
      const instance = wildflower.getComponent('render-portal')
      instance.state.renderModal = true
      await waitForUpdate()
      expect(portalTarget.querySelector('.rendered-content')).not.toBeNull()

      // Remove from DOM
      instance.state.renderModal = false
      await waitForUpdate()
      expect(portalTarget.querySelector('.rendered-content')).toBeNull()
    })
  })

  // ==========================================
  // Cleanup on Component Destroy
  // ==========================================
  describe('Cleanup', () => {
    it('removes portaled content when source component is destroyed', async () => {
      wildflower.component('destroyable-portal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="cleanup-test">Will be removed</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="destroyable-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Verify content exists
      expect(portalTarget.querySelector('.cleanup-test')).not.toBeNull()

      // Destroy by removing from DOM
      testContainer.innerHTML = ''
      await wildflower.garbageCollect()
      await waitForUpdate()

      // Content should be removed from portal target
      expect(portalTarget.querySelector('.cleanup-test')).toBeNull()
    })

    it('cleans up multiple portals from same component', async () => {
      wildflower.component('multi-cleanup', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="portal-1">First</div>
            </div>
            <div data-portal="body">
              <div class="portal-2" data-portaled>Second</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="multi-cleanup"></div>'
      await wildflower.scan()
      await waitForUpdate()

      expect(portalTarget.querySelector('.portal-1')).not.toBeNull()
      expect(document.body.querySelector('.portal-2')).not.toBeNull()

      // Destroy
      testContainer.innerHTML = ''
      await wildflower.garbageCollect()
      await waitForUpdate()

      expect(portalTarget.querySelector('.portal-1')).toBeNull()
      expect(document.body.querySelector('.portal-2')).toBeNull()
    })
  })

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    it('handles missing target gracefully', async () => {
      let warningLogged = false
      const originalConsoleWarn = console.warn
      console.warn = (...args) => {
        // _log prepends '[WF] ' as args[0], message is in args[1]
        const fullMessage = args.join(' ')
        if (fullMessage.toLowerCase().includes('portal target not found')) {
          warningLogged = true
        }
        originalConsoleWarn.apply(console, args)
      }

      wildflower.component('missing-target-portal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#nonexistent-target">
              <div class="orphan-content">Orphan</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="missing-target-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      console.warn = originalConsoleWarn

      // Should warn about missing target (only in non-minified builds - console.* is stripped in production)
      if (hasConsoleWarnings()) {
        expect(warningLogged).toBe(true)
      }

      // Content should stay in the source portal element (not teleported)
      // Query from the component to ensure it stayed in place
      const component = testContainer.querySelector('[data-component="missing-target-portal"]')
      expect(component.querySelector('.orphan-content')).not.toBeNull()
    })

    it('supports multiple portals to same target', async () => {
      wildflower.component('multi-portal-a', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="from-a">From A</div>
            </div>
          `
        }
      })

      wildflower.component('multi-portal-b', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="from-b">From B</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-portal-a"></div>
        <div data-component="multi-portal-b"></div>
      `
      await wildflower.scan()
      await waitForUpdate()

      // Both should be present
      expect(portalTarget.querySelector('.from-a')).not.toBeNull()
      expect(portalTarget.querySelector('.from-b')).not.toBeNull()
    })

    it('portal inside data-list renders correctly', async () => {
      // Use pre-defined HTML to ensure list is discovered during initialization
      testContainer.innerHTML = `
        <div data-component="list-with-portals">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
                <div data-portal="#portal-target">
                  <div class="list-portal" data-bind="name"></div>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-with-portals', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' }
          ]
        }
      })

      await wildflower.scan()
      await waitForUpdate(100)

      const portaledItems = portalTarget.querySelectorAll('.list-portal')
      expect(portaledItems.length).toBe(2)

      // Verify binding works in portaled content
      expect(portaledItems[0].textContent).toBe('Item 1')
      expect(portaledItems[1].textContent).toBe('Item 2')
    })

    it('nested portals work (portal inside portal)', async () => {
      // Create a second portal target
      const nestedTarget = document.createElement('div')
      nestedTarget.id = 'nested-portal-target'
      document.body.appendChild(nestedTarget)

      wildflower.component('nested-portals', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="outer-portal">
                Outer
                <div data-portal="#nested-portal-target">
                  <div class="inner-portal">Inner</div>
                </div>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="nested-portals"></div>'
      await wildflower.scan()
      await waitForUpdate()

      expect(portalTarget.querySelector('.outer-portal')).not.toBeNull()
      expect(nestedTarget.querySelector('.inner-portal')).not.toBeNull()

      // Cleanup
      nestedTarget.remove()
    })

    it('empty portal element is valid', async () => {
      wildflower.component('empty-portal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target"></div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="empty-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Should not throw, portal target should be unchanged
      expect(portalTarget.children.length).toBe(0)
    })

    it('portal with class selector works', async () => {
      // Add a class-based target
      const classTarget = document.createElement('div')
      classTarget.className = 'portal-class-target'
      document.body.appendChild(classTarget)

      wildflower.component('class-selector-portal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal=".portal-class-target">
              <div class="class-portaled">Content</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="class-selector-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      expect(classTarget.querySelector('.class-portaled')).not.toBeNull()

      // Cleanup
      classTarget.remove()
    })
  })

  // ==========================================
  // Modal Pattern via Portal
  // ==========================================
  describe('Modal Pattern', () => {
    it('implements modal open/close pattern with portal', async () => {
      wildflower.component('modal-pattern', {
        state: { isOpen: false },
        init() {
          this.element.innerHTML = `
            <div data-portal="body" data-show="isOpen">
              <div class="modal-overlay" data-portaled>
                <div class="modal-dialog">
                  <h2>Modal Title</h2>
                  <p>Modal content here</p>
                  <button class="close-btn" data-action="closeModal">Close</button>
                </div>
              </div>
            </div>
          `
        },
        closeModal() {
          this.state.isOpen = false
        }
      })

      testContainer.innerHTML = '<div data-component="modal-pattern"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Initially closed - no modal portaled to body
      // Check that modal isn't a direct child of body (it's inside the component, hidden)
      const directBodyModal = () => Array.from(document.body.children).find(el => el.querySelector && el.classList && el.classList.contains('modal-overlay'))
      expect(directBodyModal()).toBeUndefined()

      // Open - directly update state
      const instance = wildflower.getComponent('modal-pattern')
      instance.state.isOpen = true
      await waitForUpdate()
      // Modal should now be portaled to body (direct child)
      const modalInBody = document.body.querySelector(':scope > .modal-overlay')
      expect(modalInBody).not.toBeNull()

      // Close via button inside portal
      document.body.querySelector('.close-btn').click()
      await waitForUpdate()
      // Modal should be hidden (moved back to source component)
      // Check it's not a direct child of body anymore
      const modalStillInBody = document.body.querySelector(':scope > .modal-overlay')
      expect(modalStillInBody).toBeNull()
    })

    it('modal portal preserves backdrop click handling', async () => {
      let backdropClicked = false

      wildflower.component('backdrop-modal', {
        state: { isOpen: true },
        init() {
          this.element.innerHTML = `
            <div data-portal="body" data-show="isOpen">
              <div class="backdrop" data-action="handleBackdrop" data-portaled>
                <div class="dialog">
                  Dialog content
                </div>
              </div>
            </div>
          `
        },
        handleBackdrop(event) {
          if (event.target.classList.contains('backdrop')) {
            backdropClicked = true
            this.state.isOpen = false
          }
        }
      })

      testContainer.innerHTML = '<div data-component="backdrop-modal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const backdrop = document.body.querySelector('.backdrop')
      expect(backdrop).not.toBeNull()

      // Click backdrop (not dialog)
      backdrop.click()
      await waitForUpdate()

      expect(backdropClicked).toBe(true)
    })
  })

  // ==========================================
  // Tooltip/Dropdown Pattern
  // ==========================================
  describe('Tooltip/Dropdown Pattern', () => {
    it('tooltip escapes overflow:hidden container', async () => {
      wildflower.component('tooltip-demo', {
        state: { showTooltip: false },
        init() {
          this.element.innerHTML = `
            <div style="overflow: hidden; width: 100px; height: 50px;">
              <button
                data-action="showTip:mouseenter"
                data-action-hide="hideTip:mouseleave">
                Hover me
              </button>
              <div data-portal="body" data-show="showTooltip">
                <div class="tooltip" data-portaled>Helpful tooltip text</div>
              </div>
            </div>
          `
        },
        showTip() {
          this.state.showTooltip = true
        },
        hideTip() {
          this.state.showTooltip = false
        }
      })

      testContainer.innerHTML = '<div data-component="tooltip-demo"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Manually trigger show
      const instance = Array.from(wildflower.componentInstances.values())
        .find(c => c.name === 'tooltip-demo')
      instance.context.showTip()
      await waitForUpdate()

      // Tooltip should be at body level, escaping overflow:hidden
      const tooltip = document.body.querySelector('.tooltip')
      expect(tooltip).not.toBeNull()
      expect(tooltip.textContent).toBe('Helpful tooltip text')
    })
  })

  // ==========================================
  // Additional Edge Cases
  // ==========================================
  describe('Advanced Edge Cases', () => {
    // Note: Portal cleanup on list item removal is a known limitation.
    // Portals in list items work for rendering, but cleanup when items are
    // removed requires tracking which portals belong to which list items.
    // This test documents the current behavior (portals persist).
    it('portals in list items render correctly with initial data', async () => {
      testContainer.innerHTML = `
        <div data-component="list-portal-render-test">
          <ul data-list="renderItems">
            <template>
              <li>
                <span data-bind="name"></span>
                <div data-portal="#portal-target">
                  <div class="list-item-portal" data-bind="name"></div>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-portal-render-test', {
        state: {
          renderItems: [
            { id: 1, name: 'First' },
            { id: 2, name: 'Second' },
            { id: 3, name: 'Third' }
          ]
        }
      })

      await wildflower.scan()
      await waitForUpdate(100)

      // Should have 3 portaled items
      const portaledItems = portalTarget.querySelectorAll('.list-item-portal')
      expect(portaledItems.length).toBe(3)
      expect(portaledItems[0].textContent).toBe('First')
      expect(portaledItems[1].textContent).toBe('Second')
      expect(portaledItems[2].textContent).toBe('Third')
    })

    it('actions work inside portaled list item content (basic functionality)', async () => {
      let actionCalled = false

      testContainer.innerHTML = `
        <div data-component="list-action-portal">
          <ul data-list="actionItemsUnique">
            <template>
              <li>
                <span data-bind="name"></span>
                <div data-portal="#portal-target">
                  <button class="action-btn" data-action="handleClick" data-bind="name"></button>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-action-portal', {
        state: {
          actionItemsUnique: [
            { id: 1, name: 'Action 1' },
            { id: 2, name: 'Action 2' }
          ]
        },
        handleClick(e, ctx) {
          actionCalled = true
          // Note: ctx.index may be undefined for portaled content
          // because list context isn't fully preserved when teleported.
          // Use data attributes or other methods to identify items.
        }
      })

      await wildflower.scan()
      await waitForUpdate(100)

      const buttons = portalTarget.querySelectorAll('.action-btn')
      expect(buttons.length).toBe(2)

      // Click second button - action should fire
      buttons[1].click()
      await waitForUpdate()

      expect(actionCalled).toBe(true)
    })

    it('rapid state changes do not cause orphaned portal content', async () => {
      wildflower.component('rapid-toggle-portal', {
        state: { visible: false },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target" data-show="visible">
              <div class="rapid-content">Content</div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="rapid-toggle-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('rapid-toggle-portal')

      // Rapid toggling
      for (let i = 0; i < 10; i++) {
        instance.state.visible = true
        instance.state.visible = false
      }

      await waitForUpdate(50)

      // Should end up hidden with no orphaned content
      expect(portalTarget.querySelector('.rapid-content')).toBeNull()

      // Show one more time
      instance.state.visible = true
      await waitForUpdate()

      // Should have exactly one instance
      const contents = portalTarget.querySelectorAll('.rapid-content')
      expect(contents.length).toBe(1)
    })

    it('portal with deeply nested bindings maintains reactivity', async () => {
      wildflower.component('deep-binding-portal', {
        state: {
          user: {
            profile: {
              name: 'Initial Name',
              email: 'initial@test.com'
            }
          }
        },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="deep-portal">
                <span class="deep-name" data-bind="user.profile.name"></span>
                <span class="deep-email" data-bind="user.profile.email"></span>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="deep-binding-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      // Initial values
      expect(portalTarget.querySelector('.deep-name').textContent).toBe('Initial Name')
      expect(portalTarget.querySelector('.deep-email').textContent).toBe('initial@test.com')

      // Update nested state
      const instance = wildflower.getComponent('deep-binding-portal')
      instance.state.user = {
        profile: {
          name: 'Updated Name',
          email: 'updated@test.com'
        }
      }
      await waitForUpdate()

      // Should reflect updates
      expect(portalTarget.querySelector('.deep-name').textContent).toBe('Updated Name')
      expect(portalTarget.querySelector('.deep-email').textContent).toBe('updated@test.com')
    })

    it('multiple components can portal to same target without interference', async () => {
      wildflower.component('multi-portal-1', {
        state: { count: 0 },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="portal-1">Count: <span data-bind="count"></span></div>
            </div>
          `
        }
      })

      wildflower.component('multi-portal-2', {
        state: { message: 'Hello' },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="portal-2">Message: <span data-bind="message"></span></div>
            </div>
          `
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-portal-1"></div>
        <div data-component="multi-portal-2"></div>
      `
      await wildflower.scan()
      await waitForUpdate()

      // Both should be present
      expect(portalTarget.querySelector('.portal-1')).not.toBeNull()
      expect(portalTarget.querySelector('.portal-2')).not.toBeNull()

      // Update each independently
      const instance1 = wildflower.getComponent('multi-portal-1')
      const instance2 = wildflower.getComponent('multi-portal-2')

      instance1.state.count = 42
      instance2.state.message = 'World'
      await waitForUpdate()

      // Each should update independently
      expect(portalTarget.querySelector('.portal-1 span').textContent).toBe('42')
      expect(portalTarget.querySelector('.portal-2 span').textContent).toBe('World')
    })

    it('portal show/hide cycle works correctly (modal can reopen)', async () => {
      wildflower.component('modal-cycle-test', {
        state: { isOpen: false },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target" data-show="isOpen">
              <div class="modal-content">
                <span>Modal Content</span>
                <button class="close-btn" data-action="closeModal">Close</button>
              </div>
            </div>
          `
        },
        closeModal() {
          this.state.isOpen = false
        }
      })

      testContainer.innerHTML = '<div data-component="modal-cycle-test"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('modal-cycle-test')

      // Initially closed
      expect(portalTarget.querySelector('.modal-content')).toBeNull()

      // Open modal (direct state update, like other passing tests)
      instance.state.isOpen = true
      await waitForUpdate()
      expect(portalTarget.querySelector('.modal-content')).not.toBeNull()

      // Close modal via button inside portal
      portalTarget.querySelector('.close-btn').click()
      await waitForUpdate()
      expect(portalTarget.querySelector('.modal-content')).toBeNull()

      // Reopen modal - this is the regression test for show/hide cycle
      instance.state.isOpen = true
      await waitForUpdate()
      expect(portalTarget.querySelector('.modal-content')).not.toBeNull()

      // Close again via button
      portalTarget.querySelector('.close-btn').click()
      await waitForUpdate()
      expect(portalTarget.querySelector('.modal-content')).toBeNull()

      // Third cycle to ensure stability
      instance.state.isOpen = true
      await waitForUpdate()
      expect(portalTarget.querySelector('.modal-content')).not.toBeNull()
    })

    it('portal in list item can access item-level data-show property', async () => {
      testContainer.innerHTML = `
        <div data-component="list-item-portal-show">
          <ul data-list="listItems">
            <template>
              <li>
                <span class="item-name" data-bind="name"></span>
                <div data-portal="#portal-target" data-show="showConfirm">
                  <div class="confirm-dialog">
                    <span class="confirm-text" data-bind="name"></span>
                  </div>
                </div>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-item-portal-show', {
        state: {
          listItems: [
            { id: 1, name: 'Item A', showConfirm: false },
            { id: 2, name: 'Item B', showConfirm: false },
            { id: 3, name: 'Item C', showConfirm: false }
          ]
        }
      })

      await wildflower.scan()
      await waitForUpdate(100)

      const instance = wildflower.getComponent('list-item-portal-show')

      // Initially no confirm dialogs visible (item-level showConfirm is false)
      expect(portalTarget.querySelectorAll('.confirm-dialog').length).toBe(0)

      // Toggle showConfirm for second item via direct state update
      instance.state.listItems[1].showConfirm = true
      await waitForUpdate()

      // Confirm dialog for second item should be visible with item's name
      const confirmDialogs = portalTarget.querySelectorAll('.confirm-dialog')
      expect(confirmDialogs.length).toBe(1)
      expect(confirmDialogs[0].querySelector('.confirm-text').textContent).toBe('Item B')

      // Hide the dialog
      instance.state.listItems[1].showConfirm = false
      await waitForUpdate()
      expect(portalTarget.querySelectorAll('.confirm-dialog').length).toBe(0)

      // Reopen the same item's dialog to verify cycle works
      instance.state.listItems[1].showConfirm = true
      await waitForUpdate()
      expect(portalTarget.querySelectorAll('.confirm-dialog').length).toBe(1)

      // Open a different item's dialog
      instance.state.listItems[0].showConfirm = true
      await waitForUpdate()
      // Now should have 2 dialogs (Item A and Item B)
      expect(portalTarget.querySelectorAll('.confirm-dialog').length).toBe(2)
    })

    it('portal survives parent component re-render', async () => {
      wildflower.component('rerender-portal', {
        state: {
          parentValue: 'Parent 1',
          portalValue: 'Portal 1'
        },
        init() {
          this.element.innerHTML = `
            <div class="parent-content" data-bind="parentValue"></div>
            <div data-portal="#portal-target">
              <div class="survive-portal" data-bind="portalValue"></div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="rerender-portal"></div>'
      await wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('rerender-portal')

      // Initial state
      expect(portalTarget.querySelector('.survive-portal').textContent).toBe('Portal 1')

      // Update parent value (triggers re-render of parent content)
      instance.state.parentValue = 'Parent 2'
      await waitForUpdate()

      // Portal should still be there
      expect(portalTarget.querySelector('.survive-portal')).not.toBeNull()
      expect(portalTarget.querySelector('.survive-portal').textContent).toBe('Portal 1')

      // Update portal value
      instance.state.portalValue = 'Portal 2'
      await waitForUpdate()

      expect(portalTarget.querySelector('.survive-portal').textContent).toBe('Portal 2')
    })
  })
})
