/**
 * Calling a component METHOD from anything that evaluates during the first
 * render returns undefined.
 *
 * Root cause (ComponentLifecycle.js `_wrapMethod`): the wrapper queues a call
 * and returns undefined while `!instance._initReady`, so that user actions
 * fired before init() replay afterwards instead of being lost. Everything the
 * framework evaluates to produce the FIRST paint runs before that flag is
 * set, so a method call from any of those paths silently yields undefined,
 * the caller computes a wrong result, and the result is cached. The queued
 * call then replays for real, which makes the method look innocent under
 * instrumentation.
 *
 * Repro with the full diagnosis: test-cases/computed-delegating-to-method.html
 *
 * The vectors below are the distinct evaluation paths that can reach a method
 * during first paint. The CONTROL tests pin the behavior that must survive
 * any fix: lifecycle hooks and post-init calls already work, and genuine
 * actions fired before init must still queue and replay (that half is also
 * covered by async-lifecycle.test.js and code-review-2026-04-28).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-${++seq}`

async function settle(ms = 80) {
    await new Promise((r) => setTimeout(r, ms))
}

describe('a method called during first render', () => {
    let container
    let wildflower

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

    // ---- V1: the baseline, a component computed delegating to a method ----
    it('V1 component computed: delegating to a method yields the right value', async () => {
        const c = uname('v1')
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }], limit: 5 },
            computed: {
                inline() {
                    const limit = this.limit
                    return this.rows.filter((r) => r.n > limit).length
                },
                delegated() {
                    const self = this
                    return this.rows.filter((r) => self.isOver(r)).length
                }
            },
            isOver(item) { return !!item && item.n > this.limit }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <span id="inline" data-bind="inline"></span>
                <span id="deleg" data-bind="delegated"></span>
            </div>
        `
        await settle()

        expect(container.querySelector('#inline').textContent, 'control: inline predicate').toBe('1')
        expect(container.querySelector('#deleg').textContent, 'same logic behind a method').toBe('1')
    })

    // ---- V2: an item-level computed, evaluated once per row ----
    it('V2 item-level computed: delegating to a method yields the right class', async () => {
        const c = uname('v2')
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }], limit: 5 },
            computed: {
                rowClass(item) { return this.isOver(item) ? 'over' : 'under' }
            },
            isOver(item) { return !!item && item.n > this.limit }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="rows" data-key="id">
                    <template><li data-bind-class="rowClass" data-bind="n"></li></template>
                </ul>
            </div>
        `
        await settle()

        const classes = Array.from(container.querySelectorAll('li')).map((el) => el.className)
        expect(classes, 'each row asks the method about itself').toEqual(['under', 'over'])
    })

    // ---- V3: data-show, where a wrong answer hides content ----
    it('V3 data-show: a computed delegating to a method controls visibility', async () => {
        const c = uname('v3')
        wildflower.component(c, {
            state: { count: 9, limit: 5 },
            computed: {
                visible() { return this.isOver(this.count) }
            },
            isOver(n) { return n > this.limit }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <p id="shown" data-show="visible">over the limit</p>
            </div>
        `
        await settle()

        const el = container.querySelector('#shown')
        expect(el, 'the element exists').toBeTruthy()
        expect(el.style.display, 'a true condition must not hide it').not.toBe('none')
    })

    // ---- V4: data-render, where a wrong answer removes the element ----
    it('V4 data-render: a computed delegating to a method controls presence', async () => {
        const c = uname('v4')
        wildflower.component(c, {
            state: { count: 9, limit: 5 },
            computed: {
                present() { return this.isOver(this.count) }
            },
            isOver(n) { return n > this.limit }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <p id="rendered" data-render="present">over the limit</p>
            </div>
        `
        await settle()

        expect(container.querySelector('#rendered'), 'a true condition must keep the element').toBeTruthy()
    })

    // ---- V5: data-list itself, where a wrong answer empties the list ----
    it('V5 data-list: a computed delegating to a method supplies the rows', async () => {
        const c = uname('v5')
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }], limit: 5 },
            computed: {
                visibleRows() {
                    const self = this
                    return this.rows.filter((r) => self.isOver(r))
                }
            },
            isOver(item) { return !!item && item.n > this.limit }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="visibleRows" data-key="id">
                    <template><li data-bind="n"></li></template>
                </ul>
            </div>
        `
        await settle()

        const rows = Array.from(container.querySelectorAll('li')).map((el) => el.textContent)
        expect(rows, 'one row is over the limit').toEqual(['9'])
    })

    // ---- CONTROLS: behavior that already works and must keep working ----

    it('V6 cross-instance: another component\'s computed cannot bypass MY pre-init queue', async () => {
        // Review finding: COMPUTED_EVAL was one global depth counter, so while
        // ANY computed evaluated, EVERY component's pre-init queue was
        // lifted — a computed on A reaching a method on not-yet-initialized
        // B ran the method early (side effects fired before B's init-set
        // state existed) instead of queueing it for replay. The bypass is
        // owed only to the instance whose computed is evaluating.
        // The pre-init window is the gap between the SYNCHRONOUS mount step
        // (methods bound) and the deferred init() — the same window every
        // vector above exploits. Probe inside it synchronously.
        const bName = uname('xq-b'); const aName = uname('xq-a')
        const log = []
        wildflower.component(bName, {
            state: { n: 5 },
            bump() { log.push('bump'); return this.n }
        })
        wildflower.component(aName, {
            state: {},
            computed: {
                // Reach B the way real cross-instance code does: through the
                // registry instance, whose methods carry the pre-init queue.
                probe() {
                    const el = document.querySelector(`[data-component="${bName}"]`)
                    const inst = el && el.dataset.componentId
                        && wildflower.componentInstances.get(el.dataset.componentId)
                    return inst ? inst.bump() : 'no-b'
                }
            }
        })
        container.innerHTML = `
            <div data-component="${bName}"><span data-bind="n"></span></div>
            <div data-component="${aName}"><span data-bind="probe"></span></div>
        `
        wildflower.scan(container)
        // SAME task as the mount: no component's deferred init has run yet.
        const earlyRuns = log.length
        expect(earlyRuns, 'B pre-init: the cross-instance call queues instead of running early').toBe(0)

        await settle()
        expect(log.length, 'the queued call replayed after B\'s init').toBeGreaterThan(0)
    })

    it('CONTROL init(): a method called from a lifecycle hook returns its value', async () => {
        const c = uname('c1')
        let seenInInit = null
        wildflower.component(c, {
            state: { limit: 5 },
            init() { seenInInit = this.isOver(9) },
            isOver(n) { return n > this.limit }
        })
        container.innerHTML = `<div data-component="${c}"></div>`
        await settle()

        expect(seenInInit, 'lifecycle hooks bypass the pre-init queue').toBe(true)
    })

    it('CONTROL action: a method called from a handler after init returns its value', async () => {
        const c = uname('c2')
        let seenInAction = null
        wildflower.component(c, {
            state: { limit: 5 },
            run() { seenInAction = this.isOver(9) },
            isOver(n) { return n > this.limit }
        })
        container.innerHTML = `<div data-component="${c}"><button id="go" data-action="run">go</button></div>`
        await settle()
        container.querySelector('#go').click()
        await settle()

        expect(seenInAction, 'post-init calls take the immediate branch').toBe(true)
    })

    it('CONTROL nested: a method calling another method returns its value', async () => {
        const c = uname('c3')
        let outerSaw = null
        wildflower.component(c, {
            state: { limit: 5 },
            outer() { outerSaw = this.isOver(9); return outerSaw },
            isOver(n) { return n > this.limit }
        })
        container.innerHTML = `<div data-component="${c}"><button id="go" data-action="outer">go</button></div>`
        await settle()
        container.querySelector('#go').click()
        await settle()

        expect(outerSaw, 're-entrant calls already bypass the queue').toBe(true)
    })

    it('CONTROL post-init computed: recomputing later gets the real value', async () => {
        const c = uname('c4')
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }], limit: 5 },
            computed: {
                delegated() {
                    const self = this
                    return this.rows.filter((r) => self.isOver(r)).length
                }
            },
            isOver(item) { return !!item && item.n > this.limit }
        })
        container.innerHTML = `<div data-component="${c}"><span id="d" data-bind="delegated"></span></div>`
        await settle()

        // Touch the dependency so the computed re-evaluates well after init.
        const el = container.querySelector(`[data-component="${c}"]`)
        const inst = wildflower.getComponentInstance(el.dataset.componentId)
        inst.context.rows = [{ id: 1, n: 1 }, { id: 2, n: 9 }]
        await settle()

        expect(container.querySelector('#d').textContent, 'a later evaluation is correct either way').toBe('1')
    })
})
