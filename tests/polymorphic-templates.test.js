/**
 * WildflowerJS Polymorphic Templates (data-template-key) Test Suite
 *
 * Tests for data-template-key — a mechanism that selects which <template data-type="...">
 * child to render based on a state/item property. Covers both standalone components
 * and list items.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasConsoleWarnings, getDistMode } from './helpers/load-framework.js'

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

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe('Polymorphic Templates (data-template-key)', () => {
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

  // ============================================
  // SECTION 1: Standalone Template Selection
  // ============================================
  describe('Standalone Template Selection', () => {

    it('renders initial template matching state property', async () => {
      wildflower.component('standalone-basic', {
        state: { viewType: 'text' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-basic" data-template-key="viewType">
          <template data-type="text"><div class="text-view">Text Content</div></template>
          <template data-type="image"><div class="image-view">Image Content</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-basic"]')
      expect(comp.querySelector('.text-view')).not.toBeNull()
      expect(comp.querySelector('.text-view').textContent).toBe('Text Content')
      expect(comp.querySelector('.image-view')).toBeNull()
    })

    it('falls back to default template when no data-type matches', async () => {
      wildflower.component('standalone-fallback', {
        state: { viewType: 'unknown' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-fallback" data-template-key="viewType">
          <template data-type="text"><div class="text-view">Text</div></template>
          <template><div class="default-view">Default Content</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-fallback"]')
      expect(comp.querySelector('.default-view')).not.toBeNull()
      expect(comp.querySelector('.default-view').textContent).toBe('Default Content')
      expect(comp.querySelector('.text-view')).toBeNull()
    })

    it('emits dev warning when no match and no default', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      wildflower.component('standalone-no-match', {
        state: { viewType: 'missing' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-no-match" data-template-key="viewType">
          <template data-type="text"><div class="text-view">Text</div></template>
          <template data-type="image"><div class="image-view">Image</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      if (hasConsoleWarnings()) {
        expect(warnSpy).toHaveBeenCalled()
      }
      warnSpy.mockRestore()
    })

    it('swaps template when state property changes', async () => {
      wildflower.component('standalone-swap', {
        state: { viewType: 'text' },
        switchToImage() { this.state.viewType = 'image' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-swap" data-template-key="viewType">
          <template data-type="text">
            <div class="text-view">Text</div>
            <button data-action="switchToImage" class="switch-btn">Switch</button>
          </template>
          <template data-type="image"><div class="image-view">Image</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-swap"]')
      expect(comp.querySelector('.text-view')).not.toBeNull()

      // Trigger swap via action
      comp.querySelector('.switch-btn').click()
      await waitForUpdate()

      expect(comp.querySelector('.text-view')).toBeNull()
      expect(comp.querySelector('.image-view')).not.toBeNull()
    })

    it('preserves component state across swap', async () => {
      wildflower.component('standalone-state-preserve', {
        state: { viewType: 'a', count: 42 },
        switchView() { this.state.viewType = this.state.viewType === 'a' ? 'b' : 'a' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-state-preserve" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a"><span class="count" data-bind="count"></span></div>
            <button data-action="switchView" class="switch-btn">Switch</button>
          </template>
          <template data-type="b">
            <div class="view-b"><span class="count" data-bind="count"></span></div>
            <button data-action="switchView" class="switch-btn">Switch</button>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-state-preserve"]')
      expect(comp.querySelector('.view-a .count').textContent).toBe('42')

      comp.querySelector('.switch-btn').click()
      await waitForUpdate()

      // State should be preserved
      expect(comp.querySelector('.view-b .count').textContent).toBe('42')
    })

    it('preserves computed properties across swap', async () => {
      wildflower.component('standalone-computed-preserve', {
        state: { viewType: 'a', firstName: 'John', lastName: 'Doe' },
        computed: {
          fullName() { return `${this.state.firstName} ${this.state.lastName}` }
        },
        switchView() { this.state.viewType = 'b' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-computed-preserve" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a"><span class="name" data-bind="fullName"></span></div>
            <button data-action="switchView" class="switch-btn">Switch</button>
          </template>
          <template data-type="b">
            <div class="view-b"><span class="name" data-bind="fullName"></span></div>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-computed-preserve"]')
      expect(comp.querySelector('.view-a .name').textContent).toBe('John Doe')

      comp.querySelector('.switch-btn').click()
      await waitForUpdate()

      expect(comp.querySelector('.view-b .name').textContent).toBe('John Doe')
    })

    it('all binding types work in each variant', async () => {
      wildflower.component('standalone-all-bindings', {
        state: { viewType: 'full', label: 'Hello', isVisible: true, inputVal: 'test' },
        doSomething() { this.state.label = 'Clicked' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-all-bindings" data-template-key="viewType">
          <template data-type="full">
            <div class="full-view">
              <span class="label" data-bind="label"></span>
              <button data-action="doSomething" class="action-btn">Click</button>
              <input data-model="inputVal" class="model-input">
              <div data-show="isVisible" class="conditional">Visible</div>
            </div>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-all-bindings"]')
      expect(comp.querySelector('.label').textContent).toBe('Hello')
      expect(comp.querySelector('.model-input').value).toBe('test')
      expect(comp.querySelector('.conditional').style.display).not.toBe('none')

      comp.querySelector('.action-btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.label').textContent).toBe('Clicked')
    })

    it('nested components initialized on insert, destroyed on swap-out', async () => {
      const initSpy = vi.fn()
      const destroySpy = vi.fn()

      wildflower.component('standalone-nested-parent', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' },
        switchToA() { this.state.viewType = 'a' }
      })
      wildflower.component('standalone-nested-child', {
        state: { childLabel: 'Child' },
        init() { initSpy() },
        destroy() { destroySpy() }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-nested-parent" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">
              <div data-component="standalone-nested-child">
                <span data-bind="childLabel" class="child-text"></span>
              </div>
              <button data-action="switchToB" class="switch-btn">Switch</button>
            </div>
          </template>
          <template data-type="b">
            <div class="view-b">No child here</div>
            <button data-action="switchToA" class="back-btn">Back</button>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      expect(initSpy).toHaveBeenCalledTimes(1)
      // Verify nested child's binding rendered
      const comp = testContainer.querySelector('[data-component="standalone-nested-parent"]')
      expect(comp.querySelector('.child-text').textContent).toBe('Child')

      // A → B: child destroyed
      comp.querySelector('.switch-btn').click()
      await waitForUpdate(100)

      expect(comp.querySelector('.view-b')).not.toBeNull()
      expect(destroySpy).toHaveBeenCalledTimes(1)

      // B → A: fresh child created
      comp.querySelector('.back-btn').click()
      await waitForUpdate(100)

      expect(initSpy).toHaveBeenCalledTimes(2)
      expect(comp.querySelector('.child-text').textContent).toBe('Child')
    })

    it('nested lists inside templates work', async () => {
      wildflower.component('standalone-nested-list', {
        state: {
          viewType: 'list',
          items: [
            { id: 1, name: 'Alpha' },
            { id: 2, name: 'Beta' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-nested-list" data-template-key="viewType">
          <template data-type="list">
            <div class="list-view">
              <ul data-list="items" data-key="id">
                <template>
                  <li class="list-item" data-bind="name"></li>
                </template>
              </ul>
            </div>
          </template>
          <template data-type="empty"><div class="empty-view">No items</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const comp = testContainer.querySelector('[data-component="standalone-nested-list"]')
      const items = comp.querySelectorAll('.list-item')
      expect(items.length).toBe(2)
      expect(items[0].textContent).toBe('Alpha')
      expect(items[1].textContent).toBe('Beta')
    })

    it('multiple swaps (A→B→C→A) cycle correctly', async () => {
      wildflower.component('standalone-cycle', {
        state: { viewType: 'a' },
        setView(event, element) {
          this.state.viewType = element.dataset.view
        }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-cycle" data-template-key="viewType">
          <template data-type="a"><div class="view-a">A<button data-action="setView" data-view="b" class="btn">→B</button></div></template>
          <template data-type="b"><div class="view-b">B<button data-action="setView" data-view="c" class="btn">→C</button></div></template>
          <template data-type="c"><div class="view-c">C<button data-action="setView" data-view="a" class="btn">→A</button></div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-cycle"]')

      expect(comp.querySelector('.view-a')).not.toBeNull()

      // A → B
      comp.querySelector('.btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-b')).not.toBeNull()
      expect(comp.querySelector('.view-a')).toBeNull()

      // B → C
      comp.querySelector('.btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-c')).not.toBeNull()

      // C → A
      comp.querySelector('.btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-a')).not.toBeNull()
    })

    it('template swap during init (value already set)', async () => {
      wildflower.component('standalone-init-value', {
        state: { viewType: 'special' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-init-value" data-template-key="viewType">
          <template data-type="default"><div class="default-view">Default</div></template>
          <template data-type="special"><div class="special-view">Special</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-init-value"]')
      expect(comp.querySelector('.special-view')).not.toBeNull()
      expect(comp.querySelector('.default-view')).toBeNull()
    })

    it('only default template (no typed) always uses default', async () => {
      wildflower.component('standalone-default-only', {
        state: { viewType: 'anything' }
      })

      testContainer.innerHTML = `
        <div data-component="standalone-default-only" data-template-key="viewType">
          <template><div class="default-only">Always Default</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="standalone-default-only"]')
      expect(comp.querySelector('.default-only')).not.toBeNull()
      expect(comp.querySelector('.default-only').textContent).toBe('Always Default')
    })
  })

  // ============================================
  // SECTION 2: List Template Selection
  // ============================================
  describe('List Template Selection', () => {

    it('heterogeneous list renders correct template per item type', async () => {
      wildflower.component('list-hetero', {
        state: {
          items: [
            { id: 1, type: 'text', content: 'Hello' },
            { id: 2, type: 'image', src: 'photo.jpg' },
            { id: 3, type: 'text', content: 'World' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-hetero">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="text"><div class="text-item"><span data-bind="content"></span></div></template>
            <template data-type="image"><div class="image-item"><img data-bind-attr="({ src: src })"></div></template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      const children = listEl.children
      expect(children.length).toBe(3)

      expect(children[0].classList.contains('text-item')).toBe(true)
      expect(children[0].querySelector('span').textContent).toBe('Hello')

      expect(children[1].classList.contains('image-item')).toBe(true)

      expect(children[2].classList.contains('text-item')).toBe(true)
      expect(children[2].querySelector('span').textContent).toBe('World')
    })

    it('default template for unrecognized types', async () => {
      wildflower.component('list-default-type', {
        state: {
          items: [
            { id: 1, type: 'known', label: 'Known' },
            { id: 2, type: 'mystery', label: 'Mystery' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-default-type">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="known"><div class="known-item"><span data-bind="label"></span></div></template>
            <template><div class="default-item"><span data-bind="label"></span></div></template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children[0].classList.contains('known-item')).toBe(true)
      expect(listEl.children[1].classList.contains('default-item')).toBe(true)
      expect(listEl.children[1].querySelector('span').textContent).toBe('Mystery')
    })

    it('keyed list reorder preserves correct DOM per type', async () => {
      wildflower.component('list-reorder', {
        state: {
          items: [
            { id: 1, type: 'a', label: 'First' },
            { id: 2, type: 'b', label: 'Second' },
            { id: 3, type: 'a', label: 'Third' }
          ]
        },
        reverse() { this.state.items = [...this.state.items].reverse() }
      })

      testContainer.innerHTML = `
        <div data-component="list-reorder">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="label"></div></template>
            <template data-type="b"><div class="type-b" data-bind="label"></div></template>
          </div>
          <button data-action="reverse" class="reverse-btn">Reverse</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children[0].classList.contains('type-a')).toBe(true)
      expect(listEl.children[1].classList.contains('type-b')).toBe(true)
      expect(listEl.children[2].classList.contains('type-a')).toBe(true)

      testContainer.querySelector('.reverse-btn').click()
      await waitForUpdate()

      expect(listEl.children[0].classList.contains('type-a')).toBe(true)
      expect(listEl.children[0].textContent).toBe('Third')
      expect(listEl.children[1].classList.contains('type-b')).toBe(true)
      expect(listEl.children[1].textContent).toBe('Second')
      expect(listEl.children[2].classList.contains('type-a')).toBe(true)
      expect(listEl.children[2].textContent).toBe('First')
    })

    it('append item with new type', async () => {
      wildflower.component('list-append-type', {
        state: {
          items: [
            { id: 1, type: 'text', content: 'Hello' }
          ]
        },
        addImage() {
          this.state.items = [...this.state.items, { id: 2, type: 'image', content: 'photo.jpg' }]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-append-type">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="text"><div class="text-item" data-bind="content"></div></template>
            <template data-type="image"><div class="image-item" data-bind="content"></div></template>
          </div>
          <button data-action="addImage" class="add-btn">Add</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(1)

      testContainer.querySelector('.add-btn').click()
      await waitForUpdate()

      expect(listEl.children.length).toBe(2)
      expect(listEl.children[1].classList.contains('image-item')).toBe(true)
      expect(listEl.children[1].textContent).toBe('photo.jpg')
    })

    it('remove item cleans up regardless of type', async () => {
      wildflower.component('list-remove-type', {
        state: {
          items: [
            { id: 1, type: 'a', label: 'One' },
            { id: 2, type: 'b', label: 'Two' },
            { id: 3, type: 'a', label: 'Three' }
          ]
        },
        removeMiddle() {
          this.state.items = this.state.items.filter(i => i.id !== 2)
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-remove-type">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="label"></div></template>
            <template data-type="b"><div class="type-b" data-bind="label"></div></template>
          </div>
          <button data-action="removeMiddle" class="remove-btn">Remove</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('[data-list="items"]').children.length).toBe(3)

      testContainer.querySelector('.remove-btn').click()
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(2)
      expect(listEl.children[0].classList.contains('type-a')).toBe(true)
      expect(listEl.children[1].classList.contains('type-a')).toBe(true)
    })

    it('replace-all with mixed types', async () => {
      wildflower.component('list-replace-all', {
        state: {
          items: [
            { id: 1, type: 'a', label: 'Old' }
          ]
        },
        replaceAll() {
          this.state.items = [
            { id: 10, type: 'b', label: 'New B' },
            { id: 11, type: 'a', label: 'New A' },
            { id: 12, type: 'c', label: 'New C' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-replace-all">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="label"></div></template>
            <template data-type="b"><div class="type-b" data-bind="label"></div></template>
            <template><div class="type-default" data-bind="label"></div></template>
          </div>
          <button data-action="replaceAll" class="replace-btn">Replace</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      testContainer.querySelector('.replace-btn').click()
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(3)
      expect(listEl.children[0].classList.contains('type-b')).toBe(true)
      expect(listEl.children[0].textContent).toBe('New B')
      expect(listEl.children[1].classList.contains('type-a')).toBe(true)
      expect(listEl.children[1].textContent).toBe('New A')
      expect(listEl.children[2].classList.contains('type-default')).toBe(true)
      expect(listEl.children[2].textContent).toBe('New C')
    })

    it('independent binding resolution per variant', async () => {
      wildflower.component('list-bindings-per-variant', {
        state: {
          items: [
            { id: 1, type: 'user', name: 'Alice', role: 'Admin' },
            { id: 2, type: 'product', name: 'Widget', price: '$10' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-bindings-per-variant">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="user">
              <div class="user-item">
                <span class="user-name" data-bind="name"></span>
                <span class="user-role" data-bind="role"></span>
              </div>
            </template>
            <template data-type="product">
              <div class="product-item">
                <span class="product-name" data-bind="name"></span>
                <span class="product-price" data-bind="price"></span>
              </div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.querySelector('.user-name').textContent).toBe('Alice')
      expect(listEl.querySelector('.user-role').textContent).toBe('Admin')
      expect(listEl.querySelector('.product-name').textContent).toBe('Widget')
      expect(listEl.querySelector('.product-price').textContent).toBe('$10')
    })

    it('data-action per variant with correct item context', async () => {
      const clickedItems = []

      wildflower.component('list-action-variant', {
        state: {
          items: [
            { id: 1, type: 'btn', label: 'Button A' },
            { id: 2, type: 'link', label: 'Link B' },
            { id: 3, type: 'btn', label: 'Button C' }
          ]
        },
        handleClick(event, element, details) {
          clickedItems.push(details.item.label)
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-action-variant">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="btn">
              <div class="btn-item"><button data-action="handleClick" class="action-btn" data-bind="label"></button></div>
            </template>
            <template data-type="link">
              <div class="link-item"><a data-action="handleClick" class="action-link" data-bind="label"></a></div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // Click first btn-type item
      const btns = testContainer.querySelectorAll('.action-btn')
      btns[0].click()
      await waitForUpdate()
      // Click link-type item
      testContainer.querySelector('.action-link').click()
      await waitForUpdate()
      // Click second btn-type item (same template, different item context)
      btns[1].click()
      await waitForUpdate()

      expect(clickedItems).toEqual(['Button A', 'Link B', 'Button C'])
    })

    it('data-model per variant', async () => {
      wildflower.component('list-model-variant', {
        state: {
          fields: [
            { id: 1, type: 'text', value: 'hello' },
            { id: 2, type: 'number', value: '42' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-model-variant">
          <div data-list="fields" data-key="id" data-template-key="type">
            <template data-type="text">
              <div class="text-field"><input type="text" data-model="value" class="text-input"></div>
            </template>
            <template data-type="number">
              <div class="number-field"><input type="number" data-model="value" class="number-input"></div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const textInput = testContainer.querySelector('.text-input')
      const numberInput = testContainer.querySelector('.number-input')
      expect(textInput.value).toBe('hello')
      expect(numberInput.value).toBe('42')
    })

    it('data-show and data-render inside variants', async () => {
      wildflower.component('list-show-variant', {
        state: {
          items: [
            { id: 1, type: 'a', visible: true, label: 'Shown' },
            { id: 2, type: 'b', visible: false, label: 'Hidden' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-show-variant">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a">
              <div class="type-a-item">
                <span data-show="visible" class="conditional-a" data-bind="label"></span>
              </div>
            </template>
            <template data-type="b">
              <div class="type-b-item">
                <span data-show="visible" class="conditional-b" data-bind="label"></span>
              </div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const shownEl = testContainer.querySelector('.conditional-a')
      const hiddenEl = testContainer.querySelector('.conditional-b')
      expect(shownEl.style.display).not.toBe('none')
      expect(hiddenEl.style.display).toBe('none')
    })

    it('data-bind-class per variant', async () => {
      wildflower.component('list-class-variant', {
        state: {
          items: [
            { id: 1, type: 'a', isActive: true },
            { id: 2, type: 'b', isActive: false }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-class-variant">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a">
              <div class="type-a" data-bind-class="isActive ? 'active' : ''"></div>
            </template>
            <template data-type="b">
              <div class="type-b" data-bind-class="isActive ? 'active' : ''"></div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const aItem = testContainer.querySelector('.type-a')
      const bItem = testContainer.querySelector('.type-b')
      expect(aItem.classList.contains('active')).toBe(true)
      expect(bItem.classList.contains('active')).toBe(false)
    })

    it('data-bind-style per variant', async () => {
      wildflower.component('list-style-variant', {
        state: {
          items: [
            { id: 1, type: 'a', color: 'red' },
            { id: 2, type: 'b', color: 'blue' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-style-variant">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a">
              <div class="type-a" data-bind-style="{ color: color }"></div>
            </template>
            <template data-type="b">
              <div class="type-b" data-bind-style="{ backgroundColor: color }"></div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('.type-a').style.color).toBe('red')
      expect(testContainer.querySelector('.type-b').style.backgroundColor).toBe('blue')
    })

    it('data-bind-attr per variant', async () => {
      wildflower.component('list-attr-variant', {
        state: {
          items: [
            { id: 1, type: 'input', placeholder: 'Enter text' },
            { id: 2, type: 'link', href: 'https://example.com' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-attr-variant">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="input">
              <div class="input-item"><input class="attr-input" data-bind-attr="({ placeholder: placeholder })"></div>
            </template>
            <template data-type="link">
              <div class="link-item"><a class="attr-link" data-bind-attr="({ href: href })">Link</a></div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('.attr-input').getAttribute('placeholder')).toBe('Enter text')
      expect(testContainer.querySelector('.attr-link').getAttribute('href')).toBe('https://example.com')
    })

    it('nested list inside a variant', async () => {
      wildflower.component('list-nested-variant', {
        state: {
          items: [
            { id: 1, type: 'group', title: 'Group 1', children: [
              { id: 11, name: 'Child A' },
              { id: 12, name: 'Child B' }
            ]},
            { id: 2, type: 'leaf', title: 'Leaf 1' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-nested-variant">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="group">
              <div class="group-item">
                <h3 data-bind="title" class="group-title"></h3>
                <ul data-list="children" data-key="id" class="nested-list">
                  <template>
                    <li class="child-item" data-bind="name"></li>
                  </template>
                </ul>
              </div>
            </template>
            <template data-type="leaf">
              <div class="leaf-item" data-bind="title"></div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const groupItem = testContainer.querySelector('.group-item')
      expect(groupItem).not.toBeNull()
      expect(groupItem.querySelector('.group-title').textContent).toBe('Group 1')

      const childItems = groupItem.querySelectorAll('.child-item')
      expect(childItems.length).toBe(2)
      expect(childItems[0].textContent).toBe('Child A')
      expect(childItems[1].textContent).toBe('Child B')

      expect(testContainer.querySelector('.leaf-item').textContent).toBe('Leaf 1')
    })

    it('nested component inside a variant', async () => {
      wildflower.component('list-comp-parent', {
        state: {
          items: [
            { id: 1, type: 'with-child', label: 'Parent' },
            { id: 2, type: 'simple', label: 'Simple' }
          ]
        }
      })
      wildflower.component('list-comp-child', {
        state: { childText: 'I am a child' }
      })

      testContainer.innerHTML = `
        <div data-component="list-comp-parent">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="with-child">
              <div class="parent-item">
                <span data-bind="label" class="parent-label"></span>
                <div data-component="list-comp-child">
                  <span data-bind="childText" class="child-text"></span>
                </div>
              </div>
            </template>
            <template data-type="simple">
              <div class="simple-item" data-bind="label"></div>
            </template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      expect(testContainer.querySelector('.parent-label').textContent).toBe('Parent')
      expect(testContainer.querySelector('.child-text').textContent).toBe('I am a child')
      expect(testContainer.querySelector('.simple-item').textContent).toBe('Simple')
    })

    it('all items same type (degenerate case)', async () => {
      wildflower.component('list-same-type', {
        state: {
          items: [
            { id: 1, type: 'a', label: 'One' },
            { id: 2, type: 'a', label: 'Two' },
            { id: 3, type: 'a', label: 'Three' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-same-type">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="label"></div></template>
            <template data-type="b"><div class="type-b" data-bind="label"></div></template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(3)
      expect(listEl.querySelectorAll('.type-a').length).toBe(3)
      expect(listEl.querySelectorAll('.type-b').length).toBe(0)
    })

    it('empty list then add mixed-type items', async () => {
      wildflower.component('list-empty-add', {
        state: { items: [] },
        addItems() {
          this.state.items = [
            { id: 1, type: 'a', label: 'Alpha' },
            { id: 2, type: 'b', label: 'Beta' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-empty-add">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="label"></div></template>
            <template data-type="b"><div class="type-b" data-bind="label"></div></template>
          </div>
          <button data-action="addItems" class="add-btn">Add</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('[data-list="items"]').children.length).toBe(0)

      testContainer.querySelector('.add-btn').click()
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(2)
      expect(listEl.children[0].classList.contains('type-a')).toBe(true)
      expect(listEl.children[1].classList.contains('type-b')).toBe(true)
    })

    it('large list (100+ items, 3-4 types)', async () => {
      const types = ['card', 'banner', 'metric', 'table']
      const items = Array.from({ length: 120 }, (_, i) => ({
        id: i,
        type: types[i % types.length],
        label: `Item ${i}`
      }))

      wildflower.component('list-large', {
        state: { items }
      })

      testContainer.innerHTML = `
        <div data-component="list-large">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="card"><div class="card-item" data-bind="label"></div></template>
            <template data-type="banner"><div class="banner-item" data-bind="label"></div></template>
            <template data-type="metric"><div class="metric-item" data-bind="label"></div></template>
            <template data-type="table"><div class="table-item" data-bind="label"></div></template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(200)

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(120)

      // Verify type distribution
      expect(listEl.querySelectorAll('.card-item').length).toBe(30)
      expect(listEl.querySelectorAll('.banner-item').length).toBe(30)
      expect(listEl.querySelectorAll('.metric-item').length).toBe(30)
      expect(listEl.querySelectorAll('.table-item').length).toBe(30)

      // Spot-check content
      expect(listEl.children[0].textContent).toBe('Item 0')
      expect(listEl.children[0].classList.contains('card-item')).toBe(true)
      expect(listEl.children[1].textContent).toBe('Item 1')
      expect(listEl.children[1].classList.contains('banner-item')).toBe(true)
    })
  })

  // ============================================
  // SECTION 3: Edge Cases
  // ============================================
  describe('Edge Cases', () => {

    it('nonexistent state property falls back to default', async () => {
      wildflower.component('edge-no-prop', {
        state: { label: 'Hello' }
      })

      testContainer.innerHTML = `
        <div data-component="edge-no-prop" data-template-key="nonExistentProp">
          <template data-type="x"><div class="type-x">X</div></template>
          <template><div class="default-view">Default</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-no-prop"]')
      expect(comp.querySelector('.default-view')).not.toBeNull()
    })

    it('empty string value falls back to default', async () => {
      wildflower.component('edge-empty-string', {
        state: { viewType: '' }
      })

      testContainer.innerHTML = `
        <div data-component="edge-empty-string" data-template-key="viewType">
          <template data-type="text"><div class="text-view">Text</div></template>
          <template><div class="default-view">Default</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-empty-string"]')
      expect(comp.querySelector('.default-view')).not.toBeNull()
    })

    it('null/undefined value falls back to default', async () => {
      wildflower.component('edge-null-value', {
        state: { viewType: null }
      })

      testContainer.innerHTML = `
        <div data-component="edge-null-value" data-template-key="viewType">
          <template data-type="text"><div class="text-view">Text</div></template>
          <template><div class="default-view">Default</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-null-value"]')
      expect(comp.querySelector('.default-view')).not.toBeNull()
    })

    it('one typed + default works correctly', async () => {
      wildflower.component('edge-one-typed', {
        state: { viewType: 'special' }
      })

      testContainer.innerHTML = `
        <div data-component="edge-one-typed" data-template-key="viewType">
          <template data-type="special"><div class="special-view">Special</div></template>
          <template><div class="default-view">Default</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-one-typed"]')
      expect(comp.querySelector('.special-view')).not.toBeNull()
      expect(comp.querySelector('.default-view')).toBeNull()
    })

    it('no templates at all emits dev warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      wildflower.component('edge-no-templates', {
        state: { viewType: 'x' }
      })

      testContainer.innerHTML = `
        <div data-component="edge-no-templates" data-template-key="viewType">
          <div class="static-content">No templates here</div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      if (hasConsoleWarnings()) {
        expect(warnSpy).toHaveBeenCalled()
      }
      warnSpy.mockRestore()
    })

    it('combined data-template-key + data-key (keyed polymorphic list)', async () => {
      wildflower.component('edge-keyed-poly', {
        state: {
          items: [
            { id: 'x1', type: 'a', val: 'A1' },
            { id: 'x2', type: 'b', val: 'B1' },
            { id: 'x3', type: 'a', val: 'A2' }
          ]
        },
        removeFirst() {
          this.state.items = this.state.items.slice(1)
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-keyed-poly">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="val"></div></template>
            <template data-type="b"><div class="type-b" data-bind="val"></div></template>
          </div>
          <button data-action="removeFirst" class="remove-btn">Remove</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(3)

      testContainer.querySelector('.remove-btn').click()
      await waitForUpdate()

      expect(listEl.children.length).toBe(2)
      expect(listEl.children[0].classList.contains('type-b')).toBe(true)
      expect(listEl.children[0].textContent).toBe('B1')
      expect(listEl.children[1].classList.contains('type-a')).toBe(true)
      expect(listEl.children[1].textContent).toBe('A2')
    })

    it('static HTML templates with no bindings', async () => {
      wildflower.component('edge-static-html', {
        state: {
          items: [
            { id: 1, type: 'divider' },
            { id: 2, type: 'content', text: 'Hello' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-static-html">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="divider"><hr class="divider-item"></template>
            <template data-type="content"><div class="content-item" data-bind="text"></div></template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children[0].tagName).toBe('HR')
      expect(listEl.children[0].classList.contains('divider-item')).toBe(true)
      expect(listEl.children[1].classList.contains('content-item')).toBe(true)
      expect(listEl.children[1].textContent).toBe('Hello')
    })

    it('independent of configurable templates (data-use-template)', async () => {
      // data-template-key and data-use-template serve different purposes
      // and should not interfere with each other
      wildflower.component('edge-independent', {
        state: {
          viewType: 'a',
          items: [
            { id: 1, type: 'x', label: 'Item X' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-independent" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">
              <div data-list="items" data-key="id" data-template-key="type">
                <template data-type="x"><div class="type-x" data-bind="label"></div></template>
              </div>
            </div>
          </template>
          <template data-type="b"><div class="view-b">View B</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const comp = testContainer.querySelector('[data-component="edge-independent"]')
      expect(comp.querySelector('.view-a')).not.toBeNull()
      expect(comp.querySelector('.type-x')).not.toBeNull()
      expect(comp.querySelector('.type-x').textContent).toBe('Item X')
    })

    it('rapid state changes settle on final value', async () => {
      wildflower.component('edge-rapid-swap', {
        state: { viewType: 'a' },
        goToB() { this.state.viewType = 'b' },
        rapidSwap() {
          this.state.viewType = 'b'
          this.state.viewType = 'c'
          this.state.viewType = 'a'
          this.state.viewType = 'b' // Final value
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-rapid-swap" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">A</div>
            <button data-action="goToB" class="go-btn">Go B</button>
          </template>
          <template data-type="b">
            <div class="view-b">B</div>
            <button data-action="rapidSwap" class="swap-btn">Swap</button>
          </template>
          <template data-type="c"><div class="view-c">C</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-rapid-swap"]')

      // Go to B via action to get the rapid swap button
      comp.querySelector('.go-btn').click()
      await waitForUpdate()

      // Rapid swap: b→c→a→b
      comp.querySelector('.swap-btn').click()
      await waitForUpdate()

      // Should settle on final value 'b'
      expect(comp.querySelector('.view-b')).not.toBeNull()
    })

    it('template key on component that also has other bindings', async () => {
      wildflower.component('edge-mixed-bindings', {
        state: { viewType: 'a', title: 'My Title', isActive: true }
      })

      testContainer.innerHTML = `
        <div data-component="edge-mixed-bindings" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">
              <h1 data-bind="title" class="title"></h1>
            </div>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-mixed-bindings"]')
      expect(comp.querySelector('.title').textContent).toBe('My Title')
    })

    it('data-wf-template-key + data-wf-type prefix variant (standalone)', async () => {
      wildflower.component('edge-wf-prefix-standalone', {
        state: { viewType: 'alpha' }
      })

      testContainer.innerHTML = `
        <div data-component="edge-wf-prefix-standalone" data-wf-template-key="viewType">
          <template data-wf-type="alpha"><div class="alpha-view">Alpha</div></template>
          <template data-wf-type="beta"><div class="beta-view">Beta</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-wf-prefix-standalone"]')
      expect(comp.querySelector('.alpha-view')).not.toBeNull()
      expect(comp.querySelector('.alpha-view').textContent).toBe('Alpha')
    })

    it('standalone swap to nonexistent type at runtime', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      wildflower.component('edge-swap-nonexistent', {
        state: { viewType: 'a' },
        goToMissing() { this.state.viewType = 'missing' }
      })

      testContainer.innerHTML = `
        <div data-component="edge-swap-nonexistent" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">A</div>
            <button data-action="goToMissing" class="btn">Go</button>
          </template>
          <template data-type="b"><div class="view-b">B</div></template>
          <template><div class="default-view">Default</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-swap-nonexistent"]')
      expect(comp.querySelector('.view-a')).not.toBeNull()

      comp.querySelector('.btn').click()
      await waitForUpdate()

      // Should fall back to default template
      expect(comp.querySelector('.view-a')).toBeNull()
      expect(comp.querySelector('.default-view')).not.toBeNull()
      warnSpy.mockRestore()
    })

    it('standalone state mutation after swap updates new DOM', async () => {
      wildflower.component('edge-mutate-after-swap', {
        state: { viewType: 'a', count: 1 },
        switchView() { this.state.viewType = this.state.viewType === 'a' ? 'b' : 'a' },
        increment() { this.state.count++ }
      })

      testContainer.innerHTML = `
        <div data-component="edge-mutate-after-swap" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">
              <span class="count" data-bind="count"></span>
              <button data-action="switchView" class="switch-btn">Switch</button>
              <button data-action="increment" class="inc-btn">+</button>
            </div>
          </template>
          <template data-type="b">
            <div class="view-b">
              <span class="count" data-bind="count"></span>
              <button data-action="switchView" class="switch-btn">Switch</button>
              <button data-action="increment" class="inc-btn">+</button>
            </div>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-mutate-after-swap"]')
      expect(comp.querySelector('.view-a .count').textContent).toBe('1')

      // Swap A → B
      comp.querySelector('.switch-btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-b .count').textContent).toBe('1')

      // Mutate state AFTER swap — new DOM should update
      comp.querySelector('.inc-btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-b .count').textContent).toBe('2')

      // Swap back B → A — should show updated value
      comp.querySelector('.switch-btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-a .count').textContent).toBe('2')
    })

    it('list item property update reflects in polymorphic template', async () => {
      wildflower.component('edge-list-update', {
        state: {
          items: [
            { id: 1, type: 'a', label: 'Original A' },
            { id: 2, type: 'b', label: 'Original B' }
          ]
        },
        updateFirst() {
          this.state.items[0].label = 'Updated A'
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-list-update">
          <div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="label"></div></template>
            <template data-type="b"><div class="type-b" data-bind="label"></div></template>
          </div>
          <button data-action="updateFirst" class="update-btn">Update</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children[0].textContent).toBe('Original A')
      expect(listEl.children[1].textContent).toBe('Original B')

      testContainer.querySelector('.update-btn').click()
      await waitForUpdate()

      // First item's label should update, template type unchanged
      expect(listEl.children[0].classList.contains('type-a')).toBe(true)
      expect(listEl.children[0].textContent).toBe('Updated A')
      // Second item unaffected
      expect(listEl.children[1].textContent).toBe('Original B')
    })

    it('non-keyed polymorphic list renders correctly', async () => {
      wildflower.component('edge-non-keyed', {
        state: {
          items: [
            { type: 'a', label: 'Alpha' },
            { type: 'b', label: 'Beta' },
            { type: 'a', label: 'Gamma' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-non-keyed">
          <div data-list="items" data-template-key="type">
            <template data-type="a"><div class="type-a" data-bind="label"></div></template>
            <template data-type="b"><div class="type-b" data-bind="label"></div></template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl.children.length).toBe(3)
      expect(listEl.children[0].classList.contains('type-a')).toBe(true)
      expect(listEl.children[0].textContent).toBe('Alpha')
      expect(listEl.children[1].classList.contains('type-b')).toBe(true)
      expect(listEl.children[1].textContent).toBe('Beta')
      expect(listEl.children[2].classList.contains('type-a')).toBe(true)
      expect(listEl.children[2].textContent).toBe('Gamma')
    })

    it('computed property as template key (standalone)', async () => {
      wildflower.component('edge-computed-key', {
        state: { status: 'ok', severity: 'low' },
        computed: {
          viewType() {
            return this.state.status === 'ok' ? 'success' : 'error'
          }
        },
        toggleStatus() {
          this.state.status = this.state.status === 'ok' ? 'fail' : 'ok'
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-computed-key" data-template-key="viewType">
          <template data-type="success">
            <div class="view-success">All good</div>
            <button data-action="toggleStatus" class="toggle-btn">Toggle</button>
          </template>
          <template data-type="error">
            <div class="view-error">Problem</div>
            <button data-action="toggleStatus" class="toggle-btn">Toggle</button>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="edge-computed-key"]')
      // Initial computed value: status='ok' → viewType='success'
      expect(comp.querySelector('.view-success')).not.toBeNull()
      expect(comp.querySelector('.view-success').textContent).toBe('All good')
      expect(comp.querySelector('.view-error')).toBeNull()

      // Toggle: status='fail' → viewType='error'
      comp.querySelector('.toggle-btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-error')).not.toBeNull()
      expect(comp.querySelector('.view-error').textContent).toBe('Problem')
      expect(comp.querySelector('.view-success')).toBeNull()

      // Toggle back: status='ok' → viewType='success'
      comp.querySelector('.toggle-btn').click()
      await waitForUpdate()
      expect(comp.querySelector('.view-success')).not.toBeNull()
      expect(comp.querySelector('.view-error')).toBeNull()
    })

    it('data-wf-template-key + data-wf-type prefix variant (list)', async () => {
      wildflower.component('edge-wf-prefix-list', {
        state: {
          items: [
            { id: 1, type: 'x', label: 'X Item' },
            { id: 2, type: 'y', label: 'Y Item' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="edge-wf-prefix-list">
          <div data-wf-list="items" data-wf-key="id" data-wf-template-key="type">
            <template data-wf-type="x"><div class="wf-type-x" data-wf-bind="label"></div></template>
            <template data-wf-type="y"><div class="wf-type-y" data-wf-bind="label"></div></template>
          </div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const listEl = testContainer.querySelector('[data-wf-list="items"]')
      expect(listEl.children.length).toBe(2)
      expect(listEl.children[0].classList.contains('wf-type-x')).toBe(true)
      expect(listEl.children[0].textContent).toBe('X Item')
      expect(listEl.children[1].classList.contains('wf-type-y')).toBe(true)
    })
  })

  // ============================================
  // SECTION: Non-Template Content Preservation
  // ============================================
  describe('Non-template content preservation', () => {

    it('preserves non-template content before templates', async () => {
      wildflower.component('preserve-before', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-before" data-template-key="viewType">
          <h2 id="title">Persistent Title</h2>
          <template data-type="a">
            <div class="view-a">View A</div>
            <button data-action="switchToB" class="switch-btn">Switch</button>
          </template>
          <template data-type="b"><div class="view-b">View B</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-before"]')
      expect(comp.querySelector('#title')).not.toBeNull()
      expect(comp.querySelector('.view-a')).not.toBeNull()

      // Swap A → B
      comp.querySelector('.switch-btn').click()
      await waitForUpdate()

      expect(comp.querySelector('#title')).not.toBeNull()
      expect(comp.querySelector('#title').textContent).toBe('Persistent Title')
      expect(comp.querySelector('.view-b')).not.toBeNull()
      expect(comp.querySelector('.view-a')).toBeNull()
    })

    it('preserves non-template content after templates', async () => {
      wildflower.component('preserve-after', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-after" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">View A</div>
            <button data-action="switchToB" class="switch-btn">Switch</button>
          </template>
          <template data-type="b"><div class="view-b">View B</div></template>
          <nav id="nav"><span>Navigation</span></nav>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-after"]')
      expect(comp.querySelector('#nav')).not.toBeNull()
      expect(comp.querySelector('.view-a')).not.toBeNull()

      // Swap A → B
      comp.querySelector('.switch-btn').click()
      await waitForUpdate()

      expect(comp.querySelector('#nav')).not.toBeNull()
      expect(comp.querySelector('#nav').textContent).toBe('Navigation')
      expect(comp.querySelector('.view-b')).not.toBeNull()
      expect(comp.querySelector('.view-a')).toBeNull()
    })

    it('preserves content both before and after across multiple swaps', async () => {
      wildflower.component('preserve-both', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' },
        switchToC() { this.state.viewType = 'c' },
        switchToA() { this.state.viewType = 'a' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-both" data-template-key="viewType">
          <h2 id="header">Header</h2>
          <template data-type="a">
            <div class="view-a">A Content</div>
            <button data-action="switchToB" class="btn-b">To B</button>
          </template>
          <template data-type="b">
            <div class="view-b">B Content</div>
            <button data-action="switchToC" class="btn-c">To C</button>
          </template>
          <template data-type="c">
            <div class="view-c">C Content</div>
            <button data-action="switchToA" class="btn-a">To A</button>
          </template>
          <footer id="footer">Footer</footer>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-both"]')

      // Initial: A
      expect(comp.querySelector('#header')).not.toBeNull()
      expect(comp.querySelector('#footer')).not.toBeNull()
      expect(comp.querySelector('.view-a')).not.toBeNull()

      // A → B
      comp.querySelector('.btn-b').click()
      await waitForUpdate()
      expect(comp.querySelector('#header')).not.toBeNull()
      expect(comp.querySelector('#footer')).not.toBeNull()
      expect(comp.querySelector('.view-b')).not.toBeNull()
      expect(comp.querySelector('.view-a')).toBeNull()

      // B → C
      comp.querySelector('.btn-c').click()
      await waitForUpdate()
      expect(comp.querySelector('#header')).not.toBeNull()
      expect(comp.querySelector('#footer')).not.toBeNull()
      expect(comp.querySelector('.view-c')).not.toBeNull()
      expect(comp.querySelector('.view-b')).toBeNull()

      // C → A (full cycle)
      comp.querySelector('.btn-a').click()
      await waitForUpdate()
      expect(comp.querySelector('#header')).not.toBeNull()
      expect(comp.querySelector('#footer')).not.toBeNull()
      expect(comp.querySelector('.view-a')).not.toBeNull()
      expect(comp.querySelector('.view-c')).toBeNull()
    })

    it('non-template content with data-bind still works after swap', async () => {
      wildflower.component('preserve-bind', {
        state: { viewType: 'a', title: 'Hello' },
        switchToB() { this.state.viewType = 'b' },
        updateTitle() { this.state.title = 'Updated' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-bind" data-template-key="viewType">
          <p id="bound-title"><span data-bind="title"></span></p>
          <template data-type="a">
            <div class="view-a">A</div>
            <button data-action="switchToB" class="btn-switch">Switch</button>
          </template>
          <template data-type="b">
            <div class="view-b">B</div>
            <button data-action="updateTitle" class="btn-update">Update</button>
          </template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-bind"]')
      expect(comp.querySelector('#bound-title span').textContent).toBe('Hello')

      // Swap A → B
      comp.querySelector('.btn-switch').click()
      await waitForUpdate()

      // Binding in non-template content should still be reactive
      expect(comp.querySelector('#bound-title span')).not.toBeNull()
      comp.querySelector('.btn-update').click()
      await waitForUpdate()
      expect(comp.querySelector('#bound-title span').textContent).toBe('Updated')
    })

    it('nested component outside template zone survives swap', async () => {
      wildflower.component('persistent-widget', {
        state: { label: 'widget' }
      })
      wildflower.component('preserve-nested-comp', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-nested-comp" data-template-key="viewType">
          <div data-component="persistent-widget" id="persistent"></div>
          <template data-type="a">
            <div class="view-a">A</div>
            <button data-action="switchToB" class="btn-switch">Switch</button>
          </template>
          <template data-type="b"><div class="view-b">B</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-nested-comp"]')
      const widget = comp.querySelector('#persistent')
      expect(widget).not.toBeNull()
      const widgetId = widget.getAttribute('data-component-id')
      expect(widgetId).toBeTruthy()

      // Swap A → B
      comp.querySelector('.btn-switch').click()
      await waitForUpdate()

      // Persistent widget should still be there with same component ID
      const widgetAfter = comp.querySelector('#persistent')
      expect(widgetAfter).not.toBeNull()
      expect(widgetAfter.getAttribute('data-component-id')).toBe(widgetId)
    })

    it('nested component inside template is still destroyed on swap', async () => {
      wildflower.component('temp-widget', {
        state: { temp: true }
      })
      wildflower.component('preserve-destroy-inner', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-destroy-inner" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">
              <div data-component="temp-widget" class="temp-comp"></div>
              <button data-action="switchToB" class="btn-switch">Switch</button>
            </div>
          </template>
          <template data-type="b"><div class="view-b">B</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-destroy-inner"]')
      const tempComp = comp.querySelector('.temp-comp')
      expect(tempComp).not.toBeNull()
      expect(tempComp.getAttribute('data-component-id')).toBeTruthy()

      // Swap A → B
      comp.querySelector('.btn-switch').click()
      await waitForUpdate()

      // temp-widget should be gone
      expect(comp.querySelector('.temp-comp')).toBeNull()
      expect(comp.querySelector('.view-b')).not.toBeNull()
    })

    it('template content renders in correct position between before/after content', async () => {
      wildflower.component('preserve-order', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-order" data-template-key="viewType">
          <h2 id="before">Before</h2>
          <template data-type="a">
            <div class="view-a">A</div>
            <button data-action="switchToB" class="btn-switch">Switch</button>
          </template>
          <template data-type="b"><div class="view-b">B</div></template>
          <nav id="after">After</nav>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-order"]')

      // Check order: before, template content, after
      const children = [...comp.children].filter(c => c.nodeType === 1)
      const beforeIdx = children.findIndex(c => c.id === 'before')
      const viewAIdx = children.findIndex(c => c.classList.contains('view-a'))
      const afterIdx = children.findIndex(c => c.id === 'after')
      expect(beforeIdx).toBeLessThan(viewAIdx)
      expect(viewAIdx).toBeLessThan(afterIdx)

      // Swap A → B
      comp.querySelector('.btn-switch').click()
      await waitForUpdate()

      const childrenAfter = [...comp.children].filter(c => c.nodeType === 1)
      const beforeIdx2 = childrenAfter.findIndex(c => c.id === 'before')
      const viewBIdx = childrenAfter.findIndex(c => c.classList.contains('view-b'))
      const afterIdx2 = childrenAfter.findIndex(c => c.id === 'after')
      expect(beforeIdx2).toBeLessThan(viewBIdx)
      expect(viewBIdx).toBeLessThan(afterIdx2)
    })

    it('works with no non-template content (backward compat)', async () => {
      wildflower.component('preserve-noextra', {
        state: { viewType: 'a' },
        switchToB() { this.state.viewType = 'b' }
      })

      testContainer.innerHTML = `
        <div data-component="preserve-noextra" data-template-key="viewType">
          <template data-type="a">
            <div class="view-a">A</div>
            <button data-action="switchToB" class="btn-switch">Switch</button>
          </template>
          <template data-type="b"><div class="view-b">B</div></template>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = testContainer.querySelector('[data-component="preserve-noextra"]')
      expect(comp.querySelector('.view-a')).not.toBeNull()

      // Swap A → B
      comp.querySelector('.btn-switch').click()
      await waitForUpdate()

      expect(comp.querySelector('.view-b')).not.toBeNull()
      expect(comp.querySelector('.view-a')).toBeNull()
    })
  })
})
