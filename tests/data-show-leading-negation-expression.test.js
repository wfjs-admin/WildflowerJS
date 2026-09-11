/**
 * A leading ! on a COMPOUND data-show/data-render expression must negate only
 * its own term, not the whole expression.
 *
 * The bug: every conditional parse site treated a leading "!" as a
 * whole-expression negate flag and stripped it, so
 *   data-show="!$st.loading && $st.count === 0"
 * was evaluated as NOT($st.loading && $st.count === 0) — a De Morgan flip
 * that is true in almost every state, which read as "the element never
 * hides" (found on the Conduit home feed's empty-state messages; memory
 * project_data_show_compound_expression_reactivity_gap). Reactivity was
 * never the problem: the wrong expression re-evaluated faithfully.
 *
 * The negate-flag shortcut is now applied only when the remainder is a
 * single simple term ("!isActive", "!$st.loading"); compound expressions
 * keep the ! in the expression text for the evaluator.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-negpin-${++seq}`

async function settle(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-show / data-render — leading ! on compound expressions', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    const visible = (sel) => {
        const el = container.querySelector(sel)
        return !!el && getComputedStyle(el).display !== 'none'
    }

    it('component data-show: "!$store.a && $store.b === 0" negates only its own term', async () => {
        const st = uname('st'); const c = uname('c')
        wildflower.store(st, { state: { loading: false, count: 0 } })
        container.innerHTML = `
            <div data-component="${c}">
                <p class="empty" data-show="!$${st}.loading && $${st}.count === 0">empty</p>
            </div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        // not loading, zero rows: message shows
        expect(visible('.empty')).toBe(true)

        // rows arrive: message must hide (the De Morgan flip kept it visible)
        wildflower.getStore(st).count = 4
        await settle()
        expect(visible('.empty')).toBe(false)

        // back to zero but loading: still hidden (!loading fails)
        wildflower.getStore(st).count = 0
        wildflower.getStore(st).loading = true
        await settle()
        expect(visible('.empty')).toBe(false)

        // loading finishes with zero rows: shows again
        wildflower.getStore(st).loading = false
        await settle()
        expect(visible('.empty')).toBe(true)
    })

    it('component data-show: simple "!flag" still negates via the flag path', async () => {
        const c = uname('c')
        let ctx
        container.innerHTML = `
            <div data-component="${c}">
                <p class="off" data-show="!active">off</p>
            </div>`
        wildflower.component(c, { state: { active: false }, init() { ctx = this } })
        wildflower.scan(container)
        await settle()

        expect(visible('.off')).toBe(true)
        ctx.active = true
        await settle()
        expect(visible('.off')).toBe(false)
    })

    it('list-item data-show: "!done && qty > 1" negates only its own term', async () => {
        const c = uname('c')
        let ctx
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="items">
                    <template>
                        <li><span class="nm" data-bind="name"></span><em class="flag" data-show="!done && qty > 1">multi</em></li>
                    </template>
                </ul>
            </div>`
        wildflower.component(c, {
            state: { items: [{ id: 1, name: 'a', done: false, qty: 3 }] },
            init() { ctx = this }
        })
        wildflower.scan(container)
        await settle()

        // not done, qty 3: flag shows
        expect(visible('.flag')).toBe(true)

        // done: flag must hide (De Morgan flip kept NOT(done && qty>1) true)
        ctx.items[0].done = true
        await settle()
        expect(visible('.flag')).toBe(false)

        // undone but qty 1: still hidden
        ctx.items[0].done = false
        ctx.items[0].qty = 1
        await settle()
        expect(visible('.flag')).toBe(false)
    })

    it('data-render: "!hidden && ready" negates only its own term', async () => {
        const c = uname('c')
        let ctx
        container.innerHTML = `
            <div data-component="${c}">
                <p class="panel" data-render="!hidden && ready">panel</p>
            </div>`
        wildflower.component(c, { state: { hidden: false, ready: true }, init() { ctx = this } })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.panel')).not.toBeNull()

        // hidden: panel must leave the DOM (flip evaluated NOT(hidden && ready)
        // = true whenever either is false, keeping it rendered)
        ctx.hidden = true
        await settle()
        expect(container.querySelector('.panel')).toBeNull()

        ctx.hidden = false
        ctx.ready = false
        await settle()
        expect(container.querySelector('.panel')).toBeNull()
    })
})
