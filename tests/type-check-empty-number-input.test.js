/**
 * The development type check and an emptied number field.
 *
 * A state property that starts as a number is expected to stay one. A
 * type="number" input bound with data-model writes a Number, and '' when the
 * field is emptied (kept so validation can see the field is empty). That
 * empty write is legitimate, so it must not be reported as a type mismatch;
 * a genuine string still is. Development builds only.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

describe.skipIf(isMinifiedBuild())('type check: an emptied number field', () => {
  let host, warnings, origWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    host = document.createElement('div')
    document.body.appendChild(host)
    warnings = []
    origWarn = console.warn
    console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  })

  afterEach(() => {
    console.warn = origWarn
    host.remove()
  })

  async function mount() {
    let ctx = null
    window.wildflower.component('tc-empty-number', { state: { qty: 0 }, init() { ctx = this } })
    host.innerHTML = '<div data-component="tc-empty-number"><input id="tc-qty" type="number" data-model="qty"></div>'
    if (window.wildflower._setupDynamicComponentDetection) window.wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await new Promise((r) => setTimeout(r, 30))
    return ctx
  }

  const mismatches = () => warnings.filter((w) => w.includes('Type mismatch') && w.includes('"qty"'))

  it('emptying the field writes \'\' and says nothing', async () => {
    const ctx = await mount()
    const input = document.getElementById('tc-qty')
    input.value = '5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.qty).toBe('')
    expect(mismatches()).toEqual([])
  })

  it('a genuine string is still reported', async () => {
    const ctx = await mount()
    ctx.qty = 'five'
    await new Promise((r) => setTimeout(r, 20))
    expect(mismatches().length).toBe(1)
  })

  // The mirror case: a field that STARTS empty ('') is an empty field, not a
  // declared string, and a number input bound to it writes a Number.
  async function mountEmpty() {
    let ctx = null
    window.wildflower.component('tc-starts-empty', { state: { amount: '' }, init() { ctx = this } })
    host.innerHTML = '<div data-component="tc-starts-empty"><input id="tc-amount" type="number" data-model="amount" data-model-number></div>'
    if (window.wildflower._setupDynamicComponentDetection) window.wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await new Promise((r) => setTimeout(r, 30))
    return ctx
  }
  const amountMismatches = () => warnings.filter((w) => w.includes('Type mismatch') && w.includes('"amount"'))

  it('a field that starts as \'\' accepts a number from a number input, silently', async () => {
    const ctx = await mountEmpty()
    const input = document.getElementById('tc-amount')
    input.value = '300'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
    expect(ctx.amount).toBe(300)
    ctx.amount = ''
    await new Promise((r) => setTimeout(r, 20))
    expect(amountMismatches()).toEqual([])
  })

  it('a field that starts as \'\' still reports an array written to it', async () => {
    const ctx = await mountEmpty()
    ctx.amount = [1, 2]
    await new Promise((r) => setTimeout(r, 20))
    expect(amountMismatches().length).toBe(1)
  })
})
