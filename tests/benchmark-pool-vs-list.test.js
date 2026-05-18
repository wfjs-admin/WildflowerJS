/**
 * Pool vs List vs Vue — Framework Benchmark
 *
 * Vitest browser test that measures actual operation times using
 * rAF + setTimeout(0) — the standard post-paint measurement technique.
 *
 * Unlike double-rAF (which adds ~16ms of dead wait), rAF+setTimeout(0)
 * fires after the browser has committed the paint, giving true operation cost.
 *
 * Run:
 *   npx vitest run --config tests/vitest.browser.config.js tests/benchmark-pool-vs-list.test.js
 */

import { describe, it, expect, beforeAll } from 'vitest'

// ── Configuration ──

const WARMUP_RUNS = 2
const MEASURED_RUNS = 5
const TRIM_COUNT = 1 // Drop highest and lowest

// ── Measurement ──

/**
 * Measure an operation using rAF + setTimeout(0).
 * rAF fires after browser layout; setTimeout(0) fires after paint commit.
 * This is the standard JS-only post-paint measurement technique.
 */
function measure(fn) {
  return new Promise(resolve => {
    const start = performance.now()
    fn()
    requestAnimationFrame(() => {
      setTimeout(() => {
        resolve(performance.now() - start)
      }, 0)
    })
  })
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

function trimmedMean(arr) {
  if (arr.length <= 2 * TRIM_COUNT) return { kept: arr, trimmed: [] }
  const sorted = [...arr].sort((a, b) => a - b)
  return {
    kept: sorted.slice(TRIM_COUNT, sorted.length - TRIM_COUNT),
    trimmed: [sorted[0], sorted[sorted.length - 1]]
  }
}

function avg(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

// ── Framework Setup ──

async function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

async function setupBenchmarkPage() {
  // Load framework and Vue
  await loadScript('/dist/wildflower.full.js')
  await loadScript('https://unpkg.com/vue@3/dist/vue.global.prod.js')

  // Load benchmark data generator
  await loadScript('/tests/performance_benchmarks/benchmark-data.js')

  // Create containers BEFORE loading benchmark scripts.
  // The benchmark scripts use DOMContentLoaded to inject HTML,
  // but in Vitest the DOM is already loaded. So we create the containers
  // first, then after loading the scripts we manually inject the HTML
  // if DOMContentLoaded already fired.
  document.body.innerHTML = `
    <div id="pool-container"></div>
    <div id="custom-container"></div>
    <div id="vue-container"></div>
  `

  // Load benchmark implementations
  await loadScript('/tests/performance_benchmarks/wildflower-benchmark-direct-mutation.js')
  await loadScript('/tests/performance_benchmarks/wildflower-benchmark-direct-mutation-pool.js')
  await loadScript('/tests/performance_benchmarks/vue-benchmark-direct-mutation.js')

  // The DOMContentLoaded listeners in the benchmark scripts may not have fired
  // in the Vitest browser context. Manually inject the HTML if containers are empty.
  if (document.getElementById('custom-container').children.length === 0) {
    document.getElementById('custom-container').innerHTML = `
      <div data-component="wildflower-benchmark">
        <table class="table table-hover table-striped test-data">
          <tbody data-list="rows" data-key="id">
            <template>
              <tr data-bind-class="id === selectedId ? 'selected' : ''">
                <td class="col-md-1" data-bind="id"></td>
                <td class="col-md-4"><a data-action="selectRow" data-bind="label"></a></td>
                <td class="col-md-1"><a data-action="removeRow"><span class="glyphicon glyphicon-remove" aria-hidden="true">\u00d7</span></a></td>
                <td class="col-md-6" data-bind="user.profile.name"></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    `
  }

  if (document.getElementById('pool-container').children.length === 0) {
    document.getElementById('pool-container').innerHTML = `
      <div data-component="pool-benchmark">
        <table class="table table-hover table-striped test-data">
          <tbody data-pool="rows" data-key="id" data-pool-static>
            <template>
              <tr data-bind-class="id === props.selectedId ? 'selected' : ''">
                <td class="col-md-1" data-bind="id"></td>
                <td class="col-md-4"><a data-action="selectRow" data-bind="label"></a></td>
                <td class="col-md-1"><a data-action="removeRow"><span class="glyphicon glyphicon-remove" aria-hidden="true">\u00d7</span></a></td>
                <td class="col-md-6" data-bind="user.profile.name"></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    `
  }

  // Scan for WF components
  if (window.wildflower && window.wildflower.scan) {
    window.wildflower.scan()
  }

  // Wait for all frameworks to initialize
  await wait(500)

  // Wait for Vue and WF to be ready
  let retries = 0
  while (retries < 30) {
    if (window.PoolBenchmark && window.CustomBenchmark && window.VueBenchmark) {
      // Also verify pool component is actually initialized
      const poolComp = window.wildflower.getComponentsByType('pool-benchmark')
      const listComp = window.wildflower.getComponentsByType('wildflower-benchmark')
      if (poolComp.length > 0 && listComp.length > 0) break
    }
    await wait(100)
    retries++
  }

  if (!window.PoolBenchmark || !window.CustomBenchmark || !window.VueBenchmark) {
    throw new Error('Frameworks failed to initialize: ' +
      `Pool=${!!window.PoolBenchmark} List=${!!window.CustomBenchmark} Vue=${!!window.VueBenchmark}`)
  }
}

// ── Benchmark Runner ──

async function runTest(benchmarkApi, action, runs) {
  const durations = []
  for (let i = 0; i < runs; i++) {
    const d = await measure(() => benchmarkApi[action]())
    durations.push(d)
    await wait(50)
  }
  return durations
}

async function runSuite(benchmarkApi, tests) {
  const results = {}

  for (const t of tests) {
    const allDurations = []

    for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run++) {
      const isWarmup = run < WARMUP_RUNS
      const d = await measure(() => benchmarkApi[t.action]())

      if (!isWarmup) {
        allDurations.push(d)
      }
      await wait(100)
    }

    // Reset between tests
    if (benchmarkApi.reset) benchmarkApi.reset()
    await wait(200)

    results[t.action] = allDurations
  }

  return results
}

// ── Output Formatting ──

function formatTable(tests, pool, list, vue) {
  const lines = []
  const sep = '-'.repeat(110)

  lines.push('')
  lines.push([
    'Test'.padEnd(28),
    'WF Pool'.padStart(10),
    'WF List'.padStart(10),
    'Vue.js'.padStart(10),
    'Pool vs List'.padStart(18),
    'Pool vs Vue'.padStart(18),
  ].join(' | '))
  lines.push(sep)

  for (const t of tests) {
    const pTrimmed = trimmedMean(pool[t.action])
    const lTrimmed = trimmedMean(list[t.action])
    const vTrimmed = trimmedMean(vue[t.action])

    const pAvg = avg(pTrimmed.kept)
    const lAvg = avg(lTrimmed.kept)
    const vAvg = avg(vTrimmed.kept)

    function diff(base, compare) {
      const d = base - compare
      const pct = (d / compare) * 100
      const sign = d > 0 ? '+' : ''
      return `${sign}${d.toFixed(1)}ms (${sign}${pct.toFixed(0)}%)`.padStart(18)
    }

    lines.push([
      t.name.padEnd(28),
      `${pAvg.toFixed(1)}ms`.padStart(10),
      `${lAvg.toFixed(1)}ms`.padStart(10),
      `${vAvg.toFixed(1)}ms`.padStart(10),
      diff(pAvg, lAvg),
      diff(pAvg, vAvg),
    ].join(' | '))
  }

  lines.push(sep)
  return lines.join('\n')
}

// ── Tests ──

const TESTS_1K = [
  { action: 'create1000', name: 'Create 1,000 rows' },
  { action: 'append1000', name: 'Append 1,000 rows' },
  { action: 'update', name: 'Update every 10th' },
  { action: 'removeFromMiddle', name: 'Remove from middle' },
  { action: 'replaceAll', name: 'Replace all 1,000' },
  { action: 'swap', name: 'Swap rows' },
  { action: 'clear', name: 'Clear all rows' },
]

const TESTS_10K = [
  { action: 'create10000', name: 'Create 10,000 rows' },
  { action: 'append1000', name: 'Append 1,000 rows' },
  { action: 'update', name: 'Update every 10th' },
  { action: 'removeFromMiddle', name: 'Remove from middle' },
  { action: 'replaceAll', name: 'Replace all 1,000' },
  { action: 'swap', name: 'Swap rows' },
  { action: 'clear', name: 'Clear all rows' },
]

describe('Framework Benchmark (rAF+setTimeout measurement)', () => {

  beforeAll(async () => {
    await setupBenchmarkPage()
  }, 30000)

  it('Pool vs List vs Vue — 1K and 10K', async () => {
    console.log('\n══════════════════════════════════════════════════════')
    console.log('  Framework Benchmark — rAF + setTimeout(0) timing')
    console.log(`  Warmup: ${WARMUP_RUNS}, Measured: ${MEASURED_RUNS}, Trim: ${TRIM_COUNT}`)
    console.log('══════════════════════════════════════════════════════')

    // ── 1K Tests ──
    console.log('\nRunning 1K tests...')

    const pool1k = await runSuite(window.PoolBenchmark, TESTS_1K)
    const list1k = await runSuite(window.CustomBenchmark, TESTS_1K)
    const vue1k = await runSuite(window.VueBenchmark, TESTS_1K)

    console.log('\n── Standard Tests (1,000 rows) ──')
    console.log(formatTable(TESTS_1K, pool1k, list1k, vue1k))

    // ── 10K Tests ──
    console.log('\nRunning 10K tests...')

    const pool10k = await runSuite(window.PoolBenchmark, TESTS_10K)
    const list10k = await runSuite(window.CustomBenchmark, TESTS_10K)
    const vue10k = await runSuite(window.VueBenchmark, TESTS_10K)

    console.log('\n── Standard Tests (10,000 rows) ──')
    console.log(formatTable(TESTS_10K, pool10k, list10k, vue10k))

    // Test passes if it completes without error
    expect(true).toBe(true)
  }, 600000) // 10 minute timeout
})
