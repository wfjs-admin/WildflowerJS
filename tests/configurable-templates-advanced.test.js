/**
 * WildflowerJS Configurable Component Templates - Advanced Test Suite
 *
 * These tests cover edge cases and complex scenarios discovered during
 * the list initialization timing bug fix. They ensure the framework
 * handles combinations of:
 * - External templates (data-use-template)
 * - Data loaded in init() (like from localStorage)
 * - Nested lists
 * - Deep component hierarchies
 * - Computed properties
 * - Multiple lists sharing templates
 * - Dynamic template changes
 * - SSR hydration
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasConsoleWarnings, waitForUpdate, waitForCompleteRender, waitForDOM, hasFeature, getDistMode } from './helpers/load-framework.js'

// Skip entire suite if configurable-templates feature is not available (e.g., lite build)
const suiteRunner = hasFeature('configurable-templates') ? describe : describe.skip

suiteRunner('Configurable Templates - Advanced Scenarios', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Clear the context registry to prevent cross-test contamination
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
  // SECTION 1: Nested Lists with External Templates
  // ============================================
  describe('Nested Lists with External Templates', () => {

    it('should render outer list with external template containing inner inline list', async () => {
      // Outer list uses external template, inner list uses inline template
      testContainer.innerHTML = `
        <div data-component="nested-outer-provider">
          <template data-item-template="categoryCard">
            <div class="category-card">
              <h3 class="category-name" data-bind="name"></h3>
              <ul class="items-list" data-list="items">
                <template>
                  <li class="nested-item" data-bind="label"></li>
                </template>
              </ul>
            </div>
          </template>

          <div data-component="nested-outer-consumer">
            <div class="categories-list" data-list="categories">
              <template data-use-template="categoryCard"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('nested-outer-provider', { state: {} })
      wildflower.component('nested-outer-consumer', {
        state: {
          categories: []
        },
        init() {
          // Simulate loading nested data in init()
          this.state.categories = [
            { name: 'Category A', items: [{ label: 'A1' }, { label: 'A2' }] },
            { name: 'Category B', items: [{ label: 'B1' }, { label: 'B2' }, { label: 'B3' }] }
          ]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Verify outer list rendered
      const categoryCards = testContainer.querySelectorAll('.category-card')
      expect(categoryCards.length).toBe(2)

      // Verify category names
      const categoryNames = Array.from(testContainer.querySelectorAll('.category-name')).map(el => el.textContent)
      expect(categoryNames).toContain('Category A')
      expect(categoryNames).toContain('Category B')

      // Verify nested lists rendered
      const nestedItems = testContainer.querySelectorAll('.nested-item')
      expect(nestedItems.length).toBe(5) // 2 + 3

      // Verify nested item content
      const itemLabels = Array.from(nestedItems).map(el => el.textContent)
      expect(itemLabels).toContain('A1')
      expect(itemLabels).toContain('A2')
      expect(itemLabels).toContain('B1')
      expect(itemLabels).toContain('B2')
      expect(itemLabels).toContain('B3')
    })

    it('should update nested list when parent item data changes', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-update-provider">
          <template data-item-template="groupCard">
            <div class="group-card">
              <span class="group-name" data-bind="name"></span>
              <div class="members-list" data-list="members">
                <template>
                  <span class="member" data-bind="name"></span>
                </template>
              </div>
            </div>
          </template>

          <div data-component="nested-update-consumer">
            <div data-list="groups">
              <template data-use-template="groupCard"></template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('nested-update-provider', { state: {} })
      wildflower.component('nested-update-consumer', {
        state: {
          groups: [
            { name: 'Team 1', members: [{ name: 'Alice' }] }
          ]
        },
        init() { consumerInstance = this }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()

      // Initial state
      expect(testContainer.querySelectorAll('.member').length).toBe(1)

      // Add member to first group
      consumerInstance.state.groups[0].members.push({ name: 'Bob' })
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('.member').length).toBe(2)
      const memberNames = Array.from(testContainer.querySelectorAll('.member')).map(el => el.textContent)
      expect(memberNames).toContain('Alice')
      expect(memberNames).toContain('Bob')
    })

    it('should handle deeply nested lists (3 levels) with external template at top', async () => {
      testContainer.innerHTML = `
        <div data-component="deep-nest-provider">
          <template data-item-template="departmentCard">
            <div class="department">
              <h2 class="dept-name" data-bind="name"></h2>
              <div class="teams-list" data-list="teams">
                <template>
                  <div class="team">
                    <h3 class="team-name" data-bind="name"></h3>
                    <ul class="people-list" data-list="people">
                      <template>
                        <li class="person" data-bind="name"></li>
                      </template>
                    </ul>
                  </div>
                </template>
              </div>
            </div>
          </template>

          <div data-component="deep-nest-consumer">
            <div data-list="departments">
              <template data-use-template="departmentCard"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('deep-nest-provider', { state: {} })
      wildflower.component('deep-nest-consumer', {
        state: { departments: [] },
        init() {
          this.state.departments = [
            {
              name: 'Engineering',
              teams: [
                { name: 'Frontend', people: [{ name: 'Alice' }, { name: 'Bob' }] },
                { name: 'Backend', people: [{ name: 'Charlie' }] }
              ]
            }
          ]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Verify all levels rendered
      expect(testContainer.querySelectorAll('.department').length).toBe(1)
      expect(testContainer.querySelectorAll('.team').length).toBe(2)
      expect(testContainer.querySelectorAll('.person').length).toBe(3)

      // Verify content
      expect(testContainer.querySelector('.dept-name').textContent).toBe('Engineering')
      const teamNames = Array.from(testContainer.querySelectorAll('.team-name')).map(el => el.textContent)
      expect(teamNames).toContain('Frontend')
      expect(teamNames).toContain('Backend')
    })
  })

  // ============================================
  // SECTION 2: Deep Component Hierarchies
  // ============================================
  describe('Deep Component Hierarchies (Grandparent Templates)', () => {

    it('should find template defined at grandparent level when data is set in init()', async () => {
      testContainer.innerHTML = `
        <div data-component="hierarchy-grandparent">
          <template data-item-template="grandparentCard">
            <div class="gp-card">
              <span class="gp-value" data-bind="value"></span>
            </div>
          </template>

          <div data-component="hierarchy-parent">
            <div data-component="hierarchy-child">
              <div class="gp-list" data-list="items">
                <template data-use-template="grandparentCard"></template>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.component('hierarchy-grandparent', { state: {} })
      wildflower.component('hierarchy-parent', { state: {} })
      wildflower.component('hierarchy-child', {
        state: { items: [] },
        init() {
          // Data loaded in grandchild's init()
          this.state.items = [
            { value: 'From Grandchild 1' },
            { value: 'From Grandchild 2' }
          ]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      const cards = testContainer.querySelectorAll('.gp-card')
      expect(cards.length).toBe(2)

      const values = Array.from(testContainer.querySelectorAll('.gp-value')).map(el => el.textContent)
      expect(values).toContain('From Grandchild 1')
      expect(values).toContain('From Grandchild 2')
    })

    it('should find template at great-grandparent (4 levels deep)', async () => {
      testContainer.innerHTML = `
        <div data-component="level-1">
          <template data-item-template="deepTemplate">
            <div class="deep-item" data-bind="text"></div>
          </template>

          <div data-component="level-2">
            <div data-component="level-3">
              <div data-component="level-4">
                <div data-list="items">
                  <template data-use-template="deepTemplate"></template>
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.component('level-1', { state: {} })
      wildflower.component('level-2', { state: {} })
      wildflower.component('level-3', { state: {} })
      wildflower.component('level-4', {
        state: { items: [] },
        init() {
          this.state.items = [{ text: 'Deep Item' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      const items = testContainer.querySelectorAll('.deep-item')
      expect(items.length).toBe(1)
      expect(items[0].textContent).toBe('Deep Item')
    })

    it('should use closest ancestor template when same name exists at multiple levels', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-level-gp">
          <template data-item-template="sharedName">
            <div class="from-grandparent" data-bind="label"></div>
          </template>

          <div data-component="multi-level-parent">
            <template data-item-template="sharedName">
              <div class="from-parent" data-bind="label"></div>
            </template>

            <div data-component="multi-level-child">
              <div data-list="items">
                <template data-use-template="sharedName"></template>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.component('multi-level-gp', { state: {} })
      wildflower.component('multi-level-parent', { state: {} })
      wildflower.component('multi-level-child', {
        state: { items: [] },
        init() {
          this.state.items = [{ label: 'Test Item' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Should use parent's template (closest), not grandparent's
      expect(testContainer.querySelector('.from-parent')).not.toBeNull()
      expect(testContainer.querySelector('.from-grandparent')).toBeNull()
      expect(testContainer.querySelector('.from-parent').textContent).toBe('Test Item')
    })
  })

  // ============================================
  // SECTION 3: Computed Array Data in init()
  // ============================================
  describe('External Templates with Computed Array Data', () => {

    it('should render list bound to computed property when base data set in init()', async () => {
      testContainer.innerHTML = `
        <div data-component="computed-provider">
          <template data-item-template="filteredCard">
            <div class="filtered-card">
              <span class="card-name" data-bind="name"></span>
              <span class="card-status" data-bind="status"></span>
            </div>
          </template>

          <div data-component="computed-consumer">
            <div class="filtered-list" data-list="computed:activeItems">
              <template data-use-template="filteredCard"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('computed-provider', { state: {} })
      wildflower.component('computed-consumer', {
        state: {
          allItems: []
        },
        computed: {
          activeItems() {
            return this.state.allItems.filter(item => item.status === 'active')
          }
        },
        init() {
          // Load all items in init, computed filters them
          this.state.allItems = [
            { name: 'Item 1', status: 'active' },
            { name: 'Item 2', status: 'inactive' },
            { name: 'Item 3', status: 'active' },
            { name: 'Item 4', status: 'inactive' }
          ]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Should only render active items (2 out of 4)
      const cards = testContainer.querySelectorAll('.filtered-card')
      expect(cards.length).toBe(2)

      const names = Array.from(testContainer.querySelectorAll('.card-name')).map(el => el.textContent)
      expect(names).toContain('Item 1')
      expect(names).toContain('Item 3')
      expect(names).not.toContain('Item 2')
      expect(names).not.toContain('Item 4')
    })

    it('should update computed list when underlying data changes after init()', async () => {
      testContainer.innerHTML = `
        <div data-component="reactive-computed-provider">
          <template data-item-template="sortedCard">
            <div class="sorted-card" data-bind="name"></div>
          </template>

          <div data-component="reactive-computed-consumer">
            <div data-list="computed:sortedItems">
              <template data-use-template="sortedCard"></template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('reactive-computed-provider', { state: {} })
      wildflower.component('reactive-computed-consumer', {
        state: {
          items: [],
          sortOrder: 'asc'
        },
        computed: {
          sortedItems() {
            const sorted = [...this.state.items]
            sorted.sort((a, b) => {
              if (this.state.sortOrder === 'asc') {
                return a.name.localeCompare(b.name)
              }
              return b.name.localeCompare(a.name)
            })
            return sorted
          }
        },
        init() {
          consumerInstance = this
          this.state.items = [
            { name: 'Charlie' },
            { name: 'Alice' },
            { name: 'Bob' }
          ]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Initial sort order (asc): Alice, Bob, Charlie
      let cards = testContainer.querySelectorAll('.sorted-card')
      expect(cards.length).toBe(3)
      expect(cards[0].textContent).toBe('Alice')
      expect(cards[1].textContent).toBe('Bob')
      expect(cards[2].textContent).toBe('Charlie')

      // Change sort order
      consumerInstance.state.sortOrder = 'desc'
      await waitForCompleteRender()
      await waitForUpdate(100)

      // After desc sort: Charlie, Bob, Alice
      cards = testContainer.querySelectorAll('.sorted-card')
      expect(cards[0].textContent).toBe('Charlie')
      expect(cards[1].textContent).toBe('Bob')
      expect(cards[2].textContent).toBe('Alice')
    })

    it('should handle computed that transforms items with external template', async () => {
      testContainer.innerHTML = `
        <div data-component="transform-provider">
          <template data-item-template="enrichedCard">
            <div class="enriched-card">
              <span class="display-name" data-bind="displayName"></span>
              <span class="full-price" data-bind="fullPrice"></span>
            </div>
          </template>

          <div data-component="transform-consumer">
            <div data-list="computed:enrichedProducts">
              <template data-use-template="enrichedCard"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('transform-provider', { state: {} })
      wildflower.component('transform-consumer', {
        state: {
          products: [],
          currency: 'USD'
        },
        computed: {
          enrichedProducts() {
            return this.state.products.map(p => ({
              ...p,
              displayName: p.name.toUpperCase(),
              fullPrice: `${this.state.currency} ${p.price.toFixed(2)}`
            }))
          }
        },
        init() {
          this.state.products = [
            { name: 'Widget', price: 9.99 },
            { name: 'Gadget', price: 19.50 }
          ]
        }
      })

      wildflower._scanForComponents()

      // Wait for list items to render using waitForDOM
      await waitForDOM(
        () => testContainer.querySelectorAll('.enriched-card').length,
        2
      )

      const displayNames = Array.from(testContainer.querySelectorAll('.display-name')).map(el => el.textContent)
      expect(displayNames).toContain('WIDGET')
      expect(displayNames).toContain('GADGET')

      const prices = Array.from(testContainer.querySelectorAll('.full-price')).map(el => el.textContent)
      expect(prices).toContain('USD 9.99')
      expect(prices).toContain('USD 19.50')
    })
  })

  // ============================================
  // SECTION 4: Multiple Lists Sharing Same Template
  // ============================================
  describe('Multiple Lists Using Same External Template', () => {

    it('should render two sibling lists with same external template independently', async () => {
      testContainer.innerHTML = `
        <div data-component="sibling-provider">
          <template data-item-template="sharedCard">
            <div class="shared-card">
              <span class="card-label" data-bind="label"></span>
            </div>
          </template>

          <div data-component="sibling-consumer">
            <div class="list-a" data-list="listA">
              <template data-use-template="sharedCard"></template>
            </div>
            <div class="list-b" data-list="listB">
              <template data-use-template="sharedCard"></template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('sibling-provider', { state: {} })
      wildflower.component('sibling-consumer', {
        state: {
          listA: [],
          listB: []
        },
        init() {
          consumerInstance = this
          this.state.listA = [{ label: 'A1' }, { label: 'A2' }]
          this.state.listB = [{ label: 'B1' }, { label: 'B2' }, { label: 'B3' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Both lists should render
      const listACards = testContainer.querySelectorAll('.list-a .shared-card')
      const listBCards = testContainer.querySelectorAll('.list-b .shared-card')

      expect(listACards.length).toBe(2)
      expect(listBCards.length).toBe(3)

      // Verify content is independent
      expect(listACards[0].querySelector('.card-label').textContent).toBe('A1')
      expect(listBCards[0].querySelector('.card-label').textContent).toBe('B1')

      // Update one list, other should be unaffected
      consumerInstance.state.listA = [{ label: 'A-New' }]
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(testContainer.querySelectorAll('.list-a .shared-card').length).toBe(1)
      expect(testContainer.querySelectorAll('.list-b .shared-card').length).toBe(3)
    })

    it('should handle three lists sharing same template with different update patterns', async () => {
      testContainer.innerHTML = `
        <div data-component="triple-provider">
          <template data-item-template="tripleCard">
            <div class="triple-card" data-bind="value"></div>
          </template>

          <div data-component="triple-consumer">
            <div class="pending-list" data-list="pending">
              <template data-use-template="tripleCard"></template>
            </div>
            <div class="active-list" data-list="active">
              <template data-use-template="tripleCard"></template>
            </div>
            <div class="completed-list" data-list="completed">
              <template data-use-template="tripleCard"></template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('triple-provider', { state: {} })
      wildflower.component('triple-consumer', {
        state: {
          pending: [],
          active: [],
          completed: []
        },
        init() {
          consumerInstance = this
          this.state.pending = [{ value: 'P1' }, { value: 'P2' }]
          this.state.active = [{ value: 'A1' }]
          this.state.completed = []
        },
        moveToActive(index) {
          const item = this.state.pending.splice(index, 1)[0]
          this.state.active = [...this.state.active, item]
        },
        complete(index) {
          const item = this.state.active.splice(index, 1)[0]
          this.state.completed = [...this.state.completed, item]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Initial state
      expect(testContainer.querySelectorAll('.pending-list .triple-card').length).toBe(2)
      expect(testContainer.querySelectorAll('.active-list .triple-card').length).toBe(1)
      expect(testContainer.querySelectorAll('.completed-list .triple-card').length).toBe(0)

      // Move P1 from pending to active
      consumerInstance.moveToActive(0)
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(testContainer.querySelectorAll('.pending-list .triple-card').length).toBe(1)
      expect(testContainer.querySelectorAll('.active-list .triple-card').length).toBe(2)

      // Complete A1
      consumerInstance.complete(0)
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(testContainer.querySelectorAll('.active-list .triple-card').length).toBe(1)
      expect(testContainer.querySelectorAll('.completed-list .triple-card').length).toBe(1)
    })

    it('should maintain action context for each list using same template', async () => {
      const clickedItems = []

      testContainer.innerHTML = `
        <div data-component="action-provider">
          <template data-item-template="actionCard">
            <div class="action-card">
              <span data-bind="name"></span>
              <button class="action-btn" data-action="handleClick">Click</button>
            </div>
          </template>

          <div data-component="action-consumer">
            <div class="list-x" data-list="listX">
              <template data-use-template="actionCard"></template>
            </div>
            <div class="list-y" data-list="listY">
              <template data-use-template="actionCard"></template>
            </div>
          </div>
        </div>
      `

      wildflower.component('action-provider', { state: {} })
      wildflower.component('action-consumer', {
        state: {
          listX: [],
          listY: []
        },
        init() {
          this.state.listX = [{ name: 'X-Item' }]
          this.state.listY = [{ name: 'Y-Item' }]
        },
        handleClick(event, element, details) {
          const listContainer = element.closest('[data-list]')
          const listName = listContainer.dataset.list
          clickedItems.push({ list: listName, index: details.index })
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Click button in list X
      const xBtn = testContainer.querySelector('.list-x .action-btn')
      xBtn.click()
      await waitForUpdate()

      // Click button in list Y
      const yBtn = testContainer.querySelector('.list-y .action-btn')
      yBtn.click()
      await waitForUpdate()

      expect(clickedItems.length).toBe(2)
      expect(clickedItems[0].list).toBe('listX')
      expect(clickedItems[1].list).toBe('listY')
    })
  })

  // ============================================
  // SECTION 5: Dynamic Template Registration
  // ============================================
  //
  // DESIGN PHILOSOPHY: "Explicit Re-render"
  //
  // rescanItemTemplates() is a REGISTRATION function, not a re-render trigger.
  // The framework follows a predictable data flow: UI only changes when state changes.
  //
  // This is intentional and aligns with WildflowerJS core principles:
  // - Predictability: Developers control when re-renders happen
  // - Performance: No unexpected re-renders across the component tree
  // - Simplicity: rescanItemTemplates() does one thing - register templates
  //
  // To apply a newly registered template to an existing list:
  // 1. Call rescanItemTemplates() to register the template
  // 2. Trigger a state update: `component.state.items = [...component.state.items]`
  //
  // ============================================
  describe('Dynamic Template Registration', () => {

    it('should register new template and apply it on explicit state change', async () => {
      // This test demonstrates the correct workflow for dynamic template addition
      // rescanItemTemplates() clears caches AND marks affected lists to bypass element reuse
      testContainer.innerHTML = `
        <div data-component="dynamic-provider" id="dynamic-provider">
          <!-- No template initially -->
          <div data-component="dynamic-consumer">
            <div class="dynamic-list" data-list="items">
              <template data-use-template="dynamicCard">
                <div class="fallback-card" data-bind="name"></div>
              </template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('dynamic-provider', { state: {} })
      wildflower.component('dynamic-consumer', {
        state: { items: [] },
        init() {
          consumerInstance = this
          this.state.items = [{ name: 'Initial' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Initially using fallback (template not available)
      expect(testContainer.querySelector('.fallback-card')).not.toBeNull()
      expect(testContainer.querySelector('.dynamic-card')).toBeNull()
      expect(testContainer.querySelector('.fallback-card').textContent).toBe('Initial')

      // Step 1: Add template dynamically to provider
      const providerEl = testContainer.querySelector('#dynamic-provider')
      const newTemplate = document.createElement('template')
      newTemplate.setAttribute('data-item-template', 'dynamicCard')
      newTemplate.innerHTML = '<div class="dynamic-card" data-bind="name"></div>'
      providerEl.insertBefore(newTemplate, providerEl.firstChild)

      // Step 2: Register the new template (this marks affected lists for re-render)
      const registeredTemplates = await wildflower.rescanItemTemplates(providerEl)

      // Verify template was registered
      expect(registeredTemplates).toContain('dynamicCard')

      // At this point, the list still shows fallback (no automatic re-render)
      // This is BY DESIGN - UI only changes when state changes
      expect(testContainer.querySelector('.fallback-card')).not.toBeNull()

      // Step 3: Trigger state update - the _forceTemplateRerender flag ensures new template is used
      // Note: We need to create actually different data or the reactive system may detect "no change"
      consumerInstance.state.items = [{ name: 'Updated' }]
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Now the new template is used
      const dynamicCard = testContainer.querySelector('.dynamic-card')
      expect(dynamicCard).not.toBeNull()
      expect(dynamicCard.textContent).toBe('Updated')
    })

    it('should use fallback when template removed and state explicitly updated', async () => {
      // This test demonstrates the correct workflow for template removal
      testContainer.innerHTML = `
        <div data-component="removable-provider" id="removable-provider">
          <template data-item-template="removableCard" id="removable-template">
            <div class="removable-card" data-bind="name"></div>
          </template>

          <div data-component="removable-consumer">
            <div data-list="items">
              <template data-use-template="removableCard">
                <div class="fallback-card" data-bind="name"></div>
              </template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('removable-provider', { state: {} })
      wildflower.component('removable-consumer', {
        state: { items: [] },
        init() {
          consumerInstance = this
          this.state.items = [{ name: 'Test' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Initially using external template
      expect(testContainer.querySelector('.removable-card')).not.toBeNull()
      expect(testContainer.querySelector('.removable-card').textContent).toBe('Test')

      // Step 1: Remove the template from DOM
      const template = testContainer.querySelector('#removable-template')
      template.remove()

      // Step 2: Re-scan to clear the cached template reference
      const providerEl = testContainer.querySelector('#removable-provider')
      await wildflower.rescanItemTemplates(providerEl)

      // At this point, list still shows old items (no automatic re-render)
      // This is BY DESIGN
      expect(testContainer.querySelector('.removable-card')).not.toBeNull()

      // Step 3: Explicitly trigger re-render by changing the data
      consumerInstance.state.items = [{ name: 'After Remove' }]
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Now fallback is used since template no longer exists
      const fallbackCard = testContainer.querySelector('.fallback-card')
      expect(fallbackCard).not.toBeNull()
      expect(fallbackCard.textContent).toBe('After Remove')
    })

    it('should demonstrate recommended pattern: check registration before state update', async () => {
      // This test shows the RECOMMENDED developer workflow
      testContainer.innerHTML = `
        <div data-component="workflow-provider" id="workflow-provider">
          <div data-component="workflow-consumer">
            <div data-list="notifications">
              <template data-use-template="notificationCard">
                <div class="basic-notification" data-bind="message"></div>
              </template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('workflow-provider', { state: {} })
      wildflower.component('workflow-consumer', {
        state: { notifications: [] },
        init() {
          consumerInstance = this
          this.state.notifications = [{ message: 'Welcome!' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Using fallback initially
      expect(testContainer.querySelector('.basic-notification')).not.toBeNull()

      // RECOMMENDED PATTERN: Load templates, check if desired one registered, then update
      const providerEl = testContainer.querySelector('#workflow-provider')

      // Add template dynamically (e.g., loaded from server)
      const richTemplate = document.createElement('template')
      richTemplate.setAttribute('data-item-template', 'notificationCard')
      richTemplate.innerHTML = `
        <div class="rich-notification">
          <span class="notification-message" data-bind="message"></span>
          <button class="dismiss-btn" data-action="dismiss">×</button>
        </div>
      `
      providerEl.insertBefore(richTemplate, providerEl.firstChild)

      // Register and check
      const registered = await wildflower.rescanItemTemplates(providerEl)

      if (registered.includes('notificationCard')) {
        // Template available! Trigger re-render by changing data
        consumerInstance.state.notifications = [{ message: 'Template Applied!' }]
      }

      await waitForCompleteRender()
      await waitForUpdate(100)

      // Rich template now in use
      expect(testContainer.querySelector('.rich-notification')).not.toBeNull()
      expect(testContainer.querySelector('.notification-message').textContent).toBe('Template Applied!')
      expect(testContainer.querySelector('.dismiss-btn')).not.toBeNull()
    })
  })

  // ============================================
  // SECTION 6: SSR Hydration with External Templates
  // ============================================
  describe('SSR Hydration with External Templates', () => {

    it('should render list items using external template', async () => {
      // Test that configurable templates work for list rendering
      // Note: Configurable templates disable innerHTML optimization to preserve data-action attributes
      testContainer.innerHTML = `
        <div data-component="ssr-provider">
          <template data-item-template="ssrCard">
            <div class="ssr-card">
              <span class="ssr-name" data-bind="name"></span>
            </div>
          </template>

          <div data-component="ssr-consumer">
            <div class="ssr-list" data-list="items">
              <template data-use-template="ssrCard"></template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('ssr-provider', { state: {} })
      wildflower.component('ssr-consumer', {
        state: { items: [] },
        init() {
          consumerInstance = this
          // Set initial items
          this.state.items = [
            { name: 'Item 1' },
            { name: 'Item 2' }
          ]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Verify items were rendered using external template
      expect(testContainer.querySelectorAll('.ssr-card').length).toBe(2)

      // Add new item - should use the external template
      consumerInstance.state.items = [...consumerInstance.state.items, { name: 'New Item' }]

      // Wait for new item to render
      await waitForDOM(
        () => testContainer.querySelectorAll('.ssr-card').length,
        3
      )

      const updatedCards = testContainer.querySelectorAll('.ssr-card')

      // New item should have the marker
      const newCard = updatedCards[2]
      expect(newCard.getAttribute('data-wf-used-template')).toBe('ssrCard')
    })

    it('should correctly mark new items with data-wf-used-template after hydration', async () => {
      testContainer.innerHTML = `
        <div data-component="marker-provider">
          <template data-item-template="markerCard">
            <div class="marker-card" data-bind="text"></div>
          </template>

          <div data-component="marker-consumer">
            <div data-list="items">
              <template data-use-template="markerCard"></template>
            </div>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.component('marker-provider', { state: {} })
      wildflower.component('marker-consumer', {
        state: { items: [] },
        init() {
          consumerInstance = this
          this.state.items = [{ text: 'First' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // First item should have marker
      let cards = testContainer.querySelectorAll('.marker-card')
      expect(cards[0].getAttribute('data-wf-used-template')).toBe('markerCard')

      // Add more items
      consumerInstance.state.items.push({ text: 'Second' })
      consumerInstance.state.items.push({ text: 'Third' })
      await waitForCompleteRender()
      await waitForUpdate(100)

      // All items should have marker
      cards = testContainer.querySelectorAll('.marker-card')
      expect(cards.length).toBe(3)
      cards.forEach(card => {
        expect(card.getAttribute('data-wf-used-template')).toBe('markerCard')
      })
    })

    it('should handle SSR fallback marker when template was not found', async () => {
      testContainer.innerHTML = `
        <div data-component="fallback-marker-provider">
          <!-- No template defined -->
          <div data-component="fallback-marker-consumer">
            <div data-list="items">
              <template data-use-template="nonexistent">
                <div class="fb-card" data-bind="label"></div>
              </template>
            </div>
          </div>
        </div>
      `

      wildflower.component('fallback-marker-provider', { state: {} })
      wildflower.component('fallback-marker-consumer', {
        state: { items: [] },
        init() {
          this.state.items = [{ label: 'Fallback Item' }]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Fallback should be used
      const card = testContainer.querySelector('.fb-card')
      expect(card).not.toBeNull()
      expect(card.textContent).toBe('Fallback Item')

      // Marker should indicate fallback was used
      expect(card.getAttribute('data-wf-used-template')).toBe('nonexistent:fallback')
    })
  })

  // ============================================
  // SECTION 7: Complex Real-World Scenarios
  // ============================================
  describe('Complex Real-World Scenarios', () => {

    it('should handle Kanban board pattern: multiple columns sharing card template', async () => {
      testContainer.innerHTML = `
        <div data-component="kanban-board">
          <template data-item-template="taskCard">
            <div class="task-card">
              <h4 class="task-title" data-bind="title"></h4>
              <span class="task-assignee" data-bind="assignee"></span>
              <button class="move-btn" data-action="moveTask">Move</button>
            </div>
          </template>

          <div data-component="kanban-columns">
            <div class="column todo-column">
              <h3>To Do</h3>
              <div class="column-cards" data-list="todo">
                <template data-use-template="taskCard"></template>
              </div>
            </div>
            <div class="column progress-column">
              <h3>In Progress</h3>
              <div class="column-cards" data-list="inProgress">
                <template data-use-template="taskCard"></template>
              </div>
            </div>
            <div class="column done-column">
              <h3>Done</h3>
              <div class="column-cards" data-list="done">
                <template data-use-template="taskCard"></template>
              </div>
            </div>
          </div>
        </div>
      `

      let columnsInstance
      wildflower.component('kanban-board', { state: {} })
      wildflower.component('kanban-columns', {
        state: {
          todo: [],
          inProgress: [],
          done: []
        },
        init() {
          columnsInstance = this
          // Load from "localStorage"
          this.state.todo = [
            { id: 1, title: 'Task 1', assignee: 'Alice' },
            { id: 2, title: 'Task 2', assignee: 'Bob' }
          ]
          this.state.inProgress = [
            { id: 3, title: 'Task 3', assignee: 'Charlie' }
          ]
          this.state.done = []
        },
        moveTask(event, element, details) {
          const column = element.closest('[data-list]')
          const columnName = column.dataset.list

          if (columnName === 'todo') {
            const task = this.state.todo.splice(details.index, 1)[0]
            this.state.inProgress = [...this.state.inProgress, task]
          } else if (columnName === 'inProgress') {
            const task = this.state.inProgress.splice(details.index, 1)[0]
            this.state.done = [...this.state.done, task]
          }
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Initial state
      expect(testContainer.querySelectorAll('.todo-column .task-card').length).toBe(2)
      expect(testContainer.querySelectorAll('.progress-column .task-card').length).toBe(1)
      expect(testContainer.querySelectorAll('.done-column .task-card').length).toBe(0)

      // Move first todo task to in-progress
      const todoMoveBtn = testContainer.querySelector('.todo-column .move-btn')
      todoMoveBtn.click()
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(testContainer.querySelectorAll('.todo-column .task-card').length).toBe(1)
      expect(testContainer.querySelectorAll('.progress-column .task-card').length).toBe(2)

      // Move first in-progress task to done
      const progressMoveBtn = testContainer.querySelector('.progress-column .move-btn')
      progressMoveBtn.click()
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(testContainer.querySelectorAll('.progress-column .task-card').length).toBe(1)
      expect(testContainer.querySelectorAll('.done-column .task-card').length).toBe(1)
    })

    it('should handle settings panel pattern: nested sections with shared templates', async () => {
      testContainer.innerHTML = `
        <div data-component="settings-panel">
          <template data-item-template="settingRow">
            <div class="setting-row">
              <label class="setting-label" data-bind="label"></label>
              <input type="checkbox" class="setting-toggle" data-model="enabled">
            </div>
          </template>

          <template data-item-template="settingSection">
            <div class="setting-section">
              <h3 class="section-title" data-bind="title"></h3>
              <div class="section-settings" data-list="settings">
                <template data-use-template="settingRow"></template>
              </div>
            </div>
          </template>

          <div data-component="settings-content">
            <div class="sections-list" data-list="sections">
              <template data-use-template="settingSection"></template>
            </div>
          </div>
        </div>
      `

      let contentInstance
      wildflower.component('settings-panel', { state: {} })
      wildflower.component('settings-content', {
        state: { sections: [] },
        init() {
          contentInstance = this
          this.state.sections = [
            {
              title: 'Notifications',
              settings: [
                { label: 'Email', enabled: true },
                { label: 'Push', enabled: false }
              ]
            },
            {
              title: 'Privacy',
              settings: [
                { label: 'Public Profile', enabled: true }
              ]
            }
          ]
        }
      })

      wildflower._scanForComponents()
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Verify sections rendered
      const sections = testContainer.querySelectorAll('.setting-section')
      expect(sections.length).toBe(2)

      // Verify titles
      const titles = Array.from(testContainer.querySelectorAll('.section-title')).map(el => el.textContent)
      expect(titles).toContain('Notifications')
      expect(titles).toContain('Privacy')

      // Verify settings rendered
      const settingRows = testContainer.querySelectorAll('.setting-row')
      expect(settingRows.length).toBe(3)

      // Verify labels
      const labels = Array.from(testContainer.querySelectorAll('.setting-label')).map(el => el.textContent)
      expect(labels).toContain('Email')
      expect(labels).toContain('Push')
      expect(labels).toContain('Public Profile')

      // Verify checkbox states
      const toggles = testContainer.querySelectorAll('.setting-toggle')
      expect(toggles[0].checked).toBe(true)  // Email
      expect(toggles[1].checked).toBe(false) // Push
      expect(toggles[2].checked).toBe(true)  // Public Profile
    })
  })
})
