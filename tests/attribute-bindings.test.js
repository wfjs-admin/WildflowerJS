/**
 * WildflowerJS Attribute Bindings Test Suite - Vitest Browser Mode
 *
 * Tests for attribute binding features:
 * - data-bind-class: Conditional CSS class bindings
 * - data-bind-style: Inline style bindings
 * - data-bind-html: Inner HTML bindings
 *
 * Note: Arbitrary attribute bindings (data-bind-disabled, data-bind-href, etc.)
 * are NOT currently supported by the framework.
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

describe('Attribute Bindings', () => {
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

  describe('data-bind-class', () => {
    it('should apply class based on boolean state', async () => {
      testContainer.innerHTML = `
        <div data-component="class-bool-test">
          <div id="target" data-bind-class="{ active: isActive }"></div>
        </div>
      `

      wildflower.component('class-bool-test', {
        state: { isActive: true }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('active')).toBe(true)
    })

    it('should toggle class when state changes', async () => {
      testContainer.innerHTML = `
        <div data-component="class-toggle-test">
          <div id="target" data-bind-class="{ highlighted: isHighlighted }"></div>
        </div>
      `

      wildflower.component('class-toggle-test', {
        state: { isHighlighted: false }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('highlighted')).toBe(false)

      const component = testContainer.querySelector('[data-component="class-toggle-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      instance.state.isHighlighted = true
      await waitForCompleteRender()

      expect(target.classList.contains('highlighted')).toBe(true)
    })

    it('should handle multiple class bindings', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-class-test">
          <div id="target" data-bind-class="{ error: hasError, warning: hasWarning, success: isSuccess }"></div>
        </div>
      `

      wildflower.component('multi-class-test', {
        state: {
          hasError: true,
          hasWarning: false,
          isSuccess: true
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('error')).toBe(true)
      expect(target.classList.contains('warning')).toBe(false)
      expect(target.classList.contains('success')).toBe(true)
    })

    it('should preserve existing classes', async () => {
      testContainer.innerHTML = `
        <div data-component="preserve-class-test">
          <div id="target" class="static-class" data-bind-class="{ dynamic: isDynamic }"></div>
        </div>
      `

      wildflower.component('preserve-class-test', {
        state: { isDynamic: true }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('static-class')).toBe(true)
      expect(target.classList.contains('dynamic')).toBe(true)
    })

    it('should handle expression-based class binding', async () => {
      testContainer.innerHTML = `
        <div data-component="expr-class-test">
          <div id="target" data-bind-class="{ selected: id === selectedId }"></div>
        </div>
      `

      wildflower.component('expr-class-test', {
        state: {
          id: 1,
          selectedId: 1
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('selected')).toBe(true)

      const component = testContainer.querySelector('[data-component="expr-class-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      instance.state.selectedId = 2
      await waitForCompleteRender()

      expect(target.classList.contains('selected')).toBe(false)
    })

    it('should work in list items using style binding pattern', async () => {
      // Note: For list item context, use data-bind-style with ternary expressions
      // data-bind-class in lists has limited support for item property access
      wildflower.component('list-class-test', {
        state: {
          items: [
            { id: 1, name: 'Task 1', done: true },
            { id: 2, name: 'Task 2', done: false },
            { id: 3, name: 'Task 3', done: true }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-class-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ fontStyle: done ? 'italic' : 'normal' }">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)
      // Use data-bind-style for list item conditional styling
      expect(items[0].style.fontStyle).toBe('italic')
      expect(items[1].style.fontStyle).toBe('normal')
      expect(items[2].style.fontStyle).toBe('italic')
    })
  })

  describe('data-bind-style', () => {
    it('should apply inline style from state', async () => {
      testContainer.innerHTML = `
        <div data-component="style-basic-test">
          <div id="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.component('style-basic-test', {
        state: { bgColor: 'red' }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.style.backgroundColor).toBe('red')
    })

    it('should update style when state changes', async () => {
      testContainer.innerHTML = `
        <div data-component="style-update-test">
          <div id="target" data-bind-style="{ color: textColor }"></div>
        </div>
      `

      wildflower.component('style-update-test', {
        state: { textColor: 'blue' }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.style.color).toBe('blue')

      const component = testContainer.querySelector('[data-component="style-update-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      instance.state.textColor = 'green'
      await waitForCompleteRender()

      expect(target.style.color).toBe('green')
    })

    it('should handle multiple style properties', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-style-test">
          <div id="target" data-bind-style="{ width: boxWidth, height: boxHeight, opacity: fadeLevel }"></div>
        </div>
      `

      wildflower.component('multi-style-test', {
        state: {
          boxWidth: '100px',
          boxHeight: '50px',
          fadeLevel: '0.5'
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.style.width).toBe('100px')
      expect(target.style.height).toBe('50px')
      expect(target.style.opacity).toBe('0.5')
    })

    it('should preserve existing inline styles', async () => {
      testContainer.innerHTML = `
        <div data-component="preserve-style-test">
          <div id="target" style="font-size: 16px;" data-bind-style="{ color: textColor }"></div>
        </div>
      `

      wildflower.component('preserve-style-test', {
        state: { textColor: 'purple' }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.style.fontSize).toBe('16px')
      expect(target.style.color).toBe('purple')
    })

    it('should handle computed style values', async () => {
      wildflower.component('computed-style-test', {
        state: { baseWidth: 50 },
        computed: {
          calculatedWidth() {
            return this.state.baseWidth * 2 + 'px'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-style-test">
          <div id="target" data-bind-style="{ width: calculatedWidth }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.style.width).toBe('100px')
    })

    it('should work in list items', async () => {
      wildflower.component('list-style-test', {
        state: {
          items: [
            { id: 1, name: 'Item 1', color: 'red' },
            { id: 2, name: 'Item 2', color: 'blue' },
            { id: 3, name: 'Item 3', color: 'green' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-style-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ backgroundColor: color }">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items[0].style.backgroundColor).toBe('red')
      expect(items[1].style.backgroundColor).toBe('blue')
      expect(items[2].style.backgroundColor).toBe('green')
    })
  })

  describe('data-bind-html', () => {
    it('should render HTML content', async () => {
      testContainer.innerHTML = `
        <div data-component="html-basic-test">
          <div id="target" data-bind-html="htmlContent"></div>
        </div>
      `

      wildflower.component('html-basic-test', {
        state: { htmlContent: '<strong>Bold</strong> text' }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.innerHTML).toContain('<strong>Bold</strong>')
      expect(target.querySelector('strong')).not.toBeNull()
    })

    it('should update HTML content when state changes', async () => {
      testContainer.innerHTML = `
        <div data-component="html-update-test">
          <div id="target" data-bind-html="content"></div>
        </div>
      `

      wildflower.component('html-update-test', {
        state: { content: '<em>Initial</em>' }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.querySelector('em')).not.toBeNull()

      const component = testContainer.querySelector('[data-component="html-update-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      instance.state.content = '<span class="updated">Updated</span>'
      await waitForCompleteRender()

      expect(target.querySelector('.updated')).not.toBeNull()
      expect(target.querySelector('em')).toBeNull()
    })

    it('should handle empty HTML content', async () => {
      testContainer.innerHTML = `
        <div data-component="html-empty-test">
          <div id="target" data-bind-html="content"></div>
        </div>
      `

      wildflower.component('html-empty-test', {
        state: { content: '' }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.innerHTML).toBe('')
    })

    it('should render complex nested HTML', async () => {
      testContainer.innerHTML = `
        <div data-component="html-nested-test">
          <div id="target" data-bind-html="richContent"></div>
        </div>
      `

      wildflower.component('html-nested-test', {
        state: {
          richContent: `
            <div class="card">
              <h3>Title</h3>
              <p>Description with <a href="#">link</a></p>
              <ul>
                <li>Item 1</li>
                <li>Item 2</li>
              </ul>
            </div>
          `
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.querySelector('.card')).not.toBeNull()
      expect(target.querySelector('h3').textContent).toBe('Title')
      expect(target.querySelectorAll('li').length).toBe(2)
    })

    it('should work with computed HTML content', async () => {
      testContainer.innerHTML = `
        <div data-component="html-computed-test">
          <div id="target" data-bind-html="computed:formattedList"></div>
        </div>
      `

      wildflower.component('html-computed-test', {
        state: {
          items: ['Apple', 'Banana', 'Cherry']
        },
        computed: {
          formattedList() {
            return '<ul>' + this.state.items.map(item => `<li>${item}</li>`).join('') + '</ul>'
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      const listItems = target.querySelectorAll('li')
      expect(listItems.length).toBe(3)
      expect(listItems[0].textContent).toBe('Apple')
    })
  })

  describe('Combined Attribute Bindings', () => {
    it('should handle class and style bindings on same element', async () => {
      testContainer.innerHTML = `
        <div data-component="combined-test">
          <div id="target"
               data-bind-class="{ active: isActive }"
               data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.component('combined-test', {
        state: {
          isActive: true,
          bgColor: 'yellow'
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('active')).toBe(true)
      expect(target.style.backgroundColor).toBe('yellow')
    })

    it('should update both class and style bindings reactively', async () => {
      testContainer.innerHTML = `
        <div data-component="combined-reactive-test">
          <div id="target"
               data-bind-class="{ highlighted: isHighlighted }"
               data-bind-style="{ opacity: fadeLevel }"></div>
        </div>
      `

      wildflower.component('combined-reactive-test', {
        state: {
          isHighlighted: false,
          fadeLevel: '1'
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('highlighted')).toBe(false)
      expect(target.style.opacity).toBe('1')

      const component = testContainer.querySelector('[data-component="combined-reactive-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      instance.state.isHighlighted = true
      instance.state.fadeLevel = '0.5'
      await waitForCompleteRender()

      expect(target.classList.contains('highlighted')).toBe(true)
      expect(target.style.opacity).toBe('0.5')
    })
  })

  describe('Attribute Bindings in List Context', () => {
    it('should handle style bindings with item + component state comparison', async () => {
      // This is the preferred pattern for selection highlighting in lists
      wildflower.component('list-comparison-test', {
        state: {
          selectedId: 2,
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-comparison-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ opacity: id === selectedId ? '1' : '0.5' }">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items[0].style.opacity).toBe('0.5')
      expect(items[1].style.opacity).toBe('1')
      expect(items[2].style.opacity).toBe('0.5')
    })

    it('should update list item styles when parent state changes', async () => {
      wildflower.component('list-parent-state-test', {
        state: {
          activeId: 1,
          items: [
            { id: 1, name: 'First' },
            { id: 2, name: 'Second' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-parent-state-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ fontWeight: id === activeId ? 'bold' : 'normal' }">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      let items = testContainer.querySelectorAll('.item')
      expect(items[0].style.fontWeight).toBe('bold')
      expect(items[1].style.fontWeight).toBe('normal')

      const component = testContainer.querySelector('[data-component="list-parent-state-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      instance.state.activeId = 2
      await waitForCompleteRender()

      items = testContainer.querySelectorAll('.item')
      expect(items[0].style.fontWeight).toBe('normal')
      expect(items[1].style.fontWeight).toBe('bold')
    })

    it('should handle style bindings with dynamic item values', async () => {
      wildflower.component('list-dynamic-style-test', {
        state: {
          items: [
            { id: 1, name: 'Small', width: 50 },
            { id: 2, name: 'Medium', width: 100 },
            { id: 3, name: 'Large', width: 150 }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="list-dynamic-style-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ width: width + 'px' }">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items[0].style.width).toBe('50px')
      expect(items[1].style.width).toBe('100px')
      expect(items[2].style.width).toBe('150px')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined state values in class binding', async () => {
      testContainer.innerHTML = `
        <div data-component="undefined-class-test">
          <div id="target" data-bind-class="{ active: undefinedProp }"></div>
        </div>
      `

      wildflower.component('undefined-class-test', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('active')).toBe(false)
    })

    it('should handle null state values in style binding', async () => {
      testContainer.innerHTML = `
        <div data-component="null-style-test">
          <div id="target" data-bind-style="{ color: textColor }"></div>
        </div>
      `

      wildflower.component('null-style-test', {
        state: { textColor: null }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Should not crash and element should render
      const target = testContainer.querySelector('#target')
      expect(target).not.toBeNull()
    })

    it('should handle empty object in class binding', async () => {
      testContainer.innerHTML = `
        <div data-component="empty-class-test">
          <div id="target" class="existing" data-bind-class="{}"></div>
        </div>
      `

      wildflower.component('empty-class-test', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('existing')).toBe(true)
    })

    it('should handle deeply nested property in class expression', async () => {
      testContainer.innerHTML = `
        <div data-component="deep-prop-class-test">
          <div id="target" data-bind-class="{ active: user.settings.isActive }"></div>
        </div>
      `

      wildflower.component('deep-prop-class-test', {
        state: {
          user: {
            settings: {
              isActive: true
            }
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('#target')
      expect(target.classList.contains('active')).toBe(true)
    })
  })
})
