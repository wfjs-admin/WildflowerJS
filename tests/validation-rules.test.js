/**
 * Cross-field validation rules — the `rules:` block on components.
 *
 * Declared facts about form state, checked on the existing data-validate
 * surface (same triggers, same status plumbing: formValid,
 * validationErrors, data-error-for, .invalid classes). The rule NAME is
 * the user-facing message unless `message:` overrides it. String checks
 * are CSP-evaluated over state and computed names; `fields:` (or the
 * variables the check reads) decide which inputs are marked. Invalid
 * declarations refuse with WF-228; a throwing function check is skipped
 * for the pass with WF-229.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, isMinifiedBuild } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

let seq = 0
const uname = (p) => `${p}-rules-${++seq}`

describe('Cross-field validation rules', () => {
  let testContainer
  let wildflower
  let warnings
  let realWarn
  let isDev

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    isDev = !isMinifiedBuild()
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
    warnings = []
    realWarn = console.warn
    console.warn = (...a) => { warnings.push(a.join(' ')); realWarn(...a) }
  })

  afterEach(() => {
    console.warn = realWarn
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  const warnCount = (code) => warnings.filter(w => w.includes(`[WF ${code}]`)).length

  it('a failing rule blocks submit; the rule name is the message; involved inputs are marked', async () => {
    const c = uname('dates')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="depart" type="text" data-model="depart">
          <input class="ret" type="text" data-model="ret">
          <span data-error-for="Return must be on or after departure"></span>
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { depart: '', ret: '' },
      rules: {
        'Return must be on or after departure': 'ret == "" || depart == "" || ret >= depart'
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const depart = testContainer.querySelector('.depart')
    const ret = testContainer.querySelector('.ret')
    depart.value = '2026-08-10'
    ret.value = '2026-08-01'

    const form = testContainer.querySelector('form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)

    expect(submitted, 'violated rule blocks the action').toBe(false)
    const errEl = testContainer.querySelector('[data-error-for="Return must be on or after departure"]')
    expect(errEl.textContent).toBe('Return must be on or after departure')
    expect(depart.classList.contains('invalid'), 'fields default to the variables the check reads').toBe(true)
    expect(ret.classList.contains('invalid')).toBe(true)

    ret.value = '2026-08-20'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)

    expect(submitted, 'satisfied rule lets the action run').toBe(true)
    expect(errEl.textContent).toBe('')
    expect(ret.classList.contains('invalid')).toBe(false)
  })

  it('object form: check + fields + message + when', async () => {
    const c = uname('delivery')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="pickup" type="text" data-model="pickup">
          <input class="address" type="text" data-model="address">
          <span data-error-for="pickup"></span>
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { pickup: '', address: '', delivery: false },
      rules: {
        'destination': {
          check: 'pickup != "" || address != ""',
          when: 'delivery',
          fields: ['pickup'],
          message: 'Provide a pickup point or an address'
        }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const form = testContainer.querySelector('form')
    const pickup = testContainer.querySelector('.pickup')
    const address = testContainer.querySelector('.address')

    // when: false — the rule is not in force
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'gated-off rule does not block').toBe(true)

    submitted = false
    const inst = [...wildflower.componentInstances.values()].find(i => i.name === c)
    inst.context.delivery = true
    await waitForUpdate(50)

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'gated-on rule blocks').toBe(false)
    expect(pickup.classList.contains('invalid'), 'only the declared field is marked').toBe(true)
    expect(address.classList.contains('invalid')).toBe(false)
    const errEl = testContainer.querySelector('[data-error-for="pickup"]')
    expect(errEl.textContent).toBe('Provide a pickup point or an address')

    pickup.value = 'Main St depot'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted).toBe(true)
    expect(pickup.classList.contains('invalid')).toBe(false)
  })

  it('when: takes a full CSP-safe expression, not just a bare identifier', async () => {
    const c = uname('when-compound')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="pickup" type="text" data-model="pickup">
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { pickup: '', delivery: false, accepted: false },
      rules: {
        'destination': {
          check: 'pickup != ""',
          when: 'delivery && accepted',
          fields: ['pickup']
        }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const form = testContainer.querySelector('form')
    const inst = [...wildflower.componentInstances.values()].find(i => i.name === c)

    // Only one half of the && is true: the rule is not in force.
    inst.context.delivery = true
    await waitForUpdate(50)
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'delivery alone does not satisfy delivery && accepted').toBe(true)

    // Both halves true: the rule is in force and blocks.
    submitted = false
    inst.context.accepted = true
    await waitForUpdate(50)
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'both true gates the rule on').toBe(false)

    testContainer.querySelector('.pickup').value = 'Main St depot'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'satisfying the check lets it through').toBe(true)
  })

  it('when: accepts a function, bound to the component, same as check:', async () => {
    const c = uname('when-fn')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="pickup" type="text" data-model="pickup">
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { pickup: '', delivery: false },
      rules: {
        'destination': {
          check: 'pickup != ""',
          when() { return this.delivery },
          fields: ['pickup']
        }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const form = testContainer.querySelector('form')
    const inst = [...wildflower.componentInstances.values()].find(i => i.name === c)

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'delivery false: the function when: gate is off').toBe(true)

    submitted = false
    inst.context.delivery = true
    await waitForUpdate(50)
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'delivery true: the gate is on and the empty pickup fails the check').toBe(false)
  })

  it('a when: function returning a Promise, undefined, or a string is diagnosed (WF-234) and the rule is skipped', async () => {
    const c = uname('when-verdict')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input type="text" data-model="pickup">
          <button type="submit">Go</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { pickup: '' },
      rules: {
        'async gate': { check: 'pickup != ""', when() { return Promise.resolve(true) } }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    testContainer.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(60)

    if (isDev) {
      expect(warnCount('WF-234'), 'bad when: verdict diagnosed').toBeGreaterThanOrEqual(1)
      expect(warnings.some(w => w.includes('async gate') && /promise/i.test(w) && w.includes('when:'))).toBe(true)
    }
    expect(submitted, 'a rule whose gate cannot be read is skipped, not treated as in-force or off').toBe(true)
  })

  it('a non-string, non-function when: refuses the whole rule with WF-228', async () => {
    const c = uname('when-badtype')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input type="text" data-model="pickup">
          <button type="submit">Go</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { pickup: '' },
      rules: {
        'bad when type': { check: 'pickup != ""', when: 42 }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    testContainer.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'the whole rule is refused, not just the when: gate').toBe(true)
    if (isDev) {
      expect(warnCount('WF-228')).toBeGreaterThanOrEqual(1)
      expect(warnings.some(w => w.includes('[WF WF-228]') && w.includes('when:'))).toBe(true)
    }
  })

  it('rules may reference computed properties', async () => {
    const c = uname('computed')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="a" type="text" data-model="a">
          <input class="b" type="text" data-model="b">
          <span data-error-for="Combined total must not exceed 100"></span>
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { a: '60', b: '70' },
      computed: {
        total() { return Number(this.a) + Number(this.b) }
      },
      rules: {
        'Combined total must not exceed 100': 'total <= 100'
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const a = testContainer.querySelector('.a')
    const b = testContainer.querySelector('.b')
    a.value = '60'
    b.value = '70'

    const form = testContainer.querySelector('form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, '60 + 70 violates the rule').toBe(false)
    const errEl = testContainer.querySelector('[data-error-for="Combined total must not exceed 100"]')
    expect(errEl.textContent).toBe('Combined total must not exceed 100')

    b.value = '30'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, '60 + 30 satisfies it').toBe(true)
  })

  it('a rule naming an unknown variable refuses with WF-228 and stays inert', async () => {
    const c = uname('unknown')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input type="text" data-model="a">
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { a: '' },
      rules: { 'ghost gate': 'ghost > 0' },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const form = testContainer.querySelector('form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'inert rule never blocks').toBe(true)
    if (isDev) {
      expect(warnCount('WF-228')).toBeGreaterThanOrEqual(1)
      expect(warnings.some(w => w.includes('[WF WF-228]') && w.includes('ghost'))).toBe(true)
    }
  })

  it('function checks run bound to the component; a throwing check is skipped with WF-229', async () => {
    const c = uname('fn')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="qty" type="text" data-model="qty">
          <span data-error-for="Quantity must be positive"></span>
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { qty: '0' },
      rules: {
        'Quantity must be positive': { check() { return Number(this.qty) > 0 }, fields: ['qty'] },
        'broken rule': { check() { throw new Error('boom') } }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const qty = testContainer.querySelector('.qty')
    qty.value = '0'
    const form = testContainer.querySelector('form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'failing function check blocks').toBe(false)
    expect(qty.classList.contains('invalid')).toBe(true)
    if (isDev) {
      expect(warnCount('WF-229'), 'throwing check reported').toBeGreaterThanOrEqual(1)
    }

    qty.value = '3'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'passing check + skipped broken rule lets submit through').toBe(true)
  })

  it('a bare function (no object wrapper) refuses with WF-228 and stays inert', async () => {
    const c = uname('barefn')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="qty" type="text" data-model="qty">
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { qty: '0' },
      rules: {
        'Quantity must be positive': function () { return Number(this.qty) > 0 }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const form = testContainer.querySelector('form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)

    expect(submitted, 'a refused rule never blocks; the object form is required for a function check').toBe(true)
    if (isDev) {
      expect(warnCount('WF-228')).toBeGreaterThanOrEqual(1)
      expect(warnings.some(w => w.includes('[WF WF-228]') && w.includes('no check expression or function'))).toBe(true)
    }
  })

  it('blur/change on an involved field updates rule status live', async () => {
    const c = uname('blur')
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="blur,submit" data-action="save" novalidate>
          <input class="depart" type="text" data-model="depart">
          <input class="ret" type="text" data-model="ret">
          <span data-error-for="Return must be on or after departure"></span>
          <button type="submit">Save</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { depart: '2026-08-10', ret: '' },
      rules: {
        'Return must be on or after departure': 'ret == "" || depart == "" || ret >= depart'
      },
      save() {}
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const ret = testContainer.querySelector('.ret')
    ret.value = '2026-08-01'
    ret.dispatchEvent(new Event('input', { bubbles: true }))
    await waitForUpdate(30)
    ret.dispatchEvent(new Event('change', { bubbles: true }))
    await waitForUpdate(50)

    const errEl = testContainer.querySelector('[data-error-for="Return must be on or after departure"]')
    expect(errEl.textContent, 'violation surfaces on change, before any submit').toBe('Return must be on or after departure')

    ret.value = '2026-08-20'
    ret.dispatchEvent(new Event('input', { bubbles: true }))
    await waitForUpdate(30)
    ret.dispatchEvent(new Event('change', { bubbles: true }))
    await waitForUpdate(50)
    expect(errEl.textContent, 'satisfaction clears it live').toBe('')
  })

  it('a function check can consult a store (the overlap/booking pattern)', async () => {
    const c = uname('booking')
    const storeName = uname('rooms')
    wildflower.store(storeName, {
      state: { bookings: [{ id: 1, roomId: 'A', start: 100, end: 200 }] }
    })
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input class="start" type="number" data-model="start" data-model-number>
          <input class="end" type="number" data-model="end" data-model-number>
          <span data-error-for="That room is already booked"></span>
          <button type="submit">Book</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { start: 150, end: 250, roomId: 'A', editingId: null },
      subscribe: [storeName],
      rules: {
        'That room is already booked': {
          check() {
            const taken = this.stores[storeName].bookings
            return !taken.some(b => b.roomId === this.roomId && this.start < b.end && b.start < this.end)
          },
          fields: ['start', 'end']
        }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    const form = testContainer.querySelector('form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'overlapping booking is blocked by the store-aware rule').toBe(false)
    expect(testContainer.querySelector('[data-error-for="That room is already booked"]').textContent)
      .toBe('That room is already booked')
    expect(testContainer.querySelector('.start').classList.contains('invalid'), 'declared fields are marked').toBe(true)

    // Move the booking clear of the existing one.
    const inst = [...wildflower.componentInstances.values()].find(i => i.name === c)
    inst.context.start = 300
    inst.context.end = 400
    await waitForUpdate(30)
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(50)
    expect(submitted, 'non-overlapping booking goes through').toBe(true)
  })

  // A function check's return value IS the verdict. Three returns are never a
  // verdict and each fails in its own silent way, so each is named (WF-234).
  it('a check returning a Promise, undefined, or a string is diagnosed (WF-234)', async () => {
    const c = uname('verdict')
    let submitted = false
    testContainer.innerHTML = `
      <div data-component="${c}">
        <form data-validate-on="submit" data-action="save" novalidate>
          <input type="text" data-model="a">
          <button type="submit">Go</button>
        </form>
      </div>
    `
    wildflower.component(c, {
      state: { a: 'x' },
      rules: {
        // async: !!Promise is always true, so this would silently always pass
        'async rule': { check() { return Promise.resolve(false) } },
        // forgotten return: falsy, so this would block the form forever
        'forgetful rule': { check() { const ok = true; /* no return */ } },
        // string: truthy, so this passes even though it reads like a refusal
        'stringy rule': { check() { return 'this reads like a refusal' } }
      },
      save() { submitted = true }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)

    testContainer.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForUpdate(60)

    if (isDev) {
      expect(warnCount('WF-234'), 'all three bad returns diagnosed').toBe(3)
      expect(warnings.some(w => w.includes('async rule') && /promise/i.test(w)), 'names the promise').toBe(true)
      expect(warnings.some(w => w.includes('forgetful rule') && /undefined/i.test(w)), 'names the undefined').toBe(true)
      expect(warnings.some(w => w.includes('stringy rule') && /string/i.test(w)), 'names the string').toBe(true)
    }

    // A rule whose verdict cannot be read is skipped, exactly like a thrower:
    // it must not silently pass OR silently block.
    expect(submitted, 'undecidable rules do not block the form').toBe(true)
  })

  it('the rules key is part of the component contract (no WF-219)', async () => {
    const c = uname('contract')
    testContainer.innerHTML = `<div data-component="${c}"><span data-bind="a"></span></div>`
    wildflower.component(c, {
      state: { a: 1, b: 2 },
      rules: { 'b beats a': 'b >= a' }
    })
    ensureComponentScanning(wildflower)
    await waitForUpdate(100)
    expect(warnings.some(w => w.includes('WF-219') && w.includes('rules'))).toBe(false)
  })
})
