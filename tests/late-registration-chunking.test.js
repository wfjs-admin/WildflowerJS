/**
 * Late registration: synchronous under a floor, chunked above a time budget.
 *
 * wildflower.component() called after the framework has initialized walks
 * every matching element in one synchronous loop. Measured 2026-09-18 under
 * 4x CPU throttle: about 8 ms fixed plus 0.06-0.12 ms per component, so the
 * call crosses the 20 ms sprint budget near 100-200 components and becomes a
 * long task (50 ms+) near 300-600. The page-load scan does the same work in
 * 8 ms chunks and stays flat. Every component registered after load — from a
 * lazily loaded script, a script at the end of <body>, or added dynamically —
 * took the synchronous path.
 *
 * Contract pinned here:
 *   - registrations of up to LATE_INIT_SYNC_FLOOR elements are fully
 *     synchronous (the entire existing suite registers late and below it);
 *   - above the floor, work continues synchronously until the time budget is
 *     spent, then the remainder is initialized in yielding chunks;
 *   - wildflower.whenIdle() resolves once no chunked work is pending, and a
 *     `wildflower:idle` event is dispatched on document at the same moment;
 *   - component() still returns the framework (chainable), unchanged;
 *   - development builds warn (WF-515) once per registration that crossed
 *     into the chunked path, naming the count and the remedy.
 *
 * The large case forces the budget to be exceeded with a wall-clock busy-wait
 * in beforeInit(), which runs synchronously inside the per-element step, so
 * the assertion does not depend on how fast the machine is. (init() would not
 * do: the late path defers it to a later task, the same TBT measure the
 * page-load scan takes.)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

let seq = 0
const uname = () => `late-chunk-${++seq}`

function fill(container, name, count, bindings = 1) {
    let inner = ''
    for (let b = 0; b < bindings; b++) inner += `<span data-bind="v${b}"></span>`
    let html = ''
    for (let i = 0; i < count; i++) html += `<div data-component="${name}">${inner}</div>`
    container.innerHTML = html
}

const initializedCount = (name) =>
    document.querySelectorAll(`[data-component="${name}"][data-component-id]`).length

// Wall-clock spin so each init() costs a known minimum regardless of CPU.
function spin(ms) {
    const end = performance.now() + ms
    while (performance.now() < end) { /* burn */ }
}

async function withTimeout(promise, ms, label) {
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle in ${ms}ms`)), ms) })
    try { return await Promise.race([promise, timeout]) } finally { clearTimeout(timer) }
}

describe('late registration: sync floor, time ceiling, whenIdle()', () => {
    let wildflower
    let container

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('component() still returns the framework instance', () => {
        const name = uname()
        fill(container, name, 1)
        expect(wildflower.component(name, { state: { v0: 1 } })).toBe(wildflower)
    })

    it('a registration at the floor is fully synchronous', () => {
        const name = uname()
        fill(container, name, 64, 10)
        wildflower.component(name, { state: { v0: 0, v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8, v9: 9 } })
        // No await, no settle: every element is initialized when the call returns.
        expect(initializedCount(name)).toBe(64)
    })

    it('whenIdle() resolves immediately when nothing is pending', async () => {
        await withTimeout(wildflower.whenIdle(), 500, 'whenIdle() with no pending work')
    })

    it('a large registration returns early, finishes in chunks, and signals idle once', async () => {
        const name = uname()
        const total = 600
        fill(container, name, total)

        let idleEvents = 0
        const onIdle = () => { idleEvents++ }
        document.addEventListener('wildflower:idle', onIdle)

        const t0 = performance.now()
        // 600 x 0.25 ms = 150 ms of forced work against a 20 ms budget: the
        // call cannot finish synchronously on any machine.
        wildflower.component(name, {
            state: { v0: 1 },
            beforeInit() { spin(0.25) }
        })
        const callMs = performance.now() - t0
        const doneAtReturn = initializedCount(name)

        expect(doneAtReturn, 'the call initialized everything synchronously; it did not yield').toBeLessThan(total)
        expect(doneAtReturn, 'nothing was initialized synchronously; the floor is not honoured').toBeGreaterThan(0)
        // Generous bound: budget plus one chunk plus the fixed cost, well under the 150 ms of total work.
        expect(callMs, `component() blocked for ${callMs.toFixed(1)} ms`).toBeLessThan(100)

        await withTimeout(wildflower.whenIdle(), 5000, 'whenIdle() after a chunked registration')
        expect(initializedCount(name)).toBe(total)
        expect(wildflower.getComponent(name)).toBeTruthy()

        // The event fires when the pending count returns to zero, once.
        await new Promise(r => setTimeout(r, 20))
        expect(idleEvents).toBe(1)
        document.removeEventListener('wildflower:idle', onIdle)
    })

    it.skipIf(isMinifiedBuild())('development builds warn once (WF-515) when a registration crosses into chunks', async () => {
        const name = uname()
        fill(container, name, 600)
        const warnings = []
        const realWarn = console.warn
        console.warn = (...args) => { warnings.push(args.join(' ')) }
        try {
            wildflower.component(name, { state: { v0: 1 }, beforeInit() { spin(0.25) } })
            await withTimeout(wildflower.whenIdle(), 5000, 'whenIdle()')
        } finally {
            console.warn = realWarn
        }
        // One wfError() emission is several console.warn lines (message,
        // suggestion, docs URL — and the URL repeats the code), so count the
        // header line only: exactly one warning for the whole registration.
        const headers = warnings.filter(w => w.startsWith('[WF WF-515]'))
        expect(headers.length).toBe(1)
        expect(headers[0]).toContain(name)
        expect(warnings.some(w => w.includes('whenIdle'))).toBe(true)
    })

    it.skipIf(isMinifiedBuild())('does not warn for a registration that stayed synchronous', async () => {
        const name = uname()
        fill(container, name, 64)
        const warnings = []
        const realWarn = console.warn
        console.warn = (...args) => { warnings.push(args.join(' ')) }
        try {
            wildflower.component(name, { state: { v0: 1 } })
            await new Promise(r => setTimeout(r, 20))
        } finally {
            console.warn = realWarn
        }
        expect(warnings.some(w => w.includes('WF-515'))).toBe(false)
    })

    // Last in the file: it calls destroy() on the shared instance.
    it('destroy() stops a chunked registration that is still running', async () => {
        const name = uname()
        const total = 600
        fill(container, name, total)
        let inits = 0
        wildflower.component(name, { state: { v0: 1 }, beforeInit() { spin(0.25); inits++ } })
        const atDestroy = inits
        expect(atDestroy, 'nothing was left to chunk; the case under test did not arise').toBeLessThan(total)

        wildflower.destroy()
        await withTimeout(wildflower.whenIdle(), 5000, 'whenIdle() after destroy()')
        await new Promise(r => setTimeout(r, 50))

        expect(inits, 'components kept initializing on a destroyed framework').toBe(atDestroy)
    })
})
