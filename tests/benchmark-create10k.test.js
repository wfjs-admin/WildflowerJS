/**
 * Benchmark: Create 10,000 rows
 *
 * Automated benchmark for the Create 10,000 operation.
 * Mirrors the actual benchmark suite (index-direct-mutation.html) but runs
 * via Vitest Browser Mode in headless Chromium for repeatable CLI execution.
 *
 * Run:
 *   npx vitest run --config tests/vitest.browser.config.js tests/benchmark-create10k.test.js
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Benchmark data generator — matches tests/performance_benchmarks/benchmark-data.js
const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy']
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange']
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard']

function generateRows(count, startId = 1) {
  const data = []
  for (let i = 0; i < count; i++) {
    const id = startId + i
    data.push({
      id,
      label: `${adjectives[id % adjectives.length]} ${colours[id % colours.length]} ${nouns[id % nouns.length]}`,
      selected: false
    })
  }
  return data
}

// Wait for render to complete (list items appear in DOM)
async function waitForRender(container, expectedCount, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (window.wildflower?._forceCompleteRender) {
      await window.wildflower._forceCompleteRender()
    }
    const rows = container.querySelectorAll('tbody tr')
    if (rows.length >= expectedCount) return rows.length
    await new Promise(r => setTimeout(r, 10))
  }
  return container.querySelectorAll('tbody tr').length
}

// Helper: set up a fresh benchmark component and return its context
async function setupBenchComponent(wildflower, testContainer) {
  resetFramework()
  if (wildflower._initContextSystem) {
    wildflower._contextSystemInitialized = false
    wildflower._initContextSystem()
  }
  testContainer.innerHTML = `
    <div data-component="bench-create10k">
      <table class="table table-hover table-striped test-data">
        <tbody data-list="rows" data-key="id">
          <template>
            <tr data-bind-class="id === selectedId ? 'selected' : ''">
              <td class="col-md-1" data-bind="id"></td>
              <td class="col-md-4">
                <a data-action="selectRow" data-bind="label"></a>
              </td>
              <td class="col-md-1">
                <a data-action="removeRow">
                  <span aria-hidden="true">x</span>
                </a>
              </td>
              <td class="col-md-6"></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  `

  wildflower.component('bench-create10k', {
    state: { rows: [], selectedId: null },
    computed: {
      rowCount() { return this.state.rows.length }
    },
    create10000Rows() {
      this.state.rows = generateRows(10000)
      this.state.selectedId = null
    },
    selectRow() {
      const el = this.listItem?.element
      if (el?._itemData) this.state.selectedId = el._itemData.id
    },
    removeRow() {
      const el = this.listItem?.element
      if (el?._itemData) {
        const idx = this.state.rows.findIndex(r => r.id === el._itemData.id)
        if (idx !== -1) this.state.rows.splice(idx, 1)
      }
    }
  })

  wildflower.scan()
  await new Promise(r => setTimeout(r, 50))

  const components = wildflower.getComponentsByType('bench-create10k')
  return components[0].context
}

const WARMUP_RUNS = 2
const TIMED_RUNS = 7

describe('Benchmark: Create 10,000 rows', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    testContainer = document.createElement('div')
    testContainer.id = 'benchmark-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer?.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it(`should benchmark create 10,000 rows (${WARMUP_RUNS} warmup + ${TIMED_RUNS} timed)`, async () => {
    // --- WARMUP: Let JIT compile the hot paths ---
    for (let w = 0; w < WARMUP_RUNS; w++) {
      const ctx = await setupBenchComponent(wildflower, testContainer)
      ctx.create10000Rows()
      await waitForRender(testContainer, 10000)
      // Settle between warmup runs
      await new Promise(r => setTimeout(r, 200))
    }

    // --- TIMED RUNS ---
    const times = []

    for (let run = 0; run < TIMED_RUNS; run++) {
      // Settle before each timed run — let GC from previous run complete
      await new Promise(r => setTimeout(r, 500))

      const ctx = await setupBenchComponent(wildflower, testContainer)

      const start = performance.now()
      ctx.create10000Rows()
      const count = await waitForRender(testContainer, 10000)
      const elapsed = performance.now() - start

      times.push(elapsed)
      expect(count).toBe(10000)
    }

    // --- Compute stats ---
    const sorted = [...times].sort((a, b) => a - b)
    const withoutWorst = sorted.slice(0, -1)
    const avg = withoutWorst.reduce((s, t) => s + t, 0) / withoutWorst.length
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    const median = sorted[Math.floor(sorted.length / 2)]

    console.warn('=== BENCHMARK: Create 10,000 rows ===')
    console.warn(`Warmup: ${WARMUP_RUNS} runs (discarded)`)
    console.warn(`Timed runs: ${times.map(t => t.toFixed(1) + 'ms').join(', ')}`)
    console.warn(`Sorted: ${sorted.map(t => t.toFixed(1) + 'ms').join(', ')}`)
    console.warn(`Best: ${best.toFixed(1)}ms | Worst: ${worst.toFixed(1)}ms (removed) | Median: ${median.toFixed(1)}ms`)
    console.warn(`Average (${withoutWorst.length} runs, worst removed): ${avg.toFixed(1)}ms`)
    console.warn('=====================================')

    expect(avg).toBeLessThan(5000)
  }, 180000) // 3 minute timeout
})
