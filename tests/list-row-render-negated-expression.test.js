/**
 * A list row's data-render whose expression starts with "!" but is more than
 * a negated path: "!done && open", "!!done". The row took the leading "!" as
 * a negation of everything after it, on its first render and on every update,
 * so it evaluated !(done && open), or !done for "!!done": the element stayed
 * rendered when open went false, rendered at first with done true and open
 * false, and "!!done" rendered while done was false. A data-show with the
 * same expression, and a data-render outside a list, were right.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe.skipIf(!hasFeature('lists'))('a list row data-render that starts with "!" and is an expression', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    const count = (sel) => container.querySelectorAll(sel).length
    // Mounts a two-row list whose row holds `tpl`, then applies each write to
    // the component and records read() after the first render and each write.
    const run = async (tpl, state, writes, read) => {
        const c = `lrne-${++seq}`
        wildflower.component(c, { state: { items: [{ id: 1 }, { id: 2 }], ...state } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li>${tpl}</li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const seen = [read()]
        for (const w of writes) {
            Object.assign(wildflower.getComponent(c), w)
            await settle()
            seen.push(read())
        }
        return seen
    }

    it('"!done && open" follows open', async () => {
        const seen = await run('<b class="q" data-render="!done && open">Q</b>',
            { done: false, open: true }, [{ open: false }, { open: true }, { done: true }],
            () => count('.q'))
        expect(seen).toEqual([2, 0, 2, 0])
    })

    it('"!done && open" with done true and open false: nothing from the first render on', async () => {
        const seen = await run('<b class="q" data-render="!done && open">Q</b>',
            { done: true, open: false }, [{ open: true }, { done: false }],
            () => count('.q'))
        expect(seen).toEqual([0, 0, 2])
    })

    it('"done && open" beside "!done && open"', async () => {
        const seen = await run('<b class="p" data-render="done && open">P</b><b class="q" data-render="!done && open">Q</b>',
            { done: false, open: true }, [{ done: true }, { done: false }, { open: false }],
            () => count('.p') + '/' + count('.q'))
        expect(seen).toEqual(['0/2', '2/0', '0/2', '0/0'])
    })

    it('"!!done" beside "done"', async () => {
        const seen = await run('<b class="p" data-render="done">P</b><b class="q" data-render="!!done">Q</b>',
            { done: false }, [{ done: true }, { done: false }],
            () => count('.p') + '/' + count('.q'))
        expect(seen).toEqual(['0/0', '2/2', '0/0'])
    })

    it('"!done" alone still negates (control)', async () => {
        const seen = await run('<b class="q" data-render="!done">Q</b>',
            { done: false }, [{ done: true }, { done: false }],
            () => count('.q'))
        expect(seen).toEqual([2, 0, 2])
    })

    // The same expression everywhere else a condition is written: one rule.
    const shown = (sel) => [...container.querySelectorAll(sel)].filter(el => el.style.display !== 'none').length

    it('on item fields: "!done && open" renders the rows it is true for', async () => {
        const c = `lrne-${++seq}`
        wildflower.component(c, { state: { items: [{ id: 1, done: false, open: true }, { id: 2, done: true, open: true }, { id: 3, done: false, open: false }] } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li><i class="s" data-show="!done && open">S</i><b class="q" data-render="!done && open">Q</b></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const rows = () => [...container.querySelectorAll('li')].map(li => (li.querySelector('.q') ? 'q' : '-') + (li.querySelector('.s').style.display !== 'none' ? 's' : '-'))
        expect(rows()).toEqual(['qs', '--', '--'])
        const items = wildflower.getComponent(c).items
        items[0].open = false; items[1].done = false; items[2].open = true
        await settle()
        expect(rows()).toEqual(['--', 'qs', 'qs'])
    })

    it('on the row itself', async () => {
        const c = `lrne-${++seq}`
        wildflower.component(c, { state: { done: true, open: false, items: [{ id: 1 }, { id: 2 }] } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li class="q" data-render="!done && open">Q</li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const seen = [count('.q')]
        const ctx = wildflower.getComponent(c)
        ctx.open = true; await settle(); seen.push(count('.q'))
        ctx.done = false; await settle(); seen.push(count('.q'))
        ctx.open = false; await settle(); seen.push(count('.q'))
        expect(seen).toEqual([0, 0, 2, 0])
    })

    it('data-show in a row, and data-render and data-show outside a list (controls)', async () => {
        const c = `lrne-${++seq}`
        wildflower.component(c, { state: { done: true, open: false, items: [{ id: 1 }, { id: 2 }] } })
        container.innerHTML = `<div data-component="${c}"><b class="cr" data-render="!done && open">R</b><b class="cs" data-show="!done && open">S</b>` +
            `<ul data-list="items" data-key="id"><template><li><i class="rs" data-show="!done && open">S</i></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const read = () => count('.cr') + '/' + shown('.cs') + '/' + shown('.rs')
        const seen = [read()]
        const ctx = wildflower.getComponent(c)
        ctx.open = true; await settle(); seen.push(read())
        ctx.done = false; await settle(); seen.push(read())
        ctx.open = false; await settle(); seen.push(read())
        expect(seen).toEqual(['0/0/0', '0/0/0', '1/1/2', '0/0/0'])
    })

    it.skipIf(!hasFeature('pools'))('data-show on a pool entity', async () => {
        const c = `lrne-${++seq}`
        wildflower.component(c, {
            state: {}, pools: { dots: {} },
            init() { this.pools.dots.add({ id: 1, done: true, open: false }); this.pools.dots.add({ id: 2, done: false, open: true }) },
        })
        container.innerHTML = `<div data-component="${c}"><div data-pool="dots" data-key="id"><template><i class="d" data-show="!done && open">d</i></template></div></div>`
        wildflower.scan(container)
        await settle()
        expect(shown('.d')).toBe(1)
        wildflower.getComponent(c).pools.dots.update(1, { open: true }); await settle()
        expect(shown('.d')).toBe(1)
        wildflower.getComponent(c).pools.dots.update(1, { done: false }); await settle()
        expect(shown('.d')).toBe(2)
    })
})
