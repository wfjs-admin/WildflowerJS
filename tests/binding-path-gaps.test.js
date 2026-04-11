/**
 * Binding Path Consistency Gaps Test Suite
 *
 * Tests for the 8 identified gaps in the 6-path x 8-binding matrix.
 * See: docs/future/BINDING_PATH_CONSISTENCY_GAPS.md
 *
 * Some tests document UNFIXED gaps and may fail — this is expected.
 * They serve as regression tests for when fixes are applied.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

describe('Binding Path Consistency Gaps', () => {
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

  // =========================================================================
  // Gap 1: Effects path missing binding types
  // File: ListItemBinding.js:1493-1528 (_executeItemBindingsForEffect)
  // The effects path (keyed lists) only handles data-bind, data-show,
  // and data-bind-class. It skips data-bind-style, data-bind-attr,
  // and data-bind-html during reactive updates.
  // =========================================================================
  describe('Gap 1: Effects path missing binding types (keyed lists)', () => {
    it('data-bind-style should apply on initial render in keyed list', async () => {
      wildflower.component('gap1-style', {
        state: {
          items: [
            { id: 1, name: 'A', width: 50 },
            { id: 2, name: 'B', width: 80 }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap1-style">
          <div data-list="items" data-key="id">
            <template>
              <div class="item">
                <span class="bar" data-bind-style="{ width: width + '%' }"></span>
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const bars = testContainer.querySelectorAll('.bar')
      expect(bars.length).toBe(2)
      // Initial render should apply styles via _bindWithCompiledMetadata
      expect(bars[0].style.width).toBe('50%')
      expect(bars[1].style.width).toBe('80%')
    })

    it('data-bind-attr should apply on initial render in keyed list', async () => {
      wildflower.component('gap1-attr', {
        state: {
          items: [
            { id: 1, name: 'Alpha', level: 'high' },
            { id: 2, name: 'Beta', level: 'low' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap1-attr">
          <div data-list="items" data-key="id">
            <template>
              <div class="item">
                <span class="labeled" data-bind-attr="{ title: name, 'data-level': level }" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const labeled = testContainer.querySelectorAll('.labeled')
      expect(labeled.length).toBe(2)
      expect(labeled[0].getAttribute('title')).toBe('Alpha')
      expect(labeled[0].getAttribute('data-level')).toBe('high')
      expect(labeled[1].getAttribute('title')).toBe('Beta')
      expect(labeled[1].getAttribute('data-level')).toBe('low')
    })

    it('data-bind-html should apply on initial render in keyed list', async () => {
      wildflower.component('gap1-html', {
        state: {
          items: [
            { id: 1, content: '<b>Bold A</b>' },
            { id: 2, content: '<em>Italic B</em>' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap1-html">
          <div data-list="items" data-key="id">
            <template>
              <div class="item">
                <span class="html-content" data-bind-html="content"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const htmlEls = testContainer.querySelectorAll('.html-content')
      expect(htmlEls.length).toBe(2)
      expect(htmlEls[0].innerHTML).toContain('<b>Bold A</b>')
      expect(htmlEls[1].innerHTML).toContain('<em>Italic B</em>')
    })
  })

  // =========================================================================
  // Gap 2: data-show metadata missing expression flags
  // File: TemplateSystem.js:1289-1302
  // data-show metadata doesn't set isExpression or pre-compile expressions.
  // =========================================================================
  describe('Gap 2: data-show expression flags in compiled list', () => {
    it('data-show with comparison expression in non-keyed list', async () => {
      wildflower.component('gap2-expr', {
        state: {
          items: [
            { name: 'Low', score: 30 },
            { name: 'High', score: 70 }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap2-expr">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="badge" data-show="score > 50">Above Average</span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const badges = testContainer.querySelectorAll('.badge')
      expect(badges.length).toBe(2)
      // score=30: should be hidden
      expect(badges[0].style.display).toBe('none')
      // score=70: should be visible
      expect(badges[1].style.display).not.toBe('none')
    })

    it('data-show with $store.path expression in non-keyed list', async () => {
      wildflower.store('gap2config', {
        state: { threshold: 50 }
      })

      wildflower.component('gap2-store', {
        state: {
          items: [
            { name: 'Low', score: 30 },
            { name: 'High', score: 70 }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap2-store">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="badge" data-show="score > $gap2config.threshold">Above Threshold</span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const badges = testContainer.querySelectorAll('.badge')
      expect(badges.length).toBe(2)
      // score=30 vs threshold=50: should be hidden
      expect(badges[0].style.display).toBe('none')
      // score=70 vs threshold=50: should be visible
      expect(badges[1].style.display).not.toBe('none')
    })
  })

  // =========================================================================
  // Gap 3: data-render never consumed in lists
  // File: ListItemBinding.js:160-203 (_bindWithCompiledMetadata)
  // metadata.renders is compiled but never executed.
  // =========================================================================
  describe('Gap 3: data-render in lists', () => {
    it('data-render should conditionally include/exclude elements in non-keyed list', async () => {
      wildflower.component('gap3-render', {
        state: {
          items: [
            { name: 'Active', active: true },
            { name: 'Inactive', active: false }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap3-render">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="status" data-render="active">Active Badge</span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)

      // First item (active=true): status element should be in DOM
      const status0 = items[0].querySelector('.status')
      expect(status0).not.toBeNull()

      // Second item (active=false): status element should NOT be in DOM
      // (data-render removes from DOM entirely, unlike data-show which hides)
      const status1 = items[1].querySelector('.status')
      expect(status1).toBeNull()
    })

    it('data-render should react to item property changes', async () => {
      wildflower.component('gap3-reactive', {
        state: {
          items: [
            { name: 'Item', active: false }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap3-reactive">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="status" data-render="active">Active</span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const item = testContainer.querySelector('.item')
      // Initially active=false, so status should not be in DOM
      expect(item.querySelector('.status')).toBeNull()

      // Toggle active to true
      const component = wildflower.componentInstances.values().next().value
      component.state.items[0].active = true
      await waitForUpdate(200)

      // Now status should be in DOM
      expect(item.querySelector('.status')).not.toBeNull()
    })
  })

  // =========================================================================
  // Gap 4: data-bind-attr missing from refresh path
  // File: PropsSystem.js:1001-1149 (_refreshComputedListItemBindings)
  // attrBindings are not updated during reactive refresh.
  // =========================================================================
  describe('Gap 4: data-bind-attr refresh in lists', () => {
    it('data-bind-attr should be present after initial render in non-keyed list', async () => {
      wildflower.component('gap4-init', {
        state: {
          items: [
            { name: 'Alpha', tooltip: 'First item' },
            { name: 'Beta', tooltip: 'Second item' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap4-init">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="labeled" data-bind-attr="{ title: tooltip }" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const labeled = testContainer.querySelectorAll('.labeled')
      expect(labeled.length).toBe(2)
      expect(labeled[0].getAttribute('title')).toBe('First item')
      expect(labeled[1].getAttribute('title')).toBe('Second item')
    })

    it('data-bind-attr should update after item data change', async () => {
      wildflower.component('gap4-update', {
        state: {
          items: [
            { name: 'Alpha', tooltip: 'Original tooltip' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap4-update">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="labeled" data-bind-attr="{ title: tooltip }" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const labeled = testContainer.querySelector('.labeled')
      expect(labeled.getAttribute('title')).toBe('Original tooltip')

      // Update item data
      const component = wildflower.componentInstances.values().next().value
      component.state.items[0].tooltip = 'Updated tooltip'
      await waitForUpdate(200)

      expect(labeled.getAttribute('title')).toBe('Updated tooltip')
    })
  })

  // =========================================================================
  // Gap 5: Root element bindings missing store/expr support
  // File: ListItemBinding.js:92-141 (_bindRootElementData)
  // Root element only does _getValueFromItem — no $store, no expressions.
  // =========================================================================
  describe('Gap 5: Root element bindings with $store.path', () => {
    it('data-bind-class with $store.path on root list element', async () => {
      wildflower.store('gap5theme', {
        state: { mode: 'dark' }
      })

      wildflower.component('gap5-class', {
        state: {
          items: [
            { id: 1, name: 'Item A' },
            { id: 2, name: 'Item B' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap5-class">
          <ul data-list="items">
            <template>
              <li data-bind-class="$gap5theme.mode" data-bind="name"></li>
            </template>
          </ul>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const lis = testContainer.querySelectorAll('li')
      expect(lis.length).toBe(2)
      // Root element should have the store-derived class
      expect(lis[0].classList.contains('dark')).toBe(true)
      expect(lis[1].classList.contains('dark')).toBe(true)
    })

    it('data-bind with expression on root list element', async () => {
      wildflower.component('gap5-bind-expr', {
        state: {
          items: [
            { id: 1, name: 'Alpha', score: 95 },
            { id: 2, name: 'Beta', score: 40 }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap5-bind-expr">
          <ul data-list="items">
            <template>
              <li data-bind="name + ' (' + score + ')'"></li>
            </template>
          </ul>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const lis = testContainer.querySelectorAll('li')
      expect(lis.length).toBe(2)
      expect(lis[0].textContent).toBe('Alpha (95)')
      expect(lis[1].textContent).toBe('Beta (40)')
    })
  })

  // =========================================================================
  // Gap 6: isExpression() misses standalone $store.path
  // File: ExpressionEvaluator.js:181-199
  // $counter.count has no operators, so isExpression returns false.
  // Partially mitigated by commit 77af324.
  // =========================================================================
  describe('Gap 6: isExpression() detection of $store.path', () => {
    it('isExpression returns false for standalone $store.path (documents current behavior)', async () => {
      // This test documents that isExpression does NOT detect standalone $store.path
      // The framework works around this with explicit $ checks in binding paths
      const result = wildflower.isExpression('$counter.count')
      expect(result).toBe(false)
    })

    it('standalone $store.path renders store value in component binding', async () => {
      wildflower.store('gap6val', {
        state: { label: 'Hello from store' }
      })

      wildflower.component('gap6-standalone', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="gap6-standalone">
          <span class="output" data-bind="$gap6val.label"></span>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const output = testContainer.querySelector('.output')
      expect(output.textContent).toBe('Hello from store')
    })
  })

  // =========================================================================
  // Gap 7: _resolveItemLevelData missing $store/external support
  // File: ContextManager.js:466-560
  // Context resolution doesn't handle $store.path or external() in lists.
  // =========================================================================
  describe('Gap 7: Store path resolution in list item context', () => {
    it('data-bind with $store.path inside list renders store value', async () => {
      wildflower.store('gap7config', {
        state: { prefix: 'Item' }
      })

      wildflower.component('gap7-store-in-list', {
        state: {
          items: [
            { name: 'Alpha' },
            { name: 'Beta' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap7-store-in-list">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="prefix" data-bind="$gap7config.prefix + ': ' + name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const prefixes = testContainer.querySelectorAll('.prefix')
      expect(prefixes.length).toBe(2)
      expect(prefixes[0].textContent).toBe('Item: Alpha')
      expect(prefixes[1].textContent).toBe('Item: Beta')
    })

    it('data-show with $store.path expression inside list', async () => {
      wildflower.store('gap7vis', {
        state: { showAll: true }
      })

      wildflower.component('gap7-show-store', {
        state: {
          items: [
            { name: 'Alpha', featured: false },
            { name: 'Beta', featured: true }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap7-show-store">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="detail" data-show="featured || $gap7vis.showAll">Detail</span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const details = testContainer.querySelectorAll('.detail')
      expect(details.length).toBe(2)
      // showAll=true, so both should be visible
      expect(details[0].style.display).not.toBe('none')
      expect(details[1].style.display).not.toBe('none')
    })

    it('store changes should propagate to list items via context', async () => {
      wildflower.store('gap7reactive', {
        state: { label: 'Version 1' }
      })

      wildflower.component('gap7-reactive-list', {
        state: {
          items: [
            { name: 'Alpha' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap7-reactive-list">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="label" data-bind="$gap7reactive.label"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const label = testContainer.querySelector('.label')
      expect(label.textContent).toBe('Version 1')

      // Update store
      wildflower.getStore('gap7reactive').state.label = 'Version 2'
      await waitForUpdate(200)

      expect(label.textContent).toBe('Version 2')
    })
  })

  // =========================================================================
  // Gap 8: data-bind-html metadata missing expression flags
  // File: TemplateSystem.js:1264-1275
  // data-bind-html metadata doesn't set isExpression or pre-compile.
  // =========================================================================
  describe('Gap 8: data-bind-html expression flags in compiled list', () => {
    it('data-bind-html with expression in non-keyed list', async () => {
      wildflower.component('gap8-expr', {
        state: {
          items: [
            { name: 'Alpha', bold: true },
            { name: 'Beta', bold: false }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap8-expr">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="content" data-bind-html="bold ? '<b>' + name + '</b>' : name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const contents = testContainer.querySelectorAll('.content')
      expect(contents.length).toBe(2)
      // bold=true: should render with <b> tag
      expect(contents[0].innerHTML).toContain('<b>Alpha</b>')
      // bold=false: should render plain text
      expect(contents[1].textContent).toBe('Beta')
    })

    it('data-bind-html with $store.path in non-keyed list', async () => {
      wildflower.store('gap8html', {
        state: { wrapper: '<em>Styled</em>' }
      })

      wildflower.component('gap8-store', {
        state: {
          items: [
            { name: 'Item 1' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="gap8-store">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="html-out" data-bind-html="$gap8html.wrapper"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(150)

      const htmlOut = testContainer.querySelector('.html-out')
      expect(htmlOut.innerHTML).toContain('<em>Styled</em>')
    })
  })
})
