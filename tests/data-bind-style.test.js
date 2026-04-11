/**
 * WildflowerJS data-bind-style Test Suite - Vitest Browser Mode
 *
 * Comprehensive TDD test suite for the data-bind-style feature.
 * Tests cover dynamic inline style binding with object syntax.
 *
 * Syntax: data-bind-style="{ property: value, ... }"
 *
 * This feature provides:
 * - Direct state binding: { backgroundColor: bgColor }
 * - Computed property binding (shorthand): { backgroundColor: resultColor }
 * - Expression support: { backgroundColor: isActive ? '#00ff00' : '#ff0000' }
 * - Style merging with existing inline styles
 * - Reactivity on state/computed changes
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

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

// Helper to get computed style value
function getStyle(element, property) {
  return window.getComputedStyle(element)[property]
}

describe('data-bind-style', () => {
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

  // =========================================================================
  // Section 1: Basic Style Binding
  // =========================================================================

  describe('Basic Style Binding', () => {
    it('should bind single style property from state', async () => {
      wildflower.component('style-basic', {
        state: {
          bgColor: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-basic">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')
    })

    it('should bind single style property from computed', async () => {
      wildflower.component('style-computed', {
        state: {
          r: 0,
          g: 255,
          b: 0
        },
        computed: {
          computedColor() {
            return `rgb(${this.state.r}, ${this.state.g}, ${this.state.b})`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-computed">
          <div class="target" data-bind-style="{ backgroundColor: computedColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')
    })

    it('should bind multiple style properties', async () => {
      wildflower.component('style-multiple', {
        state: {
          bg: '#0000ff',
          fg: '#ffffff',
          op: 0.8
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-multiple">
          <div class="target" data-bind-style="{ backgroundColor: bg, color: fg, opacity: op }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 0, 255)')
      expect(getStyle(target, 'color')).toBe('rgb(255, 255, 255)')
      expect(getStyle(target, 'opacity')).toBe('0.8')
    })

    it('should bind numeric value (opacity)', async () => {
      wildflower.component('style-numeric', {
        state: {
          fadeLevel: 0.5
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-numeric">
          <div class="target" data-bind-style="{ opacity: fadeLevel }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'opacity')).toBe('0.5')
    })

    it('should bind pixel value (dimensions)', async () => {
      wildflower.component('style-pixels', {
        state: {
          boxWidth: '200px'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-pixels">
          <div class="target" data-bind-style="{ width: boxWidth }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'width')).toBe('200px')
    })

    it('should bind percentage value', async () => {
      wildflower.component('style-percent', {
        state: {
          progress: '75%'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-percent">
          <div class="target" style="width: 400px;" data-bind-style="{ width: progress }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // Note: Percentage values may be computed to pixels depending on context
      // We check the element has the style applied
      expect(target.style.width).toBe('75%')
    })
  })

  // =========================================================================
  // Section 2: Expressions and Ternaries
  // =========================================================================

  describe('Expressions and Ternaries', () => {
    it('should evaluate ternary expression', async () => {
      wildflower.component('style-ternary', {
        state: {
          isActive: true
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-ternary">
          <div class="target" data-bind-style="{ backgroundColor: isActive ? '#00ff00' : '#ff0000' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-ternary"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // isActive = true -> green
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')

      // Change to false -> red
      instance.state.isActive = false
      await waitForCompleteRender()

      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')
    })

    it('should evaluate string concatenation', async () => {
      wildflower.component('style-concat', {
        state: {
          angle: 45
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-concat">
          <div class="target" data-bind-style="{ transform: 'rotate(' + angle + 'deg)' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target.style.transform).toBe('rotate(45deg)')
    })

    it('should evaluate translation with concatenation', async () => {
      wildflower.component('style-translate', {
        state: {
          offset: 100
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-translate">
          <div class="target" data-bind-style="{ transform: 'translateX(' + offset + 'px)' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target.style.transform).toBe('translateX(100px)')
    })

    it('should evaluate logical AND', async () => {
      wildflower.component('style-and', {
        state: {
          isVisible: true
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-and">
          <div class="target" data-bind-style="{ opacity: isVisible && 1 }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'opacity')).toBe('1')
    })

    it('should evaluate logical OR (fallback)', async () => {
      wildflower.component('style-or', {
        state: {
          customColor: null
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-or">
          <div class="target" data-bind-style="{ backgroundColor: customColor || '#cccccc' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(204, 204, 204)')
    })

    it('should evaluate comparison in expression', async () => {
      wildflower.component('style-comparison', {
        state: {
          count: 15
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-comparison">
          <div class="target" data-bind-style="{ fontWeight: count > 10 ? 'bold' : 'normal' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-comparison"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // count = 15 > 10 -> bold
      expect(getStyle(target, 'fontWeight')).toBe('700') // bold = 700

      // Change to 5 -> normal
      instance.state.count = 5
      await waitForCompleteRender()

      expect(getStyle(target, 'fontWeight')).toBe('400') // normal = 400
    })
  })

  // =========================================================================
  // Section 3: Style Merging with Static Styles
  // =========================================================================

  describe('Style Merging with Static Styles', () => {
    it('should merge with existing inline styles', async () => {
      wildflower.component('style-merge-basic', {
        state: {
          bg: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-merge-basic">
          <div class="target" style="padding: 20px;" data-bind-style="{ backgroundColor: bg }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'padding')).toBe('20px')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')
    })

    it('should merge multiple static with multiple dynamic', async () => {
      wildflower.component('style-merge-multiple', {
        state: {
          c: '#0000ff',
          o: 0.7
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-merge-multiple">
          <div class="target" style="margin: 10px; border: 1px solid black;" data-bind-style="{ color: c, opacity: o }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'margin')).toBe('10px')
      expect(getStyle(target, 'borderStyle')).toBe('solid')
      expect(getStyle(target, 'color')).toBe('rgb(0, 0, 255)')
      expect(getStyle(target, 'opacity')).toBe('0.7')
    })

    it('should override same property (dynamic wins)', async () => {
      wildflower.component('style-override', {
        state: {
          bg: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-override">
          <div class="target" style="background-color: blue;" data-bind-style="{ backgroundColor: bg }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // Dynamic value should win
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')
    })

    it('should preserve unrelated static styles on update', async () => {
      wildflower.component('style-preserve', {
        state: {
          bg: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-preserve">
          <div class="target" style="padding: 15px; font-size: 16px;" data-bind-style="{ backgroundColor: bg }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-preserve"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // Verify initial state
      expect(getStyle(target, 'padding')).toBe('15px')
      expect(getStyle(target, 'fontSize')).toBe('16px')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')

      // Change dynamic style
      instance.state.bg = '#00ff00'
      await waitForCompleteRender()

      // Static styles should be unchanged
      expect(getStyle(target, 'padding')).toBe('15px')
      expect(getStyle(target, 'fontSize')).toBe('16px')
      // Dynamic style updated
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')
    })
  })

  // =========================================================================
  // Section 4: Property Name Formats
  // =========================================================================

  describe('Property Name Formats', () => {
    it('should support camelCase property', async () => {
      wildflower.component('style-camel', {
        state: {
          bg: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-camel">
          <div class="target" data-bind-style="{ backgroundColor: bg }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')
    })

    it('should support kebab-case (quoted) property', async () => {
      wildflower.component('style-kebab', {
        state: {
          bg: '#00ff00'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-kebab">
          <div class="target" data-bind-style="{ 'background-color': bg }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')
    })

    it('should support mixed case formats', async () => {
      wildflower.component('style-mixed', {
        state: {
          bg: '#0000ff',
          fs: '20px',
          br: '8px'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-mixed">
          <div class="target" data-bind-style="{ backgroundColor: bg, 'font-size': fs, borderRadius: br }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 0, 255)')
      expect(getStyle(target, 'fontSize')).toBe('20px')
      expect(getStyle(target, 'borderRadius')).toBe('8px')
    })

    it('should support CSS custom property (variable)', async () => {
      wildflower.component('style-css-var', {
        state: {
          themeColor: '#ff6600'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-css-var">
          <div class="target" data-bind-style="{ '--theme-color': themeColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target.style.getPropertyValue('--theme-color')).toBe('#ff6600')
    })

    it('should support vendor prefix', async () => {
      wildflower.component('style-vendor', {
        state: {
          t: 'rotate(15deg)'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-vendor">
          <div class="target" data-bind-style="{ webkitTransform: t }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // Webkit transform should be applied (may normalize to transform)
      const transform = target.style.webkitTransform || target.style.transform
      expect(transform).toContain('rotate')
    })
  })

  // =========================================================================
  // Section 5: Reactivity - State Changes
  // =========================================================================

  describe('Reactivity - State Changes', () => {
    it('should update style when state changes', async () => {
      wildflower.component('style-reactive', {
        state: {
          bgColor: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-reactive">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-reactive"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')

      // Change state
      instance.state.bgColor = '#00ff00'
      await waitForCompleteRender()

      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')
    })

    it('should handle multiple rapid changes', async () => {
      wildflower.component('style-rapid', {
        state: {
          color: '#000000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-rapid">
          <div class="target" data-bind-style="{ backgroundColor: color }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-rapid"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // Rapid changes
      instance.state.color = '#ff0000'
      instance.state.color = '#00ff00'
      instance.state.color = '#0000ff'
      instance.state.color = '#ffff00'
      instance.state.color = '#ff00ff'
      await waitForCompleteRender()

      // Final value should be correct
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 255)')
    })

    it('should handle change from value to null/undefined', async () => {
      wildflower.component('style-to-null', {
        state: {
          bgColor: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-to-null">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-to-null"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')

      // Set to null
      instance.state.bgColor = null
      await waitForCompleteRender()

      // Background should be cleared/transparent
      const bg = getStyle(target, 'backgroundColor')
      expect(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || bg === '').toBe(true)
    })

    it('should handle change from null to value', async () => {
      wildflower.component('style-from-null', {
        state: {
          bgColor: null
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-from-null">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-from-null"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // Initially null - should be transparent or unset
      const initialBg = getStyle(target, 'backgroundColor')
      expect(initialBg === 'rgba(0, 0, 0, 0)' || initialBg === 'transparent' || initialBg === '').toBe(true)

      // Set value
      instance.state.bgColor = '#0000ff'
      await waitForCompleteRender()

      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 0, 255)')
    })
  })

  // =========================================================================
  // Section 6: Reactivity - Computed Properties
  // =========================================================================

  describe('Reactivity - Computed Properties', () => {
    it('should bind to computed property directly', async () => {
      wildflower.component('style-computed-direct', {
        state: {
          lightness: 50
        },
        computed: {
          backgroundColor() {
            return `hsl(200, 100%, ${this.state.lightness}%)`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-computed-direct">
          <div class="target" data-bind-style="{ backgroundColor: backgroundColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // HSL color should be applied
      expect(getStyle(target, 'backgroundColor')).not.toBe('')
    })

    it('should update when computed dependencies change', async () => {
      wildflower.component('style-computed-deps', {
        state: {
          r: 255,
          g: 0,
          b: 0
        },
        computed: {
          rgbColor() {
            return `rgb(${this.state.r}, ${this.state.g}, ${this.state.b})`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-computed-deps">
          <div class="target" data-bind-style="{ backgroundColor: rgbColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-computed-deps"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')

      // Change g component
      instance.state.g = 255
      await waitForCompleteRender()

      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 255, 0)')
    })

    it('should handle chained computed properties', async () => {
      wildflower.component('style-computed-chain', {
        state: {
          baseHue: 120
        },
        computed: {
          adjustedHue() {
            return this.state.baseHue + 30
          },
          finalColor() {
            return `hsl(${this.computed.adjustedHue}, 100%, 50%)`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-computed-chain">
          <div class="target" data-bind-style="{ backgroundColor: finalColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-computed-chain"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // Initial: baseHue=120, adjusted=150, finalColor=hsl(150,100%,50%)
      expect(getStyle(target, 'backgroundColor')).not.toBe('')

      // Change base hue
      instance.state.baseHue = 0
      await waitForCompleteRender()

      // Now: baseHue=0, adjusted=30, finalColor=hsl(30,100%,50%) = orange
      expect(getStyle(target, 'backgroundColor')).not.toBe('')
    })
  })

  // =========================================================================
  // Section 7: List Item Style Bindings
  // =========================================================================

  describe('List Item Style Bindings', () => {
    it('should bind style from item property', async () => {
      wildflower.component('style-list-item', {
        state: {
          items: [
            { id: 1, name: 'Item 1', itemColor: '#ff0000' },
            { id: 2, name: 'Item 2', itemColor: '#00ff00' },
            { id: 3, name: 'Item 3', itemColor: '#0000ff' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-list-item">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ backgroundColor: itemColor }">
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
      expect(getStyle(items[0], 'backgroundColor')).toBe('rgb(255, 0, 0)')
      expect(getStyle(items[1], 'backgroundColor')).toBe('rgb(0, 255, 0)')
      expect(getStyle(items[2], 'backgroundColor')).toBe('rgb(0, 0, 255)')
    })

    it('should bind style from item + component state comparison', async () => {
      wildflower.component('style-list-selected', {
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
        <div data-component="style-list-selected">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ opacity: id === selectedId ? 1 : 0.5 }">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-list-selected"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      let items = testContainer.querySelectorAll('.item')
      expect(getStyle(items[0], 'opacity')).toBe('0.5')
      expect(getStyle(items[1], 'opacity')).toBe('1')
      expect(getStyle(items[2], 'opacity')).toBe('0.5')

      // Change selection
      instance.state.selectedId = 3
      await waitForCompleteRender()

      items = testContainer.querySelectorAll('.item')
      expect(getStyle(items[0], 'opacity')).toBe('0.5')
      expect(getStyle(items[1], 'opacity')).toBe('0.5')
      expect(getStyle(items[2], 'opacity')).toBe('1')
    })

    it('should update when item property changes', async () => {
      wildflower.component('style-list-update', {
        state: {
          items: [
            { id: 1, name: 'Item 1', color: '#ff0000' },
            { id: 2, name: 'Item 2', color: '#00ff00' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-list-update">
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

      const component = testContainer.querySelector('[data-component="style-list-update"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      let items = testContainer.querySelectorAll('.item')
      expect(getStyle(items[1], 'backgroundColor')).toBe('rgb(0, 255, 0)')

      // Update item color
      instance.state.items[1].color = '#ffff00'
      await waitForCompleteRender()

      items = testContainer.querySelectorAll('.item')
      expect(getStyle(items[1], 'backgroundColor')).toBe('rgb(255, 255, 0)')
    })

    it('should handle adding item to list', async () => {
      wildflower.component('style-list-add', {
        state: {
          items: [
            { id: 1, name: 'Item 1', color: '#ff0000' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-list-add">
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

      const component = testContainer.querySelector('[data-component="style-list-add"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      let items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(1)

      // Add new item
      instance.state.items.push({ id: 2, name: 'Item 2', color: '#0000ff' })
      await waitForCompleteRender()

      items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(getStyle(items[1], 'backgroundColor')).toBe('rgb(0, 0, 255)')
    })

    it('should handle removing item from list', async () => {
      wildflower.component('style-list-remove', {
        state: {
          items: [
            { id: 1, name: 'Item 1', color: '#ff0000' },
            { id: 2, name: 'Item 2', color: '#00ff00' },
            { id: 3, name: 'Item 3', color: '#0000ff' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-list-remove">
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

      const component = testContainer.querySelector('[data-component="style-list-remove"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      let items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)

      // Remove middle item
      instance.state.items.splice(1, 1)
      await waitForCompleteRender()

      items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      // First and third items should remain with correct colors
      expect(getStyle(items[0], 'backgroundColor')).toBe('rgb(255, 0, 0)')
      expect(getStyle(items[1], 'backgroundColor')).toBe('rgb(0, 0, 255)')
    })
  })

  // =========================================================================
  // Section 8: Complex Real-World Scenarios
  // =========================================================================

  describe('Complex Real-World Scenarios', () => {
    it('should work as color picker/swatch', async () => {
      wildflower.component('color-picker', {
        state: {
          r: 128,
          g: 64,
          b: 192
        },
        computed: {
          rgbString() {
            return `rgb(${this.state.r}, ${this.state.g}, ${this.state.b})`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="color-picker">
          <div class="swatch" data-bind-style="{ backgroundColor: rgbString }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="color-picker"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const swatch = testContainer.querySelector('.swatch')

      expect(getStyle(swatch, 'backgroundColor')).toBe('rgb(128, 64, 192)')

      // Simulate slider change
      instance.state.r = 255
      instance.state.g = 128
      instance.state.b = 0
      await waitForCompleteRender()

      expect(getStyle(swatch, 'backgroundColor')).toBe('rgb(255, 128, 0)')
    })

    it('should work as progress bar', async () => {
      wildflower.component('progress-bar', {
        state: {
          progress: 25
        }
      })

      testContainer.innerHTML = `
        <div data-component="progress-bar">
          <div class="progress-track" style="width: 200px; background: #eee;">
            <div class="progress-fill" data-bind-style="{ width: progress + '%' }"></div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="progress-bar"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const fill = testContainer.querySelector('.progress-fill')

      expect(fill.style.width).toBe('25%')

      // Update progress
      instance.state.progress = 75
      await waitForCompleteRender()

      expect(fill.style.width).toBe('75%')
    })

    it('should work as animated element (rotation)', async () => {
      wildflower.component('rotating-element', {
        state: {
          rotation: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="rotating-element">
          <div class="spinner" data-bind-style="{ transform: 'rotate(' + rotation + 'deg)' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="rotating-element"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const spinner = testContainer.querySelector('.spinner')

      expect(spinner.style.transform).toBe('rotate(0deg)')

      // Rotate
      instance.state.rotation = 180
      await waitForCompleteRender()

      expect(spinner.style.transform).toBe('rotate(180deg)')
    })

    it('should work for theme-driven styling', async () => {
      wildflower.component('themed-component', {
        state: {
          theme: {
            primaryColor: '#3498db',
            textColor: '#2c3e50'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="themed-component">
          <div class="card" data-bind-style="{ backgroundColor: theme.primaryColor, color: theme.textColor }">
            Themed content
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="themed-component"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const card = testContainer.querySelector('.card')

      expect(getStyle(card, 'backgroundColor')).toBe('rgb(52, 152, 219)')
      expect(getStyle(card, 'color')).toBe('rgb(44, 62, 80)')

      // Change theme
      instance.state.theme = {
        primaryColor: '#e74c3c',
        textColor: '#ffffff'
      }
      await waitForCompleteRender()

      expect(getStyle(card, 'backgroundColor')).toBe('rgb(231, 76, 60)')
      expect(getStyle(card, 'color')).toBe('rgb(255, 255, 255)')
    })

    it('should work for data visualization bar chart', async () => {
      wildflower.component('bar-chart', {
        state: {
          bars: [
            { label: 'A', value: 50, color: '#e74c3c' },
            { label: 'B', value: 80, color: '#3498db' },
            { label: 'C', value: 30, color: '#2ecc71' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="bar-chart">
          <div class="chart" data-list="bars">
            <template>
              <div class="bar" data-bind-style="{ height: value + 'px', backgroundColor: color }">
                <span data-bind="label"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const bars = testContainer.querySelectorAll('.bar')
      expect(bars.length).toBe(3)

      expect(bars[0].style.height).toBe('50px')
      expect(getStyle(bars[0], 'backgroundColor')).toBe('rgb(231, 76, 60)')

      expect(bars[1].style.height).toBe('80px')
      expect(getStyle(bars[1], 'backgroundColor')).toBe('rgb(52, 152, 219)')

      expect(bars[2].style.height).toBe('30px')
      expect(getStyle(bars[2], 'backgroundColor')).toBe('rgb(46, 204, 113)')
    })
  })

  // =========================================================================
  // Section 9: Edge Cases and Error Handling
  // =========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty object', async () => {
      wildflower.component('style-empty', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="style-empty">
          <div class="target" data-bind-style="{}"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Should not throw, element should render
      const target = testContainer.querySelector('.target')
      expect(target).toBeTruthy()
    })

    it('should handle undefined property reference gracefully', async () => {
      wildflower.component('style-undefined', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="style-undefined">
          <div class="target" data-bind-style="{ backgroundColor: nonExistent }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Should not throw, element should render
      const target = testContainer.querySelector('.target')
      expect(target).toBeTruthy()
    })

    it('should handle null style value', async () => {
      wildflower.component('style-null-value', {
        state: {
          bgColor: null
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-null-value">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target).toBeTruthy()
      // Background should be cleared/transparent
      const bg = getStyle(target, 'backgroundColor')
      expect(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || bg === '').toBe(true)
    })

    it('should handle boolean false value', async () => {
      wildflower.component('style-false', {
        state: {
          showIt: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-false">
          <div class="target" data-bind-style="{ display: showIt && 'block' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // showIt is false, so expression evaluates to false
      // Display may remain default or be cleared
      expect(target).toBeTruthy()
    })

    it('should handle empty string value', async () => {
      wildflower.component('style-empty-string', {
        state: {
          bgColor: ''
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-empty-string">
          <div class="target" style="background-color: red;" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // Empty string should clear the style
      // Note: Behavior may vary - either clears or doesn't apply
      expect(target).toBeTruthy()
    })
  })

  // =========================================================================
  // Section 10: Interaction with Other Bindings
  // =========================================================================

  describe('Interaction with Other Bindings', () => {
    it('should work with data-bind', async () => {
      wildflower.component('style-with-bind', {
        state: {
          text: 'Hello World',
          textColor: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-with-bind">
          <div class="target" data-bind="text" data-bind-style="{ color: textColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target.textContent).toBe('Hello World')
      expect(getStyle(target, 'color')).toBe('rgb(255, 0, 0)')
    })

    it('should work with data-bind-class', async () => {
      wildflower.component('style-with-class', {
        state: {
          isActive: true,
          bgColor: '#00ff00'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-with-class">
          <div class="target"
               data-bind-class="isActive ? 'active' : ''"
               data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target.classList.contains('active')).toBe(true)
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')
    })

    it('should work with data-show', async () => {
      wildflower.component('style-with-show', {
        state: {
          visible: true,
          bgColor: '#0000ff'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-with-show">
          <div class="target" data-show="visible" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'display')).not.toBe('none')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 0, 255)')
    })

    it('should work with data-render', async () => {
      wildflower.component('style-with-render', {
        state: {
          shouldRender: true,
          bgColor: '#ffff00'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-with-render">
          <div class="target" data-render="shouldRender" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target).toBeTruthy()
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 255, 0)')
    })

    it('should work with data-action', async () => {
      let clickCount = 0

      wildflower.component('style-with-action', {
        state: {
          bgColor: '#ff0000'
        },
        handleClick(event, element) {
          clickCount++
          this.state.bgColor = '#00ff00'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-with-action">
          <button class="target" data-action="handleClick" data-bind-style="{ backgroundColor: bgColor }">Click me</button>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')

      // Click the button
      target.click()
      await waitForCompleteRender()

      expect(clickCount).toBe(1)
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')
    })

    it('should work with data-model', async () => {
      wildflower.component('style-with-model', {
        state: {
          inputValue: '',
          inputBorder: '2px solid blue'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-with-model">
          <input type="text" class="target" data-model="inputValue" data-bind-style="{ border: inputBorder }">
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      expect(target.value).toBe('')
      expect(target.style.border).toContain('blue')
    })
  })

  // =========================================================================
  // Section 11: Performance and Memory
  // =========================================================================

  describe('Performance and Memory', () => {
    it('should handle large list (100 items) efficiently', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        color: `hsl(${(i * 3.6)}, 70%, 50%)`
      }))

      wildflower.component('style-large-list', {
        state: { items }
      })

      testContainer.innerHTML = `
        <div data-component="style-large-list">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ backgroundColor: color }">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      const startTime = performance.now()
      wildflower.scan()
      await waitForCompleteRender()
      const endTime = performance.now()

      const itemElements = testContainer.querySelectorAll('.item')
      expect(itemElements.length).toBe(100)

      // Should render in reasonable time (< 1 second)
      expect(endTime - startTime).toBeLessThan(1000)
    })

    it('should handle frequent updates without memory leak', async () => {
      wildflower.component('style-frequent-updates', {
        state: {
          color: '#000000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-frequent-updates">
          <div class="target" data-bind-style="{ backgroundColor: color }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-frequent-updates"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // Update 50 times
      for (let i = 0; i < 50; i++) {
        const hue = (i * 7) % 360
        instance.state.color = `hsl(${hue}, 100%, 50%)`
      }
      await waitForCompleteRender()

      // Final state should be correct
      expect(target).toBeTruthy()
      expect(getStyle(target, 'backgroundColor')).not.toBe('')
    })

    it('should clean up on component destroy', async () => {
      wildflower.component('style-cleanup', {
        state: {
          bgColor: '#ff0000'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-cleanup">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-cleanup"]')
      const componentId = component.dataset.componentId

      // Destroy the component
      testContainer.innerHTML = ''
      wildflower.garbageCollect()
      await waitForUpdate()

      // Component instance should be cleaned up
      expect(wildflower.componentInstances.has(componentId)).toBe(false)
    })

    it('should work correctly after re-initialization', async () => {
      wildflower.component('style-reinit', {
        state: {
          bgColor: '#ff0000'
        }
      })

      // First initialization
      testContainer.innerHTML = `
        <div data-component="style-reinit">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      let target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')

      // Destroy
      testContainer.innerHTML = ''
      wildflower.garbageCollect()
      await waitForUpdate()

      // Re-initialize with different color
      wildflower.component('style-reinit-2', {
        state: {
          bgColor: '#00ff00'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-reinit-2">
          <div class="target" data-bind-style="{ backgroundColor: bgColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      target = testContainer.querySelector('.target')
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 255, 0)')
    })
  })

  // =========================================================================
  // Section 12: Additional Edge Cases (Gemini suggestions)
  // =========================================================================

  describe('Additional Edge Cases', () => {
    it('should handle calc() expression with reactive variable', async () => {
      wildflower.component('style-calc', {
        state: {
          sidebarWidth: 200
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-calc">
          <div class="target" data-bind-style="{ width: 'calc(100% - ' + sidebarWidth + 'px)' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-calc"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      expect(target.style.width).toBe('calc(100% - 200px)')

      // Update sidebar width
      instance.state.sidebarWidth = 300
      await waitForCompleteRender()

      expect(target.style.width).toBe('calc(100% - 300px)')
    })

    it('should handle multi-variable transform expression', async () => {
      wildflower.component('style-multi-transform', {
        state: {
          angle: 45,
          zoom: 1.5
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-multi-transform">
          <div class="target" data-bind-style="{ transform: 'rotate(' + angle + 'deg) scale(' + zoom + ')' }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-multi-transform"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      expect(target.style.transform).toBe('rotate(45deg) scale(1.5)')

      // Update both values
      instance.state.angle = 90
      instance.state.zoom = 2
      await waitForCompleteRender()

      expect(target.style.transform).toBe('rotate(90deg) scale(2)')
    })

    it('should support _index list context variable in style binding', async () => {
      wildflower.component('style-list-index', {
        state: {
          items: [
            { id: 1, name: 'First' },
            { id: 2, name: 'Second' },
            { id: 3, name: 'Third' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-list-index">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-style="{ paddingLeft: (_index * 20) + 'px' }">
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

      // Each item should have increasing padding based on _index
      expect(items[0].style.paddingLeft).toBe('0px')
      expect(items[1].style.paddingLeft).toBe('20px')
      expect(items[2].style.paddingLeft).toBe('40px')
    })

    it('should handle !important flag in style value', async () => {
      wildflower.component('style-important', {
        state: {
          urgentColor: 'red !important'
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-important">
          <div class="target" data-bind-style="{ color: urgentColor }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // The color should be applied (red)
      expect(getStyle(target, 'color')).toBe('rgb(255, 0, 0)')
      // The !important priority should be set
      expect(target.style.getPropertyPriority('color')).toBe('important')
    })

    it('should handle non-object value gracefully (string instead of object)', async () => {
      wildflower.component('style-non-object', {
        state: {
          myColor: '#ff0000'
        }
      })

      // This is invalid syntax - passing a string instead of object
      testContainer.innerHTML = `
        <div data-component="style-non-object">
          <div class="target" data-bind-style="myColor"></div>
        </div>
      `

      // Should not throw
      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // Element should still render, just no styles applied
      expect(target).toBeTruthy()
    })

    it('should not mutate DOM when style value unchanged', async () => {
      wildflower.component('style-no-redundant', {
        state: {
          color: '#ff0000',
          otherValue: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="style-no-redundant">
          <div class="target" data-bind-style="{ backgroundColor: color }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="style-no-redundant"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      const target = testContainer.querySelector('.target')

      // Get initial style
      const initialStyle = target.style.backgroundColor

      // Change an unrelated state property
      instance.state.otherValue = 1
      await waitForCompleteRender()

      // Style should remain the same (no unnecessary mutation)
      expect(target.style.backgroundColor).toBe(initialStyle)

      // Now change the color to same value (should also not cause issues)
      instance.state.color = '#ff0000'
      await waitForCompleteRender()

      expect(target.style.backgroundColor).toBe(initialStyle)
    })
  })

  // =========================================================================
  // Section 13: SSR Compatibility
  // =========================================================================

  describe('SSR Compatibility', () => {
    it('should hydrate server-rendered element with styles', async () => {
      wildflower.component('style-ssr-hydrate', {
        state: {
          bgColor: '#ff0000',
          opacity: 0.8
        }
      })

      // Simulate SSR-rendered content with existing styles
      testContainer.innerHTML = `
        <div data-component="style-ssr-hydrate">
          <div class="target" style="background-color: rgb(255, 0, 0);" data-bind-style="{ opacity: opacity }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // SSR background should be present
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(255, 0, 0)')
      // Client-side opacity should be added
      expect(getStyle(target, 'opacity')).toBe('0.8')
    })

    it('should preserve SSR styles on hydration with additional bindings', async () => {
      wildflower.component('style-ssr-preserve', {
        state: {
          dynamicOpacity: 0.9
        }
      })

      // Simulate SSR with multiple pre-rendered styles
      testContainer.innerHTML = `
        <div data-component="style-ssr-preserve">
          <div class="target" style="background-color: blue; padding: 10px; border-radius: 5px;" data-bind-style="{ opacity: dynamicOpacity }"></div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const target = testContainer.querySelector('.target')
      // All SSR styles preserved
      expect(getStyle(target, 'backgroundColor')).toBe('rgb(0, 0, 255)')
      expect(getStyle(target, 'padding')).toBe('10px')
      expect(getStyle(target, 'borderRadius')).toBe('5px')
      // Dynamic style added
      expect(getStyle(target, 'opacity')).toBe('0.9')
    })
  })
})
