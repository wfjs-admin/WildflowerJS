/**
 * A list row whose template holds a data-render element followed by other
 * bound elements. While the data-render element is out of the row (a comment
 * holds its place), the elements after it are still the ones the template
 * compiled: a write to an item field reaches its own element. Before, the
 * row's elements were found again by counting element children, which the
 * missing element shifted by one: after the first toggle, a binding after it
 * wrote into the next element along, or nowhere.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe.skipIf(!hasFeature('lists'))('bindings after a data-render element in a list row', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    const mount = async (tpl, extra = {}) => {
        const c = `lrbr-${++seq}`
        wildflower.component(c, { state: { items: [{ id: 1, n: 1, open: true }, { id: 2, n: 2, open: false }] }, ...extra })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li>${tpl}</li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        return wildflower.getComponent(c)
    }
    const rows = (read) => [...container.querySelectorAll('li')].map(read)
    const text = (li, sel) => { const el = li.querySelector(sel); return el ? el.textContent : '?' }

    it('a text binding after it follows its field through both toggles', async () => {
        const ctx = await mount('<b class="q" data-render="open">Q</b><i class="s" data-bind="open"></i><u class="n" data-bind="n"></u>')
        const read = () => rows(li => (li.querySelector('.q') ? 'q' : '-') + '|' + text(li, '.s') + '|' + text(li, '.n'))
        expect(read()).toEqual(['q|true|1', '-|false|2'])
        ctx.items[0].open = false; ctx.items[1].open = true; await settle()
        expect(read()).toEqual(['-|false|1', 'q|true|2'])
        ctx.items[0].n = 10; ctx.items[1].n = 20; await settle()
        expect(read()).toEqual(['-|false|10', 'q|true|20'])
        ctx.items[0].open = true; ctx.items[1].open = false; await settle()
        expect(read()).toEqual(['q|true|10', '-|false|20'])
        ctx.items[1].n = 21; await settle()
        expect(read()).toEqual(['q|true|10', '-|false|21'])
    })

    it('a class, a show and an attribute binding after it', async () => {
        const ctx = await mount('<b class="q" data-render="open">Q</b><i class="c" data-bind-class="{ on: open }">c</i>' +
            '<i class="w" data-show="open">w</i><i class="a" data-bind-attr="{ title: n }">a</i>')
        const read = () => rows(li => [li.querySelector('.c').classList.contains('on'), li.querySelector('.w').style.display !== 'none', li.querySelector('.a').getAttribute('title')].join('|'))
        expect(read()).toEqual(['true|true|1', 'false|false|2'])
        ctx.items[0].open = false; ctx.items[1].open = true; await settle()
        expect(read()).toEqual(['false|false|1', 'true|true|2'])
        ctx.items[0].n = 10; await settle()
        expect(read()).toEqual(['false|false|10', 'true|true|2'])
    })

    it('a binding inside a later element, and one inside the data-render element', async () => {
        const ctx = await mount('<b class="q" data-render="open"><em class="in" data-bind="n"></em></b><div><i class="s" data-bind="n"></i></div>')
        const read = () => rows(li => text(li, '.in') + '|' + text(li, '.s'))
        expect(read()).toEqual(['1|1', '?|2'])
        ctx.items[0].open = false; await settle()
        ctx.items[0].n = 10; ctx.items[1].n = 20; await settle()
        expect(read()).toEqual(['?|10', '?|20'])
        ctx.items[0].open = true; ctx.items[1].open = true; await settle()
        expect(read()).toEqual(['10|10', '20|20'])
        ctx.items[0].n = 11; await settle()
        expect(read()).toEqual(['11|11', '20|20'])
    })

    it('two data-render elements, one out from the first render', async () => {
        const ctx = await mount('<b class="q" data-render="shut">Q</b><b class="r" data-render="open">R</b><i class="s" data-bind="n"></i>',
            { computed: { shut(item) { return !item.open } } })
        const read = () => rows(li => (li.querySelector('.q') ? 'q' : '-') + (li.querySelector('.r') ? 'r' : '-') + '|' + text(li, '.s'))
        expect(read()).toEqual(['-r|1', 'q-|2'])
        ctx.items[0].n = 10; ctx.items[1].n = 20; await settle()
        expect(read()).toEqual(['-r|10', 'q-|20'])
        ctx.items[0].open = false; await settle()
        ctx.items[0].n = 11; await settle()
        expect(read()).toEqual(['q-|11', 'q-|20'])
    })

    it('an action on an element after it reaches its own handler with its own row (control)', async () => {
        const calls = []
        const ctx = await mount('<b class="q" data-render="open">Q</b><button class="a" data-action="pick">a</button><button class="b" data-action="drop">b</button>', {
            pick(event, element, details) { calls.push('pick:' + details.item.id) },
            drop(event, element, details) { calls.push('drop:' + details.item.id) },
        })
        ctx.items[0].open = false; ctx.items[1].open = true; await settle()
        ctx.items[1].open = false; await settle()
        const lis = [...container.querySelectorAll('li')]
        lis[0].querySelector('.a').click()
        lis[0].querySelector('.b').click()
        lis[1].querySelector('.a').click()
        lis[1].querySelector('.b').click()
        await settle()
        expect(calls).toEqual(['pick:1', 'drop:1', 'pick:2', 'drop:2'])
    })
})
