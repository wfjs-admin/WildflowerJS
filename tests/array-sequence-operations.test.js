/**
 * Array Sequence Operations Test Suite
 *
 * Tests that after various sequences of array mutations (splice, swap, replace,
 * append), item property updates still propagate correctly to ALL DOM rows.
 *
 * These tests reproduce bugs found in the benchmark suite where operations like
 * splice(middle) followed by replaceAll or nested property updates only affected
 * rows before the splice point.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

// Wait for framework reactive cycle to complete
async function waitForUpdate(ms = 80) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Generate flat row data: { id, label }
function generateRows(count, startId = 1) {
  const rows = []
  for (let i = 0; i < count; i++) {
    rows.push({ id: startId + i, label: `Item ${startId + i}` })
  }
  return rows
}

// Generate nested row data: { id, label, user: { profile: { name } } }
function generateNestedRows(count, startId = 1) {
  const rows = []
  for (let i = 0; i < count; i++) {
    rows.push({
      id: startId + i,
      label: `Item ${startId + i}`,
      user: { profile: { name: `User ${startId + i}` } }
    })
  }
  return rows
}

describe('Array Sequence Operations', () => {
  let testContainer
  let wildflower
  const ROW_COUNT = 20
  const SPLICE_INDEX = 10

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._contextRegistry) {
      wildflower._contextRegistry.contexts?.clear()
      wildflower._contextRegistry.contextsByType?.clear()
      wildflower._contextRegistry.contextsByComponent?.clear()
      wildflower._contextRegistry.dependencies?.clear()
      wildflower._contextRegistry._contextTypeCache?.clear()
      wildflower._contextRegistry._contextModificationCounter = 0
    }

    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }

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

  /**
   * Helper: set up a flat-data component with data-key="id"
   */
  function setupFlatComponent(name) {
    wildflower.component(name, {
      state: { rows: [] }
    })

    testContainer.innerHTML = `
      <div data-component="${name}">
        <div data-list="rows" data-key="id">
          <template>
            <div class="row">
              <span class="id" data-bind="id"></span>
              <span class="label" data-bind="label"></span>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
  }

  /**
   * Helper: set up a nested-data component with data-key="id"
   */
  function setupNestedComponent(name) {
    wildflower.component(name, {
      state: { rows: [] }
    })

    testContainer.innerHTML = `
      <div data-component="${name}">
        <div data-list="rows" data-key="id">
          <template>
            <div class="row">
              <span class="id" data-bind="id"></span>
              <span class="label" data-bind="label"></span>
              <span class="nested-name" data-bind="user.profile.name"></span>
            </div>
          </template>
        </div>
      </div>
    `
    wildflower.scan()
  }

  /**
   * Helper: get the component instance's state manager
   */
  function getInstance(name) {
    const el = testContainer.querySelector(`[data-component="${name}"]`)
    const instance = wildflower.componentInstances.get(el.dataset.componentId)
    return instance.context
  }

  /**
   * Helper: get all rendered row elements
   */
  function getRows() {
    return testContainer.querySelectorAll('.row')
  }

  /**
   * Helper: check that all label cells contain expected suffix
   */
  function checkAllLabelsUpdated(suffix, expectedCount) {
    const rows = getRows()
    expect(rows.length).toBe(expectedCount)
    const failedIndices = []
    rows.forEach((row, i) => {
      const label = row.querySelector('.label').textContent
      if (!label.includes(suffix)) {
        failedIndices.push({ index: i, label })
      }
    })
    expect(failedIndices, `Labels at indices ${failedIndices.map(f => f.index).join(', ')} missing "${suffix}"`).toHaveLength(0)
  }

  /**
   * Helper: check that all nested-name cells contain expected suffix
   */
  function checkAllNestedNamesUpdated(suffix, expectedCount) {
    const rows = getRows()
    expect(rows.length).toBe(expectedCount)
    const failedIndices = []
    rows.forEach((row, i) => {
      const name = row.querySelector('.nested-name').textContent
      if (!name.includes(suffix)) {
        failedIndices.push({ index: i, name })
      }
    })
    expect(failedIndices, `Nested names at indices ${failedIndices.map(f => f.index).join(', ')} missing "${suffix}"`).toHaveLength(0)
  }

  /**
   * Helper: check labels at specific indices contain expected suffix
   */
  function checkLabelsAtIndices(indices, suffix) {
    const rows = getRows()
    const failedIndices = []
    indices.forEach(i => {
      if (i >= rows.length) {
        failedIndices.push({ index: i, label: '(row missing)' })
        return
      }
      const label = rows[i].querySelector('.label').textContent
      if (!label.includes(suffix)) {
        failedIndices.push({ index: i, label })
      }
    })
    expect(failedIndices, `Labels at indices ${failedIndices.map(f => f.index).join(', ')} missing "${suffix}"`).toHaveLength(0)
  }

  /**
   * Helper: check nested names at specific indices contain expected suffix
   */
  function checkNestedNamesAtIndices(indices, suffix) {
    const rows = getRows()
    const failedIndices = []
    indices.forEach(i => {
      if (i >= rows.length) {
        failedIndices.push({ index: i, name: '(row missing)' })
        return
      }
      const name = rows[i].querySelector('.nested-name').textContent
      if (!name.includes(suffix)) {
        failedIndices.push({ index: i, name })
      }
    })
    expect(failedIndices, `Nested names at indices ${failedIndices.map(f => f.index).join(', ')} missing "${suffix}"`).toHaveLength(0)
  }

  // =========================================================================
  // GROUP 1: Splice then Update (flat properties)
  // =========================================================================
  describe('Splice then Update (flat)', () => {

    it('updates all rows after splice from middle', async () => {
      // Create → splice(10, 1) → update ALL labels → check all updated
      setupFlatComponent('splice-flat-1')
      const ctx = getInstance('splice-flat-1')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      // Splice from middle
      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT - 1)

      // Update ALL labels
      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT - 1)
    })

    it('updates every 10th row after splice from middle', async () => {
      // Mirrors benchmark: create 20 → splice(10,1) → update every 10th
      setupFlatComponent('splice-flat-10th')
      const ctx = getInstance('splice-flat-10th')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      // Update every 10th row (indices 0 and 10)
      const updatedIndices = []
      for (let i = 0; i < ctx.state.rows.length; i += 10) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
        updatedIndices.push(i)
      }
      await waitForUpdate()

      checkLabelsAtIndices(updatedIndices, '!!!')
    })

    it('updates rows both before and after splice point', async () => {
      setupFlatComponent('splice-flat-both')
      const ctx = getInstance('splice-flat-both')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      // Update one row before splice point and one after
      ctx.state.rows[5].label = 'BEFORE !!!'
      ctx.state.rows[SPLICE_INDEX + 2].label = 'AFTER !!!'
      await waitForUpdate()

      checkLabelsAtIndices([5, SPLICE_INDEX + 2], '!!!')
    })

    it('updates last row after splice from middle', async () => {
      // Edge case: the last shifted row
      setupFlatComponent('splice-flat-last')
      const ctx = getInstance('splice-flat-last')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      const lastIdx = ctx.state.rows.length - 1
      ctx.state.rows[lastIdx].label = 'LAST !!!'
      await waitForUpdate()

      checkLabelsAtIndices([lastIdx], '!!!')
    })

    it('updates row immediately after splice point', async () => {
      // The row that shifted into the splice index
      setupFlatComponent('splice-flat-boundary')
      const ctx = getInstance('splice-flat-boundary')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      // Index SPLICE_INDEX now holds what was at SPLICE_INDEX+1
      ctx.state.rows[SPLICE_INDEX].label = 'SHIFTED !!!'
      await waitForUpdate()

      checkLabelsAtIndices([SPLICE_INDEX], '!!!')
    })
  })

  // =========================================================================
  // GROUP 2: Splice then Update (nested properties)
  // =========================================================================
  describe('Splice then Update (nested)', () => {

    it('updates all nested properties after splice from middle', async () => {
      // BUG REPRODUCTION: Create nested → splice(10,1) → update all nested → check all
      setupNestedComponent('splice-nested-all')
      const ctx = getInstance('splice-nested-all')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT - 1)

      // Update ALL nested names
      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT - 1)
    })

    it('updates every 10th nested property after splice', async () => {
      // BUG REPRODUCTION: Exact benchmark scenario
      setupNestedComponent('splice-nested-10th')
      const ctx = getInstance('splice-nested-10th')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      const updatedIndices = []
      for (let i = 0; i < ctx.state.rows.length; i += 10) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
        updatedIndices.push(i)
      }
      await waitForUpdate()

      checkNestedNamesAtIndices(updatedIndices, '!!!')
    })

    it('updates nested property on row right after splice point', async () => {
      setupNestedComponent('splice-nested-boundary')
      const ctx = getInstance('splice-nested-boundary')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      ctx.state.rows[SPLICE_INDEX].user.profile.name = 'SHIFTED !!!'
      await waitForUpdate()

      checkNestedNamesAtIndices([SPLICE_INDEX], '!!!')
    })

    it('updates nested property on last row after splice', async () => {
      setupNestedComponent('splice-nested-last')
      const ctx = getInstance('splice-nested-last')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      const lastIdx = ctx.state.rows.length - 1
      ctx.state.rows[lastIdx].user.profile.name = 'LAST !!!'
      await waitForUpdate()

      checkNestedNamesAtIndices([lastIdx], '!!!')
    })
  })

  // =========================================================================
  // GROUP 3: Splice then Replace then Update
  // =========================================================================
  describe('Splice then Replace then Update', () => {

    it('updates all labels after splice + replaceAll (same IDs)', async () => {
      // BUG REPRODUCTION: create → splice(10,1) → replaceAll(same IDs) → update → check
      setupFlatComponent('splice-replace-flat')
      const ctx = getInstance('splice-replace-flat')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      // Replace all with same IDs (1 through ROW_COUNT)
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      // Update ALL labels
      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT)
    })

    it('updates every 10th label after splice + replaceAll (same IDs)', async () => {
      // Exact benchmark failure: create → splice(10,1) → replaceAll → update every 10th
      setupFlatComponent('splice-replace-10th')
      const ctx = getInstance('splice-replace-10th')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      const updatedIndices = []
      for (let i = 0; i < ctx.state.rows.length; i += 10) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
        updatedIndices.push(i)
      }
      await waitForUpdate()

      checkLabelsAtIndices(updatedIndices, '!!!')
    })

    it('updates all nested properties after splice + replaceAll nested (same IDs)', async () => {
      setupNestedComponent('splice-replace-nested')
      const ctx = getInstance('splice-replace-nested')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT)
    })

    it('updates labels after splice + replaceAll (different IDs)', async () => {
      // Different IDs = all items removed and re-created, fresh effects
      setupFlatComponent('splice-replace-diffid')
      const ctx = getInstance('splice-replace-diffid')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      // Replace with completely different IDs
      ctx.state.rows = generateRows(ROW_COUNT, 1000)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT)
    })
  })

  // =========================================================================
  // GROUP 4: Swap then Update
  // =========================================================================
  describe('Swap then Update', () => {

    it('updates all labels after swap', async () => {
      setupFlatComponent('swap-flat-all')
      const ctx = getInstance('swap-flat-all')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // Swap indices 1 and 18
      const temp = ctx.state.rows[1]
      ctx.state.rows[1] = ctx.state.rows[18]
      ctx.state.rows[18] = temp
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT)
    })

    it('updates swapped rows specifically', async () => {
      setupFlatComponent('swap-flat-specific')
      const ctx = getInstance('swap-flat-specific')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      const temp = ctx.state.rows[1]
      ctx.state.rows[1] = ctx.state.rows[18]
      ctx.state.rows[18] = temp
      await waitForUpdate()

      // Update only the swapped rows
      ctx.state.rows[1].label = ctx.state.rows[1].label + ' !!!'
      ctx.state.rows[18].label = ctx.state.rows[18].label + ' !!!'
      await waitForUpdate()

      checkLabelsAtIndices([1, 18], '!!!')
    })

    it('updates all nested properties after swap', async () => {
      setupNestedComponent('swap-nested')
      const ctx = getInstance('swap-nested')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      const temp = ctx.state.rows[1]
      ctx.state.rows[1] = ctx.state.rows[18]
      ctx.state.rows[18] = temp
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT)
    })

    it('updates labels after swap + replaceAll (same IDs)', async () => {
      setupFlatComponent('swap-replace')
      const ctx = getInstance('swap-replace')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      const temp = ctx.state.rows[1]
      ctx.state.rows[1] = ctx.state.rows[18]
      ctx.state.rows[18] = temp
      await waitForUpdate()

      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT)
    })
  })

  // =========================================================================
  // GROUP 5: Append then various operations
  // =========================================================================
  describe('Append then operations', () => {

    it('updates all labels after append + splice', async () => {
      setupFlatComponent('append-splice')
      const ctx = getInstance('append-splice')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // Append 10 more rows
      const newRows = generateRows(10, ROW_COUNT + 1)
      ctx.state.rows.push(...newRows)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT + 10)

      // Splice from middle of appended range
      ctx.state.rows.splice(25, 1)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT + 9)

      // Update all
      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT + 9)
    })

    it('updates all labels after append + replaceAll', async () => {
      setupFlatComponent('append-replace')
      const ctx = getInstance('append-replace')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.push(...generateRows(10, ROW_COUNT + 1))
      await waitForUpdate()

      // Replace all with original count (IDs 1-20, drops appended rows)
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT)
    })

    it('correct row count after append + replaceAll (same IDs overlapping)', async () => {
      // append IDs 21-30, then replaceAll with IDs 1-20 (drops 21-30)
      setupFlatComponent('append-replace-count')
      const ctx = getInstance('append-replace-count')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.push(...generateRows(10, ROW_COUNT + 1))
      await waitForUpdate()
      expect(getRows().length).toBe(30)

      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)
    })
  })

  // =========================================================================
  // GROUP 6: Multiple splices then update
  // =========================================================================
  describe('Multiple splices then Update', () => {

    it('updates all labels after two splices', async () => {
      setupFlatComponent('multi-splice-flat')
      const ctx = getInstance('multi-splice-flat')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // First splice at index 5
      ctx.state.rows.splice(5, 1)
      await waitForUpdate()

      // Second splice at index 10 (post-first-splice)
      ctx.state.rows.splice(10, 1)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT - 2)

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT - 2)
    })

    it('updates all nested properties after two splices', async () => {
      setupNestedComponent('multi-splice-nested')
      const ctx = getInstance('multi-splice-nested')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(5, 1)
      await waitForUpdate()

      ctx.state.rows.splice(10, 1)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT - 2)
    })

    it('updates all labels after splice from beginning', async () => {
      setupFlatComponent('splice-begin')
      const ctx = getInstance('splice-begin')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // Splice from beginning (index 0) — shifts ALL items
      ctx.state.rows.splice(0, 1)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT - 1)

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT - 1)
    })

    it('updates all nested properties after splice from beginning', async () => {
      setupNestedComponent('splice-begin-nested')
      const ctx = getInstance('splice-begin-nested')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(0, 1)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT - 1)
    })

    it('updates labels after splice of multiple items', async () => {
      setupFlatComponent('splice-multi-items')
      const ctx = getInstance('splice-multi-items')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // Remove 3 items from middle
      ctx.state.rows.splice(SPLICE_INDEX, 3)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT - 3)

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT - 3)
    })
  })

  // =========================================================================
  // GROUP 7: Complex multi-step sequences
  // =========================================================================
  describe('Complex multi-step sequences', () => {

    it('splice + swap + update all labels', async () => {
      setupFlatComponent('splice-swap-update')
      const ctx = getInstance('splice-swap-update')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      // Swap first and last
      const temp = ctx.state.rows[0]
      ctx.state.rows[0] = ctx.state.rows[ctx.state.rows.length - 1]
      ctx.state.rows[ctx.state.rows.length - 1] = temp
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT - 1)
    })

    it('splice + append + update all labels', async () => {
      setupFlatComponent('splice-append-update')
      const ctx = getInstance('splice-append-update')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      ctx.state.rows.push(...generateRows(5, 100))
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT - 1 + 5)

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT - 1 + 5)
    })

    it('swap + splice + replaceAll + update', async () => {
      setupFlatComponent('swap-splice-replace-update')
      const ctx = getInstance('swap-splice-replace-update')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // Swap
      const temp = ctx.state.rows[2]
      ctx.state.rows[2] = ctx.state.rows[17]
      ctx.state.rows[17] = temp
      await waitForUpdate()

      // Splice
      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      // Replace all with same IDs
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      // Update
      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT)
    })

    it('replaceAll + splice + update', async () => {
      setupFlatComponent('replace-splice-update')
      const ctx = getInstance('replace-splice-update')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // Replace all first
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      // Then splice
      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', ROW_COUNT - 1)
    })

    it('nested: splice + replaceAll + update nested', async () => {
      setupNestedComponent('nested-splice-replace-update')
      const ctx = getInstance('nested-splice-replace-update')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT)
    })

    it('nested: swap + update nested', async () => {
      setupNestedComponent('nested-swap-update')
      const ctx = getInstance('nested-swap-update')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      const temp = ctx.state.rows[1]
      ctx.state.rows[1] = ctx.state.rows[18]
      ctx.state.rows[18] = temp
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT)
    })

    it('nested: splice + swap + update nested', async () => {
      setupNestedComponent('nested-splice-swap-update')
      const ctx = getInstance('nested-splice-swap-update')
      ctx.state.rows = generateNestedRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      const temp = ctx.state.rows[0]
      ctx.state.rows[0] = ctx.state.rows[ctx.state.rows.length - 1]
      ctx.state.rows[ctx.state.rows.length - 1] = temp
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', ROW_COUNT - 1)
    })
  })

  // =========================================================================
  // GROUP 8: Row count correctness after sequences
  // =========================================================================
  describe('Row count correctness', () => {

    it('correct count after create + append + replaceAll', async () => {
      setupFlatComponent('count-append-replace')
      const ctx = getInstance('count-append-replace')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      ctx.state.rows.push(...generateRows(ROW_COUNT, ROW_COUNT + 1))
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT * 2)

      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)
    })

    it('correct count after splice + replaceAll', async () => {
      setupFlatComponent('count-splice-replace')
      const ctx = getInstance('count-splice-replace')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT - 1)

      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)
    })

    it('correct count after clear + create', async () => {
      setupFlatComponent('count-clear-create')
      const ctx = getInstance('count-clear-create')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)

      ctx.state.rows = []
      await waitForUpdate()
      expect(getRows().length).toBe(0)

      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(ROW_COUNT)
    })
  })

  // =========================================================================
  // GROUP 9: Verify data correctness (IDs match, order correct)
  // =========================================================================
  describe('Data correctness after operations', () => {

    it('IDs are correct after splice', async () => {
      setupFlatComponent('data-splice-ids')
      const ctx = getInstance('data-splice-ids')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      const rows = getRows()
      for (let i = 0; i < rows.length; i++) {
        const displayedId = rows[i].querySelector('.id').textContent.trim()
        const expectedId = ctx.state.rows[i].id
        expect(Number(displayedId)).toBe(expectedId)
      }
    })

    it('IDs are correct after swap', async () => {
      setupFlatComponent('data-swap-ids')
      const ctx = getInstance('data-swap-ids')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      const temp = ctx.state.rows[1]
      ctx.state.rows[1] = ctx.state.rows[18]
      ctx.state.rows[18] = temp
      await waitForUpdate()

      const rows = getRows()
      for (let i = 0; i < rows.length; i++) {
        const displayedId = rows[i].querySelector('.id').textContent.trim()
        const expectedId = ctx.state.rows[i].id
        expect(Number(displayedId)).toBe(expectedId)
      }
    })

    it('IDs are correct after splice + replaceAll', async () => {
      setupFlatComponent('data-splice-replace-ids')
      const ctx = getInstance('data-splice-replace-ids')
      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(SPLICE_INDEX, 1)
      await waitForUpdate()

      ctx.state.rows = generateRows(ROW_COUNT)
      await waitForUpdate()

      const rows = getRows()
      expect(rows.length).toBe(ROW_COUNT)
      for (let i = 0; i < rows.length; i++) {
        const displayedId = rows[i].querySelector('.id').textContent.trim()
        expect(Number(displayedId)).toBe(i + 1)
      }
    })
  })

  // =========================================================================
  // GROUP 10: Scale tests (100+ items, tests for scale-dependent bugs)
  // =========================================================================
  describe('Scale tests (100 items)', () => {
    const LARGE_COUNT = 100
    const LARGE_SPLICE = 50

    it('updates every 10th label after splice + replaceAll (100 items)', async () => {
      // Reproduces benchmark: create 100 → splice(50,1) → replaceAll same IDs → update 10th
      setupFlatComponent('scale-splice-replace-10th')
      const ctx = getInstance('scale-splice-replace-10th')
      ctx.state.rows = generateRows(LARGE_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(LARGE_COUNT)

      ctx.state.rows.splice(LARGE_SPLICE, 1)
      await waitForUpdate()
      expect(getRows().length).toBe(LARGE_COUNT - 1)

      ctx.state.rows = generateRows(LARGE_COUNT)
      await waitForUpdate()
      expect(getRows().length).toBe(LARGE_COUNT)

      const updatedIndices = []
      for (let i = 0; i < ctx.state.rows.length; i += 10) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
        updatedIndices.push(i)
      }
      await waitForUpdate()

      checkLabelsAtIndices(updatedIndices, '!!!')
    })

    it('updates all labels after splice + replaceAll (100 items)', async () => {
      setupFlatComponent('scale-splice-replace-all')
      const ctx = getInstance('scale-splice-replace-all')
      ctx.state.rows = generateRows(LARGE_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(LARGE_SPLICE, 1)
      await waitForUpdate()

      ctx.state.rows = generateRows(LARGE_COUNT)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', LARGE_COUNT)
    })

    it('updates all nested properties after splice (100 items)', async () => {
      setupNestedComponent('scale-splice-nested')
      const ctx = getInstance('scale-splice-nested')
      ctx.state.rows = generateNestedRows(LARGE_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(LARGE_SPLICE, 1)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', LARGE_COUNT - 1)
    })

    it('updates all labels after splice (100 items, flat)', async () => {
      setupFlatComponent('scale-splice-flat')
      const ctx = getInstance('scale-splice-flat')
      ctx.state.rows = generateRows(LARGE_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(LARGE_SPLICE, 1)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].label = ctx.state.rows[i].label + ' !!!'
      }
      await waitForUpdate()

      checkAllLabelsUpdated('!!!', LARGE_COUNT - 1)
    })

    it('updates every 10th nested property after splice (100 items)', async () => {
      setupNestedComponent('scale-splice-nested-10th')
      const ctx = getInstance('scale-splice-nested-10th')
      ctx.state.rows = generateNestedRows(LARGE_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(LARGE_SPLICE, 1)
      await waitForUpdate()

      const updatedIndices = []
      for (let i = 0; i < ctx.state.rows.length; i += 10) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
        updatedIndices.push(i)
      }
      await waitForUpdate()

      checkNestedNamesAtIndices(updatedIndices, '!!!')
    })

    it('updates nested after splice + replaceAll (100 items)', async () => {
      setupNestedComponent('scale-splice-replace-nested')
      const ctx = getInstance('scale-splice-replace-nested')
      ctx.state.rows = generateNestedRows(LARGE_COUNT)
      await waitForUpdate()

      ctx.state.rows.splice(LARGE_SPLICE, 1)
      await waitForUpdate()

      ctx.state.rows = generateNestedRows(LARGE_COUNT)
      await waitForUpdate()

      for (let i = 0; i < ctx.state.rows.length; i++) {
        ctx.state.rows[i].user.profile.name = ctx.state.rows[i].user.profile.name + ' !!!'
      }
      await waitForUpdate()

      checkAllNestedNamesUpdated('!!!', LARGE_COUNT)
    })
  })
})
