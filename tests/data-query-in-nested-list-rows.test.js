/**
 * A data-query element inside the rows of nested lists.
 *
 * A data-query in a list row is rewritten in the row's template, since the
 * rows are cloned from it. With lists inside lists, each level's template
 * is a template inside the one above, and the element has to be rewritten
 * at whatever level it sits: one list deep, two, or three. Either shape of
 * the element is covered, a list (it has a <template>) and a record (it has
 * none), with the query declared before the component scans or after.
 *
 * The rows here are rendered in the page from the component's state.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('lists') && hasFeature('query') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIf('data-query inside the rows of nested lists', () => {
    let wildflower
    let container
    let realFetch
    let fetches
    const FETCHED = [{ id: 1, sku: 'A1' }, { id: 3, sku: 'C3' }]
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        realFetch = window.fetch
        fetches = 0
        window.fetch = () => {
            fetches++
            return new Promise(r => setTimeout(() => r(new Response(JSON.stringify(FETCHED), { status: 200 })), 30))
        }
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    // `depth` lists, one inside the rows of the next: l1 on the component,
    // l2 in each l1 row, l3 in each l2 row. The query element sits in the
    // rows of the innermost.
    const nest = (depth, inner) => {
        let html = inner
        for (let lv = depth; lv >= 1; lv--) {
            html = `<div class="lv${lv}" data-list="l${lv}"><template><section><b data-bind="n"></b>${html}</section></template></div>`
        }
        return html
    }
    const state = (depth) => {
        let rows = [{ n: 'row' }]
        for (let lv = depth; lv > 1; lv--) rows = [{ n: 'row', ['l' + lv]: rows }]
        return { l1: rows }
    }
    // The innermost list's array, to add a row to.
    const innermost = (ctx, depth) => {
        let rows = ctx.l1
        for (let lv = 2; lv <= depth; lv++) rows = rows[0]['l' + lv]
        return rows
    }
    const SHAPES = {
        list: {
            el: (q) => `<ul class="inner" data-query="${q}"><template><li data-bind="sku"></li></template></ul>`,
            shown: (el) => [...el.children].filter(c => c.tagName !== 'TEMPLATE').map(c => c.textContent),
            want: ['A1', 'C3'],
        },
        record: {
            el: (q) => `<p class="inner" data-query="${q}"><span data-bind="sku"></span></p>`,
            shown: (el) => [el.textContent],
            want: ['A1'],
        },
    }
    const shownAll = (shape) => [...container.querySelectorAll('.inner')].map(SHAPES[shape].shown)

    for (const depth of [1, 2, 3]) for (const shape of ['list', 'record']) for (const declared of ['before the scan', 'after the scan']) {
        it(`a ${shape}, ${depth} ${depth === 1 ? 'list' : 'lists'} deep, the query declared ${declared}`, async () => {
            const q = `dqn_${++seq}`; const c = `dqn-${seq}`
            let ctx
            wildflower.component(c, { state: state(depth), init() { ctx = this } })
            const declare = () => wildflower.query(q, { from: `/api/${q}.json`, key: 'id' })
            if (declared === 'before the scan') declare()
            container.innerHTML = `<div data-component="${c}">${nest(depth, SHAPES[shape].el(q))}</div>`
            wildflower.scan(container)
            await settle()
            if (declared === 'after the scan') declare()
            await settle(400)
            expect(fetches, 'the query fetched').toBeGreaterThan(0)
            expect(shownAll(shape), 'the element shows what the fetch answered').toEqual([SHAPES[shape].want])

            innermost(ctx, depth).push({ n: 'row 2' })
            await settle(300)
            expect(shownAll(shape), 'and so does the one in a row added later').toEqual([SHAPES[shape].want, SHAPES[shape].want])
        })
    }
})
