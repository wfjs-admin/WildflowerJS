/**
 * Item-level computeds, two behaviors that surprised a demo author.
 *
 * Written to check two claims made from observing a demo rather than from
 * source, because a confident claim from a muddled observation is how wrong
 * documentation gets written:
 *
 *   1. An item-level computed cannot be called by another computed as an
 *      ordinary function, so a shared predicate has to be duplicated.
 *   2. An item-level computed that reads an EXTERNAL store is not
 *      re-evaluated when only that store changes, even with a subscribe.
 *
 * Both would be intuition traps if true: a row-level computed looks like a
 * function of the row, and reading a store inside one looks like it should
 * track that store the way every other computed does.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-${++seq}`

async function settle(ms = 60) {
    await new Promise((r) => setTimeout(r, ms))
}

describe('item-level computeds and outside state', () => {
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

    it('re-evaluates when an external store it reads changes', async () => {
        const s = uname('flags'); const c = uname('rowc')
        wildflower.store(s, { state: { threshold: 5 } })
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }] },
            subscribe: { [s]: ['threshold'] },
            computed: {
                rowClass(item) {
                    return item.n > wildflower.getStore(s).threshold ? 'hot' : 'cold'
                }
            }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="rows" data-key="id">
                    <template><li data-bind-class="rowClass" data-bind="n"></li></template>
                </ul>
            </div>
        `
        await settle()
        const classes = () => Array.from(container.querySelectorAll('li')).map((el) => el.className)
        expect(classes(), 'initial evaluation uses the store value').toEqual(['cold', 'hot'])

        // Nothing about the ROWS changed. Only the store the computed reads.
        wildflower.getStore(s).threshold = 0
        await settle()

        expect(classes(), 'a row-level computed must follow the store it reads').toEqual(['hot', 'hot'])
    })

    it('re-evaluates when the external store changes with no subscribe declared', async () => {
        const s = uname('flags2'); const c = uname('rowc2')
        wildflower.store(s, { state: { threshold: 5 } })
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }] },
            computed: {
                rowClass(item) {
                    return item.n > wildflower.getStore(s).threshold ? 'hot' : 'cold'
                }
            }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="rows" data-key="id">
                    <template><li data-bind-class="rowClass" data-bind="n"></li></template>
                </ul>
            </div>
        `
        await settle()
        const classes = () => Array.from(container.querySelectorAll('li')).map((el) => el.className)
        expect(classes()).toEqual(['cold', 'hot'])

        wildflower.getStore(s).threshold = 0
        await settle()

        // Reads inside computeds are supposed to track automatically, so the
        // absence of a subscribe should not matter.
        expect(classes(), 'tracking should not require an explicit subscribe').toEqual(['hot', 'hot'])
    })

    it('CANNOT be reached from another computed as a plain function', async () => {
        const c = uname('callc')
        let callError = null
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }] },
            computed: {
                isBig(item) { return !!item && item.n > 5 },
                bigCount() {
                    try {
                        const self = this
                        return this.rows.filter((r) => self.isBig(r)).length
                    } catch (e) {
                        callError = String(e)
                        return -1
                    }
                }
            }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <span id="cnt" data-bind="bigCount"></span>
                <ul data-list="rows" data-key="id">
                    <template><li data-bind-class="isBig"></li></template>
                </ul>
            </div>
        `
        await settle()

        // Documented behavior, not a wish: computeds are exposed on the
        // context as VALUES, so `this.isBig` is whatever the computed
        // evaluates to with no row, and calling it is a TypeError. A
        // predicate shared between a row binding and a summary count has to
        // live somewhere both can reach, which is the next test.
        expect(callError, 'reaching an item-level computed as a function throws').toMatch(/not a function/)
    })

    it('DIAGNOSTIC: what a computed can see on `this`', async () => {
        const c = uname('diag')
        const probe = {}
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }], limit: 5 },
            computed: {
                report() {
                    probe.thisType = typeof this
                    probe.hasRows = Array.isArray(this && this.rows)
                    probe.rowsLen = this && this.rows ? this.rows.length : -1
                    probe.limit = this && this.limit
                    probe.methodType = typeof (this && this.helper)
                    probe.keys = this ? Object.keys(this).slice(0, 12) : []
                    return 'ok'
                }
            },
            helper(item) { return !!item }
        })
        container.innerHTML = `<div data-component="${c}"><span id="r" data-bind="report"></span></div>`
        await settle()

        // Recorded, not asserted: this test exists to answer the question,
        // and the answer is what the next two tests are written against.
        expect(container.querySelector('#r').textContent, 'the computed evaluated').toBe('ok')
        expect(probe.thisType, 'a computed has a receiver').toBe('object')
        expect(probe.hasRows, 'component state is reachable on it').toBe(true)
        expect(probe.rowsLen, 'and the rows are the declared ones').toBe(2)
        expect(probe.limit, 'as are scalars').toBe(5)
        expect(probe.methodType, 'METHODS are what may or may not be there').toBe('function')
    })

    // Was a characterization of the bug; now pins the fix. A computed that
    // delegates to a method used to receive undefined, because _wrapMethod
    // queued the call while the component was not yet init-ready. Full
    // vector coverage lives in computed-method-delegation.test.js.
    it('delegating to a method from a computed returns the real value', async () => {
        const c = uname('shared')
        const seen = []
        wildflower.component(c, {
            state: { rows: [{ id: 1, n: 1 }, { id: 2, n: 9 }], limit: 5 },
            computed: {
                selfless() {
                    const self = this
                    return this.rows.filter(function (r) { return self.overFixed(r) }).length
                },
                viaThis() {
                    const self = this
                    return this.rows.filter(function (r) { return self.overState(r) }).length
                }
            },
            overFixed(item) { return !!item && item.n > 5 },
            overState(item) {
                seen.push({
                    itemType: typeof item,
                    n: item ? item.n : '(no item)',
                    thisLimit: this ? this.limit : '(no this)',
                    thisType: typeof this
                })
                return !!item && item.n > this.limit
            }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <span id="a" data-bind="selfless"></span>
                <span id="b" data-bind="viaThis"></span>
            </div>
        `
        await settle()

        // Two rows, one of which has n = 9, so both counts should read 1.
        // Both read 0, and nothing throws. That is the shape worth knowing
        // about: a wrong number, silently.
        expect(seen.length, 'the method ran once per row').toBe(2)
        expect(seen[1].n, 'with the right row').toBe(9)
        expect(seen[1].thisLimit, 'and the right receiver').toBe(5)

        // And now the caller receives what the method returned, so both
        // spellings agree. Before the fix these read 0.
        expect(container.querySelector('#a').textContent).toBe('1')
        expect(container.querySelector('#b').textContent).toBe('1')
    })
})
