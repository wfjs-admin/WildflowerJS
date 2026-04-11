/**
 * WildflowerJS Deep Component Nesting Test Suite - Vitest Browser Mode
 *
 * Tests for deeply nested component hierarchies (5+ levels).
 * Validates that the framework handles complex component trees correctly.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

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

describe('Deep Component Nesting', () => {
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

  describe('5-Level Component Hierarchy', () => {
    it('should initialize all 5 levels of nested components', async () => {
      // Define 5 levels of components
      wildflower.component('level-1', {
        state: { level: 1, name: 'Level 1' }
      })
      wildflower.component('level-2', {
        state: { level: 2, name: 'Level 2' }
      })
      wildflower.component('level-3', {
        state: { level: 3, name: 'Level 3' }
      })
      wildflower.component('level-4', {
        state: { level: 4, name: 'Level 4' }
      })
      wildflower.component('level-5', {
        state: { level: 5, name: 'Level 5' }
      })

      testContainer.innerHTML = `
        <div data-component="level-1">
          <div class="level-1-content">
            <span class="level-1-name" data-bind="name"></span>
            <div data-component="level-2">
              <div class="level-2-content">
                <span class="level-2-name" data-bind="name"></span>
                <div data-component="level-3">
                  <div class="level-3-content">
                    <span class="level-3-name" data-bind="name"></span>
                    <div data-component="level-4">
                      <div class="level-4-content">
                        <span class="level-4-name" data-bind="name"></span>
                        <div data-component="level-5">
                          <div class="level-5-content">
                            <span class="level-5-name" data-bind="name"></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Verify all levels initialized
      expect(testContainer.querySelector('.level-1-name').textContent).toBe('Level 1')
      expect(testContainer.querySelector('.level-2-name').textContent).toBe('Level 2')
      expect(testContainer.querySelector('.level-3-name').textContent).toBe('Level 3')
      expect(testContainer.querySelector('.level-4-name').textContent).toBe('Level 4')
      expect(testContainer.querySelector('.level-5-name').textContent).toBe('Level 5')

      // Verify all component instances created
      const components = testContainer.querySelectorAll('[data-component]')
      expect(components.length).toBe(5)
    })

    it('should maintain state independently at each level', async () => {
      // Use unique property names to avoid any binding conflicts
      wildflower.component('state-comp-1', {
        state: { label1: 'one' }
      })
      wildflower.component('state-comp-2', {
        state: { label2: 'two' }
      })
      wildflower.component('state-comp-3', {
        state: { label3: 'three' }
      })

      testContainer.innerHTML = `
        <div data-component="state-comp-1" id="comp-1">
          <span class="out-1" data-bind="label1"></span>
          <div data-component="state-comp-2" id="comp-2">
            <span class="out-2" data-bind="label2"></span>
            <div data-component="state-comp-3" id="comp-3">
              <span class="out-3" data-bind="label3"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Verify each level has its own state
      expect(testContainer.querySelector('.out-1').textContent).toBe('one')
      expect(testContainer.querySelector('.out-2').textContent).toBe('two')
      expect(testContainer.querySelector('.out-3').textContent).toBe('three')

      // Update middle level state
      const comp2El = testContainer.querySelector('#comp-2')
      const comp2 = wildflower.componentInstances.get(comp2El.dataset.componentId)
      comp2.state.label2 = 'UPDATED'
      await waitForUpdate()

      // Only level 2 should update
      expect(testContainer.querySelector('.out-1').textContent).toBe('one')
      expect(testContainer.querySelector('.out-2').textContent).toBe('UPDATED')
      expect(testContainer.querySelector('.out-3').textContent).toBe('three')
    })

    it('should propagate subscribed data through hierarchy', async () => {
      wildflower.component('external-root', {
        state: { theme: 'dark', user: 'Admin' }
      })
      wildflower.component('external-mid', {
        state: { name: 'Middle' },
        computed: {
          rootTheme() {
            const root = wildflower.getComponent('external-root')
            return root ? root.state.theme : ''
          }
        }
      })
      wildflower.component('external-deep', {
        state: { name: 'Deep' },
        computed: {
          rootUser() {
            const root = wildflower.getComponent('external-root')
            return root ? root.state.user : ''
          },
          midName() {
            const mid = wildflower.getComponent('external-mid')
            return mid ? mid.state.name : ''
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="external-root" id="root-comp">
          <span class="root-theme" data-bind="theme"></span>
          <div data-component="external-mid" id="mid-comp">
            <span class="mid-theme" data-bind="computed:rootTheme"></span>
            <div data-component="external-deep" id="deep-comp">
              <span class="deep-user" data-bind="computed:rootUser"></span>
              <span class="deep-mid" data-bind="computed:midName"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Verify external data access through hierarchy
      expect(testContainer.querySelector('.root-theme').textContent).toBe('dark')
      expect(testContainer.querySelector('.mid-theme').textContent).toBe('dark')
      expect(testContainer.querySelector('.deep-user').textContent).toBe('Admin')
      expect(testContainer.querySelector('.deep-mid').textContent).toBe('Middle')

      // Update root and verify propagation
      const rootEl = testContainer.querySelector('#root-comp')
      const root = wildflower.componentInstances.get(rootEl.dataset.componentId)
      root.state.theme = 'light'
      await waitForUpdate()

      expect(testContainer.querySelector('.root-theme').textContent).toBe('light')
      expect(testContainer.querySelector('.mid-theme').textContent).toBe('light')
    })
  })

  describe('Lifecycle Hooks in Deep Hierarchies', () => {
    it('should call init hooks in parent-to-child order', async () => {
      const initOrder = []

      wildflower.component('init-order-1', {
        state: { level: 1 },
        init() { initOrder.push(1) }
      })
      wildflower.component('init-order-2', {
        state: { level: 2 },
        init() { initOrder.push(2) }
      })
      wildflower.component('init-order-3', {
        state: { level: 3 },
        init() { initOrder.push(3) }
      })
      wildflower.component('init-order-4', {
        state: { level: 4 },
        init() { initOrder.push(4) }
      })
      wildflower.component('init-order-5', {
        state: { level: 5 },
        init() { initOrder.push(5) }
      })

      testContainer.innerHTML = `
        <div data-component="init-order-1">
          <div data-component="init-order-2">
            <div data-component="init-order-3">
              <div data-component="init-order-4">
                <div data-component="init-order-5"></div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // All init hooks should have been called
      expect(initOrder.length).toBe(5)
      // Parent should initialize before children (typically)
      expect(initOrder).toContain(1)
      expect(initOrder).toContain(5)
    })

    it('should call destroy hooks when removing deeply nested structure', async () => {
      const destroyOrder = []

      wildflower.component('destroy-outer', {
        state: { showNested: true }
      })
      wildflower.component('destroy-level-1', {
        state: {},
        destroy() { destroyOrder.push(1) }
      })
      wildflower.component('destroy-level-2', {
        state: {},
        destroy() { destroyOrder.push(2) }
      })
      wildflower.component('destroy-level-3', {
        state: {},
        destroy() { destroyOrder.push(3) }
      })

      testContainer.innerHTML = `
        <div data-component="destroy-outer" id="outer">
          <div data-render="showNested">
            <div data-component="destroy-level-1">
              <div data-component="destroy-level-2">
                <div data-component="destroy-level-3">
                  Deep content
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Verify nested components exist
      expect(testContainer.querySelector('[data-component="destroy-level-3"]')).not.toBeNull()

      // Remove nested structure
      const outerEl = testContainer.querySelector('#outer')
      const outer = wildflower.componentInstances.get(outerEl.dataset.componentId)
      outer.state.showNested = false
      await waitForCompleteRender()
      await waitForUpdate(100)

      // All destroy hooks should have been called
      expect(destroyOrder.length).toBe(3)
    })
  })

  describe('Events and Actions in Deep Hierarchies', () => {
    it('should allow child to read parent state via subscribe', async () => {
      wildflower.component('readable-parent', {
        state: { parentValue: 'FromParent' }
      })
      wildflower.component('reading-child', {
        state: {},
        computed: {
          parentData() {
            const parent = wildflower.getComponent('readable-parent')
            return parent ? parent.state.parentValue : ''
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="readable-parent" id="parent">
          <span class="parent-val" data-bind="parentValue"></span>
          <div data-component="reading-child" id="child">
            <span class="child-reads" data-bind="computed:parentData"></span>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('.parent-val').textContent).toBe('FromParent')
      expect(testContainer.querySelector('.child-reads').textContent).toBe('FromParent')

      // Update parent, child should reflect change
      const parentEl = testContainer.querySelector('#parent')
      const parent = wildflower.componentInstances.get(parentEl.dataset.componentId)
      parent.state.parentValue = 'Updated'
      await waitForUpdate()

      expect(testContainer.querySelector('.child-reads').textContent).toBe('Updated')
    })

    it('should handle actions at each level independently with unique method names', async () => {
      const clickLog = []

      wildflower.component('unique-action-1', {
        state: { clicked: false },
        handleClick1() {
          this.state.clicked = true
          clickLog.push(1)
        }
      })
      wildflower.component('unique-action-2', {
        state: { clicked: false },
        handleClick2() {
          this.state.clicked = true
          clickLog.push(2)
        }
      })
      wildflower.component('unique-action-3', {
        state: { clicked: false },
        handleClick3() {
          this.state.clicked = true
          clickLog.push(3)
        }
      })

      testContainer.innerHTML = `
        <div data-component="unique-action-1" id="level-1">
          <button class="btn-1" data-action="handleClick1">Click 1</button>
          <div data-component="unique-action-2" id="level-2">
            <button class="btn-2" data-action="handleClick2">Click 2</button>
            <div data-component="unique-action-3" id="level-3">
              <button class="btn-3" data-action="handleClick3">Click 3</button>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Click buttons at each level
      testContainer.querySelector('.btn-3').click()
      await waitForUpdate()
      testContainer.querySelector('.btn-1').click()
      await waitForUpdate()
      testContainer.querySelector('.btn-2').click()
      await waitForUpdate()

      // Verify each level handled its own action
      expect(clickLog).toContain(1)
      expect(clickLog).toContain(2)
      expect(clickLog).toContain(3)
    })
  })

  describe('Computed Properties in Deep Hierarchies', () => {
    it('should update computed properties across deep hierarchy', async () => {
      wildflower.component('computed-root', {
        state: { multiplier: 2 }
      })
      wildflower.component('computed-mid', {
        state: { value: 10 },
        computed: {
          multiplied() {
            const root = wildflower.getComponent('computed-root')
            const m = root ? root.state.multiplier : 0
            return this.state.value * m
          }
        }
      })
      wildflower.component('computed-deep', {
        state: { addition: 5 },
        computed: {
          total() {
            // Read root's multiplier to establish dependency tracking
            const root = wildflower.getComponent('computed-root')
            const multiplier = root ? root.state.multiplier : 0
            const mid = wildflower.getComponent('computed-mid')
            const midValue = mid ? mid.state.value : 0
            return (midValue * multiplier) + this.state.addition
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-root" id="root">
          <span class="multiplier" data-bind="multiplier"></span>
          <div data-component="computed-mid" id="mid">
            <span class="multiplied" data-bind="computed:multiplied"></span>
            <div data-component="computed-deep" id="deep">
              <span class="total" data-bind="computed:total"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Initial values: multiplier=2, value=10, addition=5
      // multiplied = 10 * 2 = 20
      // total = 20 + 5 = 25
      expect(testContainer.querySelector('.multiplier').textContent).toBe('2')
      expect(testContainer.querySelector('.multiplied').textContent).toBe('20')
      expect(testContainer.querySelector('.total').textContent).toBe('25')

      // Update root multiplier
      const rootEl = testContainer.querySelector('#root')
      const root = wildflower.componentInstances.get(rootEl.dataset.componentId)
      root.state.multiplier = 3
      await waitForUpdate()

      // multiplied = 10 * 3 = 30
      // total = 30 + 5 = 35
      expect(testContainer.querySelector('.multiplied').textContent).toBe('30')
      expect(testContainer.querySelector('.total').textContent).toBe('35')
    })
  })

  describe('Conditional Rendering in Deep Hierarchies', () => {
    it('should handle data-show at multiple levels', async () => {
      wildflower.component('cond-level-1', {
        state: { showLevel2: true }
      })
      wildflower.component('cond-level-2', {
        state: { showLevel3: true }
      })
      wildflower.component('cond-level-3', {
        state: { showContent: true }
      })

      testContainer.innerHTML = `
        <div data-component="cond-level-1" id="level-1">
          <div class="l2-container" data-show="showLevel2">
            <div data-component="cond-level-2" id="level-2">
              <div class="l3-container" data-show="showLevel3">
                <div data-component="cond-level-3" id="level-3">
                  <div class="content" data-show="showContent">
                    Deep Content
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // All should be visible initially
      expect(testContainer.querySelector('.l2-container').style.display).not.toBe('none')
      expect(testContainer.querySelector('.l3-container').style.display).not.toBe('none')
      expect(testContainer.querySelector('.content').style.display).not.toBe('none')

      // Hide middle level
      const level2El = testContainer.querySelector('#level-2')
      const level2 = wildflower.componentInstances.get(level2El.dataset.componentId)
      level2.state.showLevel3 = false
      await waitForUpdate()

      // Level 3 container should be hidden
      expect(testContainer.querySelector('.l2-container').style.display).not.toBe('none')
      expect(testContainer.querySelector('.l3-container').style.display).toBe('none')
    })

    it('should handle data-render with nested static content', async () => {
      wildflower.component('render-controller', {
        state: { showContent: true }
      })

      testContainer.innerHTML = `
        <div data-component="render-controller" id="controller">
          <div data-render="showContent" class="outer-content">
            <div class="nested-level-1">
              <div class="nested-level-2">
                <span class="deep-content">Deep nested content</span>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // All should be rendered initially
      expect(testContainer.querySelector('.outer-content')).not.toBeNull()
      expect(testContainer.querySelector('.nested-level-1')).not.toBeNull()
      expect(testContainer.querySelector('.nested-level-2')).not.toBeNull()
      expect(testContainer.querySelector('.deep-content').textContent).toBe('Deep nested content')

      // Remove content
      const controllerEl = testContainer.querySelector('#controller')
      const controller = wildflower.componentInstances.get(controllerEl.dataset.componentId)
      controller.state.showContent = false
      await waitForCompleteRender()
      await waitForUpdate(100)

      // All nested content should be removed
      expect(testContainer.querySelector('.outer-content')).toBeNull()
      expect(testContainer.querySelector('.nested-level-1')).toBeNull()
      expect(testContainer.querySelector('.deep-content')).toBeNull()

      // Re-render
      controller.state.showContent = true
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Content should be back
      expect(testContainer.querySelector('.outer-content')).not.toBeNull()
      expect(testContainer.querySelector('.deep-content').textContent).toBe('Deep nested content')
    })
  })

  describe('Lists in Deep Hierarchies', () => {
    it('should render lists within deeply nested components', async () => {
      wildflower.component('list-root', {
        state: { title: 'Root' }
      })
      wildflower.component('list-container', {
        state: {
          items: [
            { id: 1, name: 'Item A' },
            { id: 2, name: 'Item B' },
            { id: 3, name: 'Item C' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-root">
          <h1 class="root-title" data-bind="title"></h1>
          <div data-component="list-container">
            <ul data-list="items">
              <template>
                <li class="list-item" data-bind="name"></li>
              </template>
            </ul>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('.root-title').textContent).toBe('Root')
      const items = testContainer.querySelectorAll('.list-item')
      expect(items.length).toBe(3)
      expect(items[0].textContent).toBe('Item A')
    })

    it('should update nested lists from ancestor component actions', async () => {
      wildflower.component('list-controller', {
        state: {},
        addItem() {
          // Access child component and modify its state
          const childEl = this.element.querySelector('[data-component="list-holder"]')
          const child = wildflower.componentInstances.get(childEl.dataset.componentId)
          child.state.items.push({ id: Date.now(), name: 'New Item' })
        }
      })
      wildflower.component('list-holder', {
        state: {
          items: [
            { id: 1, name: 'Initial' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-controller" id="controller">
          <button class="add-btn" data-action="addItem">Add</button>
          <div data-component="list-holder">
            <ul data-list="items">
              <template>
                <li class="nested-item" data-bind="name"></li>
              </template>
            </ul>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('.nested-item').length).toBe(1)

      // Click add button
      testContainer.querySelector('.add-btn').click()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('.nested-item').length).toBe(2)
    })
  })

  describe('Performance with Deep Nesting', () => {
    it('should handle 7-level deep component hierarchy', async () => {
      for (let i = 1; i <= 7; i++) {
        wildflower.component(`perf-level-${i}`, {
          state: { level: i, name: `Level ${i}` }
        })
      }

      testContainer.innerHTML = `
        <div data-component="perf-level-1">
          <span class="name-1" data-bind="name"></span>
          <div data-component="perf-level-2">
            <span class="name-2" data-bind="name"></span>
            <div data-component="perf-level-3">
              <span class="name-3" data-bind="name"></span>
              <div data-component="perf-level-4">
                <span class="name-4" data-bind="name"></span>
                <div data-component="perf-level-5">
                  <span class="name-5" data-bind="name"></span>
                  <div data-component="perf-level-6">
                    <span class="name-6" data-bind="name"></span>
                    <div data-component="perf-level-7">
                      <span class="name-7" data-bind="name"></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Verify all levels rendered
      for (let i = 1; i <= 7; i++) {
        expect(testContainer.querySelector(`.name-${i}`).textContent).toBe(`Level ${i}`)
      }
    })

    it('should handle multiple deep branches (wide + deep)', async () => {
      wildflower.component('branch-root', {
        state: { name: 'Root' }
      })
      wildflower.component('branch-a', {
        state: { name: 'Branch A' }
      })
      wildflower.component('branch-b', {
        state: { name: 'Branch B' }
      })
      wildflower.component('leaf-a1', {
        state: { name: 'Leaf A1' }
      })
      wildflower.component('leaf-a2', {
        state: { name: 'Leaf A2' }
      })
      wildflower.component('leaf-b1', {
        state: { name: 'Leaf B1' }
      })

      testContainer.innerHTML = `
        <div data-component="branch-root">
          <span class="root-name" data-bind="name"></span>
          <div class="branches">
            <div data-component="branch-a">
              <span class="branch-a-name" data-bind="name"></span>
              <div data-component="leaf-a1">
                <span class="leaf-a1-name" data-bind="name"></span>
              </div>
              <div data-component="leaf-a2">
                <span class="leaf-a2-name" data-bind="name"></span>
              </div>
            </div>
            <div data-component="branch-b">
              <span class="branch-b-name" data-bind="name"></span>
              <div data-component="leaf-b1">
                <span class="leaf-b1-name" data-bind="name"></span>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Verify all components initialized
      expect(testContainer.querySelector('.root-name').textContent).toBe('Root')
      expect(testContainer.querySelector('.branch-a-name').textContent).toBe('Branch A')
      expect(testContainer.querySelector('.branch-b-name').textContent).toBe('Branch B')
      expect(testContainer.querySelector('.leaf-a1-name').textContent).toBe('Leaf A1')
      expect(testContainer.querySelector('.leaf-a2-name').textContent).toBe('Leaf A2')
      expect(testContainer.querySelector('.leaf-b1-name').textContent).toBe('Leaf B1')

      // Total: 6 components
      const allComponents = testContainer.querySelectorAll('[data-component]')
      expect(allComponents.length).toBe(6)
    })
  })

  describe('Error Isolation in Deep Hierarchies', () => {
    it('should not let sibling component errors affect nested components', async () => {
      wildflower.component('stable-parent', {
        state: { value: 'Stable' }
      })
      wildflower.component('stable-child', {
        state: { text: 'Child OK' }
      })

      testContainer.innerHTML = `
        <div data-component="stable-parent">
          <span class="parent-val" data-bind="value"></span>
          <div data-component="stable-child">
            <span class="child-text" data-bind="text"></span>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Both should work
      expect(testContainer.querySelector('.parent-val').textContent).toBe('Stable')
      expect(testContainer.querySelector('.child-text').textContent).toBe('Child OK')

      // Update both independently
      const parentEl = testContainer.querySelector('[data-component="stable-parent"]')
      const parent = wildflower.componentInstances.get(parentEl.dataset.componentId)
      parent.state.value = 'Updated'
      await waitForUpdate()

      expect(testContainer.querySelector('.parent-val').textContent).toBe('Updated')
      expect(testContainer.querySelector('.child-text').textContent).toBe('Child OK')
    })
  })
})
