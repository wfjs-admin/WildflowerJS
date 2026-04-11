/**
 * WildflowerJS Scoped Scan Tests - Vitest Browser Mode
 *
 * Tests scoped component discovery via optional scope argument.
 * This enables efficient scanning of dynamically added content,
 * particularly useful for third-party library integration (e.g., DataTables).
 *
 * Public API:
 *   wildflower.scan()              - Global scan (all components)
 *   wildflower.scan('#container')  - Scoped scan (only within element)
 *   wildflower.scan(element)       - Scoped scan (element reference)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 10) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Scoped Scan API', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  describe('API Availability', () => {
    it('should expose wildflower.scan() as public alias', () => {
      expect(typeof wildflower.scan).toBe('function')
    })

    it('should accept optional scope and respect it', async () => {
      // scan() should accept a scope argument and ONLY scan within it
      expect(typeof wildflower.scan).toBe('function')

      // Define component first (nothing to find yet)
      wildflower.component('scoped-api-test', { state: {} })
      await waitForUpdate(50) // Wait for any auto-scan to complete

      // Now add HTML - mutation observer will queue a scan
      testContainer.innerHTML = `
        <div id="scan-area">
          <div data-component="scoped-api-test" id="inside"></div>
        </div>
        <div id="no-scan-area">
          <div data-component="scoped-api-test" id="outside"></div>
        </div>
      `

      // Immediately do scoped scan before mutation observer fires (it's debounced)
      const scanArea = document.getElementById('scan-area')
      const count = wildflower.scan(scanArea)

      // Verify only scoped component was initialized
      const instances = wildflower.getComponents('scoped-api-test')
      expect(instances.length).toBe(1)
      expect(instances[0].element.id).toBe('inside')
    })
  })

  describe('Global Scan (no arguments)', () => {
    it('should scan entire document when called without arguments', async () => {
      wildflower.component('global-test', {
        state: { value: 'initialized' }
      })

      testContainer.innerHTML = `
        <div data-component="global-test" id="comp1"></div>
        <div data-component="global-test" id="comp2"></div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instances = wildflower.getComponents('global-test')
      expect(instances.length).toBe(2)
    })

    it('should work without scope argument (global scan)', async () => {
      wildflower.component('equiv-test', {
        state: { value: 'test' }
      })

      testContainer.innerHTML = '<div data-component="equiv-test"></div>'

      wildflower.scan()
      await waitForUpdate()

      const instances = wildflower.getComponents('equiv-test')
      expect(instances.length).toBe(1)
    })
  })

  describe('Scoped Scan (with selector)', () => {
    it('should only scan within specified selector', async () => {
      // Define component first (nothing to find yet)
      wildflower.component('scoped-test', { state: { value: 'found' } })
      await waitForUpdate(50)

      // Add HTML - immediately do scoped scan before mutation observer
      testContainer.innerHTML = `
        <div id="scope-a">
          <div data-component="scoped-test" id="in-scope"></div>
        </div>
        <div id="scope-b">
          <div data-component="scoped-test" id="out-scope"></div>
        </div>
      `

      // Immediately scan only scope-a
      wildflower.scan('#scope-a')

      const instances = wildflower.getComponents('scoped-test')
      expect(instances.length).toBe(1)
      expect(instances[0].element.id).toBe('in-scope')
    })

    it('should not initialize components outside the scope', async () => {
      // Define component first
      wildflower.component('outside-test', { state: { initialized: true } })
      await waitForUpdate(50)

      // Add HTML
      testContainer.innerHTML = `
        <div id="inside">
          <div data-component="outside-test" id="comp-inside"></div>
        </div>
        <div id="outside">
          <div data-component="outside-test" id="comp-outside"></div>
        </div>
      `

      // Immediately scan only inside
      wildflower.scan('#inside')

      // Only the inside component should be initialized
      const instances = wildflower.getComponents('outside-test')
      expect(instances.length).toBe(1)
      expect(instances[0].element.id).toBe('comp-inside')

      // The outside element should still have data-component but no instance
      const outsideEl = document.getElementById('comp-outside')
      expect(outsideEl.getAttribute('data-component')).toBe('outside-test')
    })

    it('should work with complex selectors', async () => {
      // Define component first
      wildflower.component('complex-sel', { state: { found: true } })
      await waitForUpdate(50)

      // Add HTML
      testContainer.innerHTML = `
        <div class="container">
          <div class="row target">
            <div data-component="complex-sel" id="target-comp"></div>
          </div>
          <div class="row other">
            <div data-component="complex-sel" id="other-comp"></div>
          </div>
        </div>
      `

      // Immediately scan only target
      wildflower.scan('.container .row.target')

      const instances = wildflower.getComponents('complex-sel')
      expect(instances.length).toBe(1)
      expect(instances[0].element.id).toBe('target-comp')
    })
  })

  describe('Scoped Scan (with element reference)', () => {
    it('should accept DOM element as argument', async () => {
      // Define component first (nothing to find yet)
      wildflower.component('elem-ref-test', {
        state: { value: 1 }
      })
      await waitForUpdate(50) // Wait for any auto-scan to complete

      // Now add HTML - immediately do scoped scan before mutation observer
      testContainer.innerHTML = `
        <div id="target-container">
          <div data-component="elem-ref-test" id="elem-comp"></div>
        </div>
        <div id="other-container">
          <div data-component="elem-ref-test" id="other-comp"></div>
        </div>
      `

      // Immediately scan only target using element reference
      const targetEl = document.getElementById('target-container')
      wildflower.scan(targetEl)

      const instances = wildflower.getComponents('elem-ref-test')
      expect(instances.length).toBe(1)
      expect(instances[0].element.id).toBe('elem-comp')
    })
  })

  describe('Incremental Scanning', () => {
    it('should not re-initialize already initialized components', async () => {
      let initCount = 0
      wildflower.component('no-reinit', {
        state: { value: 0 },
        init() {
          initCount++
        }
      })

      testContainer.innerHTML = '<div data-component="no-reinit"></div>'

      wildflower.scan()
      await waitForUpdate()
      expect(initCount).toBe(1)

      // Scan again - should not re-initialize
      wildflower.scan()
      await waitForUpdate()
      expect(initCount).toBe(1)
    })

    it('should initialize only new components on subsequent scans', async () => {
      let initOrder = []
      wildflower.component('incremental', {
        state: {},
        init() {
          initOrder.push(this.element.id)
        }
      })

      testContainer.innerHTML = `
        <div id="dynamic-area"></div>
        <div data-component="incremental" id="first"></div>
      `

      wildflower.scan()
      await waitForUpdate()
      expect(initOrder).toEqual(['first'])

      // Dynamically add a new component
      const dynamicArea = document.getElementById('dynamic-area')
      dynamicArea.innerHTML = '<div data-component="incremental" id="second"></div>'

      wildflower.scan('#dynamic-area')
      await waitForUpdate()
      expect(initOrder).toEqual(['first', 'second'])
    })
  })

  describe('DataTables Integration Pattern', () => {
    it('should support scanning table cells after dynamic render', async () => {
      wildflower.component('cell-component', {
        state: { active: false },
        toggle() {
          this.state.active = !this.state.active
        }
      })

      // Simulate DataTables rendering cells with components
      testContainer.innerHTML = `
        <table id="data-table">
          <tbody id="table-body">
            <tr><td><span data-component="cell-component" id="cell-1"></span></td></tr>
            <tr><td><span data-component="cell-component" id="cell-2"></span></td></tr>
          </tbody>
        </table>
      `

      // Scan only the table body (like DataTables drawCallback would)
      wildflower.scan('#table-body')
      await waitForUpdate()

      const instances = wildflower.getComponents('cell-component')
      expect(instances.length).toBe(2)
    })

    it('should handle repeated scans after table redraws', async () => {
      let instanceIds = []
      wildflower.component('redraw-cell', {
        state: {},
        init() {
          instanceIds.push(this.element.id)
        }
      })

      testContainer.innerHTML = '<table><tbody id="tbody"></tbody></table>'
      const tbody = document.getElementById('tbody')

      // First "draw"
      tbody.innerHTML = `
        <tr><td><span data-component="redraw-cell" id="row-1"></span></td></tr>
      `
      wildflower.scan('#tbody')
      await waitForUpdate()
      expect(instanceIds).toEqual(['row-1'])

      // Simulate DataTables clearing and redrawing (sorting/paging)
      // In real scenario, old DOM is destroyed, new DOM created
      tbody.innerHTML = `
        <tr><td><span data-component="redraw-cell" id="row-a"></span></td></tr>
        <tr><td><span data-component="redraw-cell" id="row-b"></span></td></tr>
      `
      wildflower.scan('#tbody')
      await waitForUpdate()
      expect(instanceIds).toEqual(['row-1', 'row-a', 'row-b'])
    })
  })

  describe('Edge Cases', () => {
    it('should handle non-existent selector gracefully', async () => {
      // Should not throw
      expect(() => wildflower.scan('#does-not-exist')).not.toThrow()
    })

    it('should handle empty container', async () => {
      testContainer.innerHTML = '<div id="empty"></div>'
      expect(() => wildflower.scan('#empty')).not.toThrow()
    })

    it('should handle null/undefined gracefully', async () => {
      expect(() => wildflower.scan(null)).not.toThrow()
      expect(() => wildflower.scan(undefined)).not.toThrow()
    })

    it('should scan nested components correctly', async () => {
      wildflower.component('outer-comp', { state: { name: 'outer' } })
      wildflower.component('inner-comp', { state: { name: 'inner' } })

      testContainer.innerHTML = `
        <div id="scope">
          <div data-component="outer-comp">
            <div data-component="inner-comp" id="nested"></div>
          </div>
        </div>
      `

      wildflower.scan('#scope')
      await waitForUpdate()

      expect(wildflower.getComponents('outer-comp').length).toBe(1)
      expect(wildflower.getComponents('inner-comp').length).toBe(1)
    })
  })

  describe('Return Value', () => {
    it('should return count of newly initialized components', async () => {
      wildflower.component('return-test', { state: {} })

      testContainer.innerHTML = `
        <div id="area">
          <div data-component="return-test"></div>
          <div data-component="return-test"></div>
        </div>
      `

      const count = wildflower.scan('#area')
      await waitForUpdate()

      expect(count).toBe(2)
    })

    it('should return 0 when no new components found', async () => {
      testContainer.innerHTML = '<div id="empty-area"></div>'

      const count = wildflower.scan('#empty-area')
      expect(count).toBe(0)
    })
  })
})
