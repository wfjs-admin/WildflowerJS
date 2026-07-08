/**
 * WF-212: dev-mode warning when a pool aggregate (length/size) is read
 * inside a computed.
 *
 * pool.length / pool.size are plain getters that bypass reactivity. A computed
 * that reads them evaluates once and never re-runs when the pool changes, so
 * the bound UI silently goes stale. The framework now emits a one-time WF-212
 * warning when it detects an aggregate read during a computed's evaluation.
 *
 * Contract:
 *   - __DEV__-gated: stripped entirely from min builds (warning never fires).
 *   - Fires at most once per pool handle.
 *   - Does NOT fire for the idiomatic mirror pattern, which reads pool.length
 *     inside tick()/methods/init (not a computed evaluation).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

async function waitForUpdate(ms = 60) {
  await new Promise(resolve => setTimeout(resolve, ms))
}
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

describeIfPools('WF-212: pool aggregate read inside a computed', () => {
  let testContainer
  let wildflower
  let warnSpy

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
    warnSpy.mockRestore()
  })

  // __DEV__-gated: on min builds the whole detection block (and the WF-212
  // string) is dead-code-eliminated, so the warning never fires there.
  it.skipIf(isMinifiedBuild())('warns when a computed reads pool.length', async () => {
    testContainer.innerHTML = `
      <div data-component="agg-warn-count">
        <span data-bind="count"></span>
        <div data-pool="items"><template><div></div></template></div>
      </div>
    `
    wildflower.component('agg-warn-count', {
      state: { n: 0 },
      computed: {
        count() {
          this.state.n            // reactive dep so we can force a re-eval
          const p = this.pool('items')
          return p ? p.length : -1
        }
      }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    // Force at least one tracked re-eval with the pool definitely present.
    const el = testContainer.querySelector('[data-component="agg-warn-count"]')
    const inst = wildflower.componentInstances.get(el.dataset.componentId)
    inst.state.n++
    await waitForUpdate()

    const wf212 = warnSpy.mock.calls.map(c => c.join(' ')).find(s => s.includes('WF-212'))
    expect(wf212).toBeDefined()
  })

  // The dedup flag lives on the pool handle: a stable handle warns once, no
  // matter how many times the computed re-evaluates. (Per "once per handle",
  // if the framework legitimately rebuilds the handle during initial settling
  // it may warn again for the new handle — so we assert the steady-state
  // property: once settled, further re-evals add ZERO new warnings. That is
  // the regression that matters, since the footgun's harm is per-frame spam.)
  it.skipIf(isMinifiedBuild())('does not re-warn on steady-state re-evaluation', async () => {
    testContainer.innerHTML = `
      <div data-component="agg-warn-steady">
        <span data-bind="count"></span>
        <div data-pool="items"><template><div></div></template></div>
      </div>
    `
    wildflower.component('agg-warn-steady', {
      state: { n: 0 },
      computed: {
        count() {
          this.state.n
          const p = this.pool('items')
          return p ? p.length : -1
        }
      }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const el = testContainer.querySelector('[data-component="agg-warn-steady"]')
    const inst = wildflower.componentInstances.get(el.dataset.componentId)

    // Drive a couple of re-evals so any transient handle re-creation during
    // initial scan/cloak settling is done, then snapshot the warning count.
    inst.state.n++; await waitForUpdate()
    inst.state.n++; await waitForUpdate()
    const countWF212 = () => warnSpy.mock.calls.map(c => c.join(' ')).filter(s => s.includes('WF-212')).length
    const baseline = countWF212()
    expect(baseline).toBeGreaterThanOrEqual(1)   // it did warn

    // Many more re-evals against the now-stable handle: zero new warnings.
    for (let i = 0; i < 5; i++) { inst.state.n++; await waitForUpdate() }
    expect(countWF212()).toBe(baseline)
  })

  it('does NOT warn when pool.length is read outside a computed', async () => {
    testContainer.innerHTML = `
      <div data-component="agg-no-warn">
        <span data-bind="shown"></span>
        <div data-pool="items"><template><div></div></template></div>
      </div>
    `
    let readInInit = null
    wildflower.component('agg-no-warn', {
      state: { label: 'hi' },
      computed: {
        shown() { return this.state.label }      // reads state only, never the pool
      },
      init() {
        const p = this.pool('items')
        readInInit = p ? p.length : -1           // legitimate one-time read, not a computed
      },
      recount() {
        const p = this.pool('items')
        return p ? p.length : -1                 // method read, not a computed
      }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const el = testContainer.querySelector('[data-component="agg-no-warn"]')
    const inst = wildflower.componentInstances.get(el.dataset.componentId)
    inst.recount()
    await waitForUpdate()

    expect(readInInit).toBe(0)   // the init/method reads worked
    const wf212 = warnSpy.mock.calls.map(c => c.join(' ')).filter(s => s.includes('WF-212'))
    expect(wf212.length).toBe(0)
  })
})
