/**
 * Nano Build Smoke Test
 *
 * The nano tier is the below-mini widget/artifact build: core reactive UI +
 * components, NO data-list render cluster, NO pools/portals/transitions/plugins.
 * It ships data-bind, data-show, data-render, data-model, data-action, forms,
 * computed, and external() — the conditional/data-render/model/external methods
 * were relocated out of the list cluster so they survive in nano.
 *
 * This suite PROVES nano boots and runs widgets with zero throws, and that each
 * core widget feature actually works (not just that it doesn't crash). It runs
 * ONLY against a nano build (WILDFLOWER_DIST=nano / nano-dev / nano-min). List
 * behaviour is covered by the list-gated suites, which skip on nano.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const IS_NANO = (typeof __WILDFLOWER_DIST__ !== 'undefined') &&
  typeof __WILDFLOWER_DIST__ === 'string' &&
  __WILDFLOWER_DIST__.startsWith('nano')

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

describe.skipIf(!IS_NANO)('Nano Build Smoke Test', () => {
  let testContainer
  let wildflower
  let consoleErrors

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Capture any console.error emitted while a widget boots/runs — a crash on a
    // list-only path that leaked into nano would surface here.
    consoleErrors = []
    const origError = console.error
    console.error = (...args) => { consoleErrors.push(args.join(' ')); origError.apply(console, args) }
    beforeEach._restoreError = () => { console.error = origError }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (beforeEach._restoreError) beforeEach._restoreError()
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('boots and renders a basic reactive component (data-bind)', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-hello">
        <span id="nano-msg" data-bind="message"></span>
      </div>
    `
    wildflower.component('nano-hello', { state: { message: 'hello from nano' } })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(testContainer.querySelector('#nano-msg').textContent).toBe('hello from nano')
    expect(consoleErrors).toEqual([])
  })

  it('reacts to state changes (data-bind updates)', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-counter">
        <span id="nano-count" data-bind="count"></span>
        <button id="nano-inc" data-action="increment"></button>
      </div>
    `
    wildflower.component('nano-counter', {
      state: { count: 0 },
      increment() { this.count++ }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(testContainer.querySelector('#nano-count').textContent).toBe('0')
    testContainer.querySelector('#nano-inc').click()
    await waitForCompleteRender()
    expect(testContainer.querySelector('#nano-count').textContent).toBe('1')
    expect(consoleErrors).toEqual([])
  })

  it('supports data-show (conditional visibility)', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-show">
        <span id="nano-vis" data-show="visible">peekaboo</span>
        <button id="nano-toggle" data-action="toggle"></button>
      </div>
    `
    wildflower.component('nano-show', {
      state: { visible: true },
      toggle() { this.visible = !this.visible }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const el = testContainer.querySelector('#nano-vis')
    expect(el.style.display).not.toBe('none')
    testContainer.querySelector('#nano-toggle').click()
    await waitForCompleteRender()
    expect(el.style.display).toBe('none')
    expect(consoleErrors).toEqual([])
  })

  it('supports data-render (conditional insert/remove)', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-render">
        <span id="nano-cond" data-render="shown">conditional</span>
        <button id="nano-r-toggle" data-action="flip"></button>
      </div>
    `
    wildflower.component('nano-render', {
      state: { shown: false },
      flip() { this.shown = !this.shown }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    // Initially false → element removed from DOM
    expect(testContainer.querySelector('#nano-cond')).toBeNull()
    testContainer.querySelector('#nano-r-toggle').click()
    await waitForCompleteRender()
    expect(testContainer.querySelector('#nano-cond')).not.toBeNull()
    expect(consoleErrors).toEqual([])
  })

  it('supports data-model two-way binding write-back', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-model">
        <input id="nano-input" data-model="name" />
        <span id="nano-echo" data-bind="name"></span>
      </div>
    `
    wildflower.component('nano-model', { state: { name: '' } })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const input = testContainer.querySelector('#nano-input')
    input.value = 'typed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await waitForCompleteRender()

    const inst = wildflower.componentInstances.get(
      testContainer.querySelector('[data-component="nano-model"]').dataset.componentId
    )
    expect(inst.state.name).toBe('typed')
    expect(testContainer.querySelector('#nano-echo').textContent).toBe('typed')
    expect(consoleErrors).toEqual([])
  })

  it('evaluates computed properties', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-computed">
        <span id="nano-full" data-bind="fullName"></span>
      </div>
    `
    wildflower.component('nano-computed', {
      state: { first: 'Ada', last: 'Lovelace' },
      computed: { fullName() { return `${this.first} ${this.last}` } }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(testContainer.querySelector('#nano-full').textContent).toBe('Ada Lovelace')
    expect(consoleErrors).toEqual([])
  })

  it('supports external() cross-component binding', async () => {
    wildflower.component('nano-publisher', { state: { message: 'shared value' } })
    wildflower.component('nano-subscriber', { state: {} })
    testContainer.innerHTML = `
      <div data-component="nano-publisher"></div>
      <div data-component="nano-subscriber">
        <span id="nano-ext" data-bind="external('nano-publisher', 'message')"></span>
      </div>
    `
    if (wildflower.scan) wildflower.scan()
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()
    await new Promise(r => setTimeout(r, 100))

    expect(testContainer.querySelector('#nano-ext').textContent).toBe('shared value')
    expect(consoleErrors).toEqual([])
  })

  it('applies string data-bind-style (warns in dev, does not crash)', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-style">
        <span id="nano-styled" data-bind-style="styleStr">styled</span>
      </div>
    `
    wildflower.component('nano-style', { state: { styleStr: 'color: rgb(1, 2, 3)' } })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    // String form is applied as cssText for back-compat; the shape warning uses
    // console.warn (not console.error), so this must not have thrown/errored.
    const el = testContainer.querySelector('#nano-styled')
    expect(el).not.toBeNull()
    expect(consoleErrors).toEqual([])
  })

  it('handles form submission with data-action', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-form">
        <form id="nano-frm" data-action="submit:handleSubmit" data-event-prevent>
          <input data-model="query" />
        </form>
        <span id="nano-submitted" data-bind="submitted"></span>
      </div>
    `
    wildflower.component('nano-form', {
      state: { query: '', submitted: 'no' },
      handleSubmit() { this.submitted = 'yes' }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    testContainer.querySelector('#nano-frm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await waitForCompleteRender()
    expect(testContainer.querySelector('#nano-submitted').textContent).toBe('yes')
    expect(consoleErrors).toEqual([])
  })

  it('does not crash when a stray data-list is present (list-free tier)', async () => {
    testContainer.innerHTML = `
      <div data-component="nano-straylist">
        <span id="nano-ok" data-bind="ok"></span>
        <ul data-list="items"><template><li data-bind="name"></li></template></ul>
      </div>
    `
    wildflower.component('nano-straylist', {
      state: { ok: 'still works', items: [{ id: 1, name: 'a' }] }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    // The non-list binding still works; the list simply does not render (no crash).
    expect(testContainer.querySelector('#nano-ok').textContent).toBe('still works')
    expect(consoleErrors).toEqual([])
  })
})
