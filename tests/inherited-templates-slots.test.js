/**
 * WildflowerJS Inherited Templates - Slot-like Usage Test Suite
 *
 * Tests for using data-item-template / data-use-template OUTSIDE of lists.
 * This extends Configurable Component Templates to work anywhere, similar to
 * Vue's scoped slots but with WildflowerJS's simpler syntax.
 *
 * Key features:
 * - data-use-template with data-with="path" binds template to specified state path
 * - Actions resolve to the component where template is USED (not defined)
 * - Template doesn't render if data-with path resolves to null/undefined
 *
 * TDD Implementation - Tests written first, implementation to follow.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasConsoleWarnings, waitForUpdate, waitForCompleteRender, waitForDOM, hasFeature } from './helpers/load-framework.js'

// Skip entire suite if configurable-templates feature is not available
const suiteRunner = hasFeature('configurable-templates') ? describe : describe.skip

suiteRunner('Inherited Templates - Slot-like Usage (data-with)', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Clear the context registry
    if (wildflower._contextRegistry) {
      wildflower._contextRegistry.contexts?.clear()
      wildflower._contextRegistry.contextsByType?.clear()
      wildflower._contextRegistry.contextsByComponent?.clear()
      wildflower._contextRegistry.dependencies?.clear()
      wildflower._contextRegistry._contextTypeCache?.clear()
      wildflower._contextRegistry._contextModificationCounter = 0
    }

    // Clear list relationships
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
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
  // SECTION 1: Basic data-with Usage
  // ============================================
  describe('Basic data-with Usage', () => {

    it('should render template with data-with binding to state path', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span class="name" data-bind="name"></span>
              <span class="email" data-bind="email"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="currentUser"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', {
        state: {}
      })

      wildflower.component('child-comp', {
        state: {
          currentUser: { name: 'Alice', email: 'alice@example.com' }
        }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('.card')
      expect(card).toBeDefined()
      expect(card.querySelector('.name').textContent).toBe('Alice')
      expect(card.querySelector('.email').textContent).toBe('alice@example.com')
    })

    it('should update when data-with path value changes', async () => {
      let childInstance

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span class="name" data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="currentUser"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          currentUser: { name: 'Alice' }
        },
        init() { childInstance = this }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.name').textContent).toBe('Alice')

      // Update the user
      childInstance.state.currentUser = { name: 'Bob' }
      await waitForUpdate()

      expect(testContainer.querySelector('.name').textContent).toBe('Bob')
    })

    it('should support nested property paths in data-with', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="address-card">
            <div class="address">
              <span class="city" data-bind="city"></span>
              <span class="country" data-bind="country"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="address-card" data-with="user.address"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          user: {
            name: 'Alice',
            address: { city: 'New York', country: 'USA' }
          }
        }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.city').textContent).toBe('New York')
      expect(testContainer.querySelector('.country').textContent).toBe('USA')
    })

  })

  // ============================================
  // SECTION 2: Null/Undefined Handling
  // ============================================
  describe('Null/Undefined Handling', () => {

    it('should not render template when data-with path is null', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <div class="container">
              <template data-use-template="user-card" data-with="selectedUser"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          selectedUser: null
        }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('.card')
      expect(card).toBeNull()
    })

    it('should not render template when data-with path is undefined', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <div class="container">
              <template data-use-template="user-card" data-with="selectedUser"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          // selectedUser is undefined
        }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('.card')
      expect(card).toBeNull()
    })

    it('should render template when data-with value becomes non-null', async () => {
      let childInstance

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span class="name" data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <div class="container">
              <template data-use-template="user-card" data-with="selectedUser"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: { selectedUser: null },
        init() { childInstance = this }
      })

      await waitForCompleteRender()

      // Initially null - no card
      expect(testContainer.querySelector('.card')).toBeNull()

      // Set a value
      childInstance.state.selectedUser = { name: 'Alice' }
      await waitForUpdate()

      // Now card should appear
      const card = testContainer.querySelector('.card')
      expect(card).toBeDefined()
      expect(card.querySelector('.name').textContent).toBe('Alice')
    })

    it('should remove template when data-with value becomes null', async () => {
      let childInstance

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span class="name" data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <div class="container">
              <template data-use-template="user-card" data-with="selectedUser"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: { selectedUser: { name: 'Alice' } },
        init() { childInstance = this }
      })

      await waitForCompleteRender()

      // Initially has value - card present
      expect(testContainer.querySelector('.card')).toBeDefined()

      // Set to null
      childInstance.state.selectedUser = null
      await waitForUpdate()

      // Card should be removed
      expect(testContainer.querySelector('.card')).toBeNull()
    })

  })

  // ============================================
  // SECTION 3: Action Binding Context
  // ============================================
  describe('Action Binding Context', () => {

    it('should bind actions to child component methods (not parent)', async () => {
      let actionCalledOn = null

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span data-bind="name"></span>
              <button class="edit-btn" data-action="editUser">Edit</button>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="currentUser"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', {
        state: {},
        editUser() {
          actionCalledOn = 'parent'
        }
      })

      wildflower.component('child-comp', {
        state: {
          currentUser: { name: 'Alice' }
        },
        editUser() {
          actionCalledOn = 'child'
        }
      })

      await waitForCompleteRender()

      const button = testContainer.querySelector('.edit-btn')
      button.click()
      await waitForUpdate()

      expect(actionCalledOn).toBe('child')
    })

    it('should provide data-with context in action details', async () => {
      let receivedDetails = null

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <button class="delete-btn" data-action="deleteUser">Delete</button>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="currentUser"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          currentUser: { id: 123, name: 'Alice' }
        },
        deleteUser(event, element, details) {
          receivedDetails = details
        }
      })

      await waitForCompleteRender()

      testContainer.querySelector('.delete-btn').click()
      await waitForUpdate()

      expect(receivedDetails).toBeDefined()
      // Use JSON round-trip to strip Symbol properties for comparison
      expect(JSON.parse(JSON.stringify(receivedDetails.item))).toEqual({ id: 123, name: 'Alice' })
    })

  })

  // ============================================
  // SECTION 4: Template Hierarchy Lookup
  // ============================================
  describe('Template Hierarchy Lookup', () => {

    it('should find template in direct parent component', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="info-card">
            <div class="info">
              <span data-bind="title"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="info-card" data-with="data"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: { data: { title: 'Hello' } }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.info span').textContent).toBe('Hello')
    })

    it('should find template in grandparent component', async () => {
      testContainer.innerHTML = `
        <div data-component="grandparent-comp">
          <template data-item-template="info-card">
            <div class="info">
              <span data-bind="title"></span>
            </div>
          </template>

          <div data-component="parent-comp">
            <div data-component="child-comp">
              <template data-use-template="info-card" data-with="data"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('grandparent-comp', { state: {} })
      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: { data: { title: 'From Grandparent' } }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.info span').textContent).toBe('From Grandparent')
    })

    it('should support @componentName syntax for explicit ancestor targeting', async () => {
      testContainer.innerHTML = `
        <div data-component="grandparent-comp">
          <template data-item-template="card">
            <div class="grandparent-card">
              <span data-bind="value"></span>
            </div>
          </template>

          <div data-component="parent-comp">
            <template data-item-template="card">
              <div class="parent-card">
                <span data-bind="value"></span>
              </div>
            </template>

            <div data-component="child-comp">
              <template data-use-template="card@grandparent-comp" data-with="data"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('grandparent-comp', { state: {} })
      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: { data: { value: 'Test' } }
      })

      await waitForCompleteRender()

      // Should use grandparent's template, skipping parent's
      expect(testContainer.querySelector('.grandparent-card')).toBeDefined()
      expect(testContainer.querySelector('.parent-card')).toBeNull()
    })

  })

  // ============================================
  // SECTION 5: Multiple Slots Pattern
  // ============================================
  describe('Multiple Slots Pattern', () => {

    it('should support multiple data-with templates in same component', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="header-template">
            <header class="header">
              <h1 data-bind="title"></h1>
            </header>
          </template>

          <template data-item-template="footer-template">
            <footer class="footer">
              <span data-bind="copyright"></span>
            </footer>
          </template>

          <div data-component="page-comp">
            <template data-use-template="header-template" data-with="headerData"></template>
            <div class="content">Main content</div>
            <template data-use-template="footer-template" data-with="footerData"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('page-comp', {
        state: {
          headerData: { title: 'My Page' },
          footerData: { copyright: '2024 Acme Inc' }
        }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.header h1').textContent).toBe('My Page')
      expect(testContainer.querySelector('.footer span').textContent).toBe('2024 Acme Inc')
    })

    it('should update slots independently', async () => {
      let childInstance

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="user-card">
              <span data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <div class="primary">
              <template data-use-template="user-card" data-with="primaryUser"></template>
            </div>
            <div class="secondary">
              <template data-use-template="user-card" data-with="secondaryUser"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          primaryUser: { name: 'Alice' },
          secondaryUser: { name: 'Bob' }
        },
        init() { childInstance = this }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.primary .user-card span').textContent).toBe('Alice')
      expect(testContainer.querySelector('.secondary .user-card span').textContent).toBe('Bob')

      // Update only primary
      childInstance.state.primaryUser = { name: 'Charlie' }
      await waitForUpdate()

      expect(testContainer.querySelector('.primary .user-card span').textContent).toBe('Charlie')
      expect(testContainer.querySelector('.secondary .user-card span').textContent).toBe('Bob')
    })

  })

  // ============================================
  // SECTION 6: Coexistence with List Usage
  // ============================================
  describe('Coexistence with List Usage', () => {

    it('should support same template used in both list and slot contexts', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="user-card">
              <span class="name" data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <!-- Slot usage -->
            <div class="featured">
              <template data-use-template="user-card" data-with="featuredUser"></template>
            </div>

            <!-- List usage -->
            <div class="all-users" data-list="users">
              <template data-use-template="user-card"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          featuredUser: { name: 'Featured Alice' },
          users: [
            { name: 'User 1' },
            { name: 'User 2' }
          ]
        }
      })

      await waitForCompleteRender()

      // Slot renders featured user
      expect(testContainer.querySelector('.featured .name').textContent).toBe('Featured Alice')

      // List renders all users
      const listItems = testContainer.querySelectorAll('.all-users .user-card')
      expect(listItems.length).toBe(2)
      expect(listItems[0].querySelector('.name').textContent).toBe('User 1')
      expect(listItems[1].querySelector('.name').textContent).toBe('User 2')
    })

  })

  // ============================================
  // SECTION 7: Model Binding Integration
  // ============================================
  describe('Model Binding Integration', () => {

    it('should support data-model in slot templates', async () => {
      let childInstance

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="edit-form">
            <div class="form">
              <input type="text" class="name-input" data-model="name">
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="edit-form" data-with="editingUser"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          editingUser: { name: 'Alice' }
        },
        init() { childInstance = this }
      })

      await waitForCompleteRender()

      const input = testContainer.querySelector('.name-input')
      expect(input.value).toBe('Alice')

      // Simulate user input
      input.value = 'Bob'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      expect(childInstance.state.editingUser.name).toBe('Bob')
    })

  })

  // ============================================
  // SECTION 8: Conditional Rendering Integration
  // ============================================
  describe('Conditional Rendering Integration', () => {

    it('should support data-show inside slot templates', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span class="name" data-bind="name"></span>
              <span class="admin-badge" data-show="isAdmin">Admin</span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="user"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          user: { name: 'Alice', isAdmin: true }
        }
      })

      await waitForCompleteRender()

      const badge = testContainer.querySelector('.admin-badge')
      expect(badge).toBeDefined()
      expect(badge.style.display).not.toBe('none')
    })

    it('should support data-bind-class inside slot templates', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card" data-bind-class="active ? 'is-active' : ''">
              <span data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="user"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          user: { name: 'Alice', active: true }
        }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('.card')
      expect(card.classList.contains('is-active')).toBe(true)
    })

  })

  // ============================================
  // SECTION 9: Fallback Templates
  // ============================================
  describe('Fallback Templates', () => {

    it('should use inline fallback when parent template not found', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <!-- No template defined -->

          <div data-component="child-comp">
            <template data-use-template="missing-template" data-with="data">
              <div class="fallback">
                <span data-bind="value"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          data: { value: 'Fallback Value' }
        }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.fallback span').textContent).toBe('Fallback Value')
    })

  })

  // ============================================
  // SECTION 10: DOM Context Variations
  // ============================================
  describe('DOM Context Variations', () => {

    it('should render as direct child of component element', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card"><span data-bind="name"></span></div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="card" data-with="user"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: { user: { name: 'Alice' } }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('[data-component="child-comp"] > .card')
      expect(card).toBeDefined()
      expect(card.querySelector('span').textContent).toBe('Alice')
    })

    it('should render nested inside multiple div layers', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card"><span data-bind="name"></span></div>
          </template>

          <div data-component="child-comp">
            <div class="wrapper">
              <div class="inner">
                <div class="deep">
                  <template data-use-template="card" data-with="user"></template>
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: { user: { name: 'Deep Alice' } }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('.deep .card')
      expect(card).toBeDefined()
      expect(card.querySelector('span').textContent).toBe('Deep Alice')
    })

    it('should render inside a conditional data-show block', async () => {
      let childInstance

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card"><span data-bind="name"></span></div>
          </template>

          <div data-component="child-comp">
            <div class="conditional-wrapper" data-show="showCard">
              <template data-use-template="card" data-with="user"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: {
          showCard: true,
          user: { name: 'Conditional Alice' }
        },
        init() { childInstance = this }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.card span').textContent).toBe('Conditional Alice')

      // Hide the conditional
      childInstance.state.showCard = false
      await waitForUpdate()

      // Card should be hidden (display: none on wrapper)
      const wrapper = testContainer.querySelector('.conditional-wrapper')
      expect(wrapper.style.display).toBe('none')
    })

    it('should render inside a data-render block', async () => {
      let childInstance

      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card"><span data-bind="name"></span></div>
          </template>

          <div data-component="child-comp">
            <div class="render-wrapper" data-render="renderCard">
              <template data-use-template="card" data-with="user"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: {
          renderCard: false,
          user: { name: 'Render Alice' }
        },
        init() { childInstance = this }
      })

      await waitForCompleteRender()

      // Initially not rendered
      expect(testContainer.querySelector('.card')).toBeNull()

      // Enable rendering
      childInstance.state.renderCard = true
      await waitForUpdate()

      // Now card should appear
      expect(testContainer.querySelector('.card span').textContent).toBe('Render Alice')
    })

    it('should render alongside static sibling content', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card"><span data-bind="name"></span></div>
          </template>

          <div data-component="child-comp">
            <h2 class="title">User Profile</h2>
            <template data-use-template="card" data-with="user"></template>
            <p class="footer">End of profile</p>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: { user: { name: 'Alice' } }
      })

      await waitForCompleteRender()

      // All siblings should be present
      expect(testContainer.querySelector('.title').textContent).toBe('User Profile')
      expect(testContainer.querySelector('.card span').textContent).toBe('Alice')
      expect(testContainer.querySelector('.footer').textContent).toBe('End of profile')
    })

    it('should render inside a form element', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="form-fields">
            <div class="fields">
              <input type="text" class="name-input" data-model="name">
              <input type="email" class="email-input" data-model="email">
            </div>
          </template>

          <div data-component="child-comp">
            <form class="user-form">
              <template data-use-template="form-fields" data-with="formData"></template>
              <button type="submit">Submit</button>
            </form>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: {
          formData: { name: 'Alice', email: 'alice@example.com' }
        }
      })

      await waitForCompleteRender()

      const form = testContainer.querySelector('.user-form')
      expect(form.querySelector('.name-input').value).toBe('Alice')
      expect(form.querySelector('.email-input').value).toBe('alice@example.com')
    })

    it('should render inside table cells', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-cells">
            <td class="name-cell" data-bind="name"></td>
            <td class="email-cell" data-bind="email"></td>
          </template>

          <div data-component="child-comp">
            <table>
              <tbody>
                <tr>
                  <template data-use-template="user-cells" data-with="user"></template>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: {
          user: { name: 'Alice', email: 'alice@example.com' }
        }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.name-cell').textContent).toBe('Alice')
      expect(testContainer.querySelector('.email-cell').textContent).toBe('alice@example.com')
    })

    it('should render inside flexbox container', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="flex-item">
            <div class="flex-card"><span data-bind="label"></span></div>
          </template>

          <div data-component="child-comp">
            <div class="flex-container" style="display: flex; gap: 10px;">
              <div class="static-item">Static</div>
              <template data-use-template="flex-item" data-with="item1"></template>
              <template data-use-template="flex-item" data-with="item2"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: {
          item1: { label: 'First' },
          item2: { label: 'Second' }
        }
      })

      await waitForCompleteRender()

      const container = testContainer.querySelector('.flex-container')
      const cards = container.querySelectorAll('.flex-card')
      expect(cards.length).toBe(2)
      expect(cards[0].querySelector('span').textContent).toBe('First')
      expect(cards[1].querySelector('span').textContent).toBe('Second')
    })

    it('should render in correct position relative to siblings', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="marker">
            <span class="marker" data-bind="id"></span>
          </template>

          <div data-component="child-comp">
            <div class="container">
              <span class="pos-1">1</span>
              <template data-use-template="marker" data-with="marker2"></template>
              <span class="pos-3">3</span>
              <template data-use-template="marker" data-with="marker4"></template>
              <span class="pos-5">5</span>
            </div>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })
      wildflower.component('child-comp', {
        state: {
          marker2: { id: '2' },
          marker4: { id: '4' }
        }
      })

      await waitForCompleteRender()

      // Check order of children
      const container = testContainer.querySelector('.container')
      const children = Array.from(container.children)
      const texts = children.map(el => el.textContent)

      expect(texts).toEqual(['1', '2', '3', '4', '5'])
    })

  })

  // ============================================
  // SECTION 11: Edge Cases
  // ============================================
  describe('Edge Cases', () => {

    it('should handle empty object for data-with', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card">
              <span class="name" data-bind="name"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="card" data-with="data"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          data: {} // Empty but not null
        }
      })

      await waitForCompleteRender()

      // Should render (empty object is truthy)
      const card = testContainer.querySelector('.card')
      expect(card).toBeDefined()
      expect(card.querySelector('.name').textContent).toBe('')
    })

    it('should handle boolean false for data-with (should not render)', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card">Content</div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="card" data-with="data"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          data: false
        }
      })

      await waitForCompleteRender()

      // false is falsy - should not render
      expect(testContainer.querySelector('.card')).toBeNull()
    })

    it('should handle number 0 for data-with (should not render)', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card">Content</div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="card" data-with="data"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          data: 0
        }
      })

      await waitForCompleteRender()

      // 0 is falsy - should not render
      expect(testContainer.querySelector('.card')).toBeNull()
    })

    it('should handle empty string for data-with (should not render)', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="card">
            <div class="card">Content</div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="card" data-with="data"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          data: ''
        }
      })

      await waitForCompleteRender()

      // Empty string is falsy - should not render
      expect(testContainer.querySelector('.card')).toBeNull()
    })

  })

  // ============================================
  // SECTION 12: Advanced Scenarios
  // ============================================
  describe('Advanced Scenarios', () => {

    it('should support data-with pointing to a computed property', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="user-card">
            <div class="card">
              <span class="name" data-bind="fullName"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="computed:computedUser"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          firstName: 'Computed',
          lastName: 'Alice'
        },
        computed: {
          computedUser() {
            return {
              fullName: this.state.firstName + ' ' + this.state.lastName
            }
          }
        }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.name').textContent).toBe('Computed Alice')
    })

    // Skipped: Requires feature implementation (Implicit Context)
    it.skip('should bind to component root state when data-with is omitted (Implicit Context)', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <template data-item-template="root-card">
            <div class="root-card">
              <span class="app-name" data-bind="appName"></span>
            </div>
          </template>

          <div data-component="child-comp">
            <!-- No data-with, should bind to child-comp state -->
            <template data-use-template="root-card"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          appName: 'My App'
        }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('.root-card')
      expect(card).toBeDefined()
      expect(card.querySelector('.app-name').textContent).toBe('My App')
    })

    // Skipped: Requires feature implementation (Nested Templates)
    it.skip('should support nested templates (Slot using another Slot)', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-comp">
          <!-- Inner Template -->
          <template data-item-template="badge">
            <span class="badge" data-bind="text"></span>
          </template>

          <!-- Outer Template uses Inner Template -->
          <template data-item-template="user-card">
            <div class="card">
              <span class="name" data-bind="name"></span>
              <template data-use-template="badge" data-with="badgeData"></template>
            </div>
          </template>

          <div data-component="child-comp">
            <template data-use-template="user-card" data-with="user"></template>
          </div>
        </div>
      `

      wildflower.component('parent-comp', { state: {} })

      wildflower.component('child-comp', {
        state: {
          user: {
            name: 'Alice',
            badgeData: { text: 'VIP' }
          }
        }
      })

      await waitForCompleteRender()

      const card = testContainer.querySelector('.card')
      expect(card).toBeDefined()
      expect(card.querySelector('.name').textContent).toBe('Alice')
      expect(card.querySelector('.badge').textContent).toBe('VIP')
    })

  })

})
