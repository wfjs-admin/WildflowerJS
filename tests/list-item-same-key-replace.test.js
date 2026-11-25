/**
 * A component in a list row follows the row's item.
 *
 * When an array is replaced by copies with the same keys (an immutable
 * update, or a refetch), each row keeps its element and its child components
 * and is given the new item. `this.listItem` in a child then returns the new
 * item, and a computed or a watcher that read `this.listItem` runs again.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-lisk-${++seq}`
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))

describe('this.listItem after a same-key replacement', () => {
    let wildflower
    let container

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
        container.remove()
    })

    const mount = async (rowHtml) => {
        const parent = uname('parent')
        const child = uname('child')
        let ctx
        wildflower.component(parent, {
            state: { rows: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] },
            init() { ctx = this },
        })
        wildflower.component(child, {
            computed: { lbl() { return this.listItem ? this.listItem.label : '?' } },
        })
        container.innerHTML = `
            <div data-component="${parent}">
                <ul data-list="rows" data-key="id"><template>${rowHtml(child)}</template></ul>
            </div>
        `
        wildflower.scan(container)
        await settle()
        const texts = () => [...container.querySelectorAll('.lbl')].map(e => e.textContent)
        const children = () => wildflower.getComponents(child)
        return { ctx, texts, children }
    }

    const inside = (child) => `<li><div data-component="${child}"><span class="lbl" data-bind="lbl"></span></div></li>`
    const asRow = (child) => `<li data-component="${child}"><span class="lbl" data-bind="lbl"></span></li>`

    it('a computed over this.listItem shows the new item', async () => {
        const { ctx, texts } = await mount(inside)
        expect(texts()).toEqual(['one', 'two'])
        ctx.rows = ctx.rows.map(r => ({ ...r, label: r.label + '+' }))
        await settle()
        expect(texts()).toEqual(['one+', 'two+'])
    })

    it('this.listItem returns the new item, and a later write to it shows', async () => {
        const { ctx, texts, children } = await mount(inside)
        ctx.rows = ctx.rows.map(r => ({ ...r, label: r.label + '+' }))
        await settle()
        expect(children().map(c => c.listItem.label)).toEqual(['one+', 'two+'])
        ctx.rows[0].label = 'uno'
        await settle()
        expect(texts()).toEqual(['uno', 'two+'])
    })

    it('the same holds when the component is the row element', async () => {
        const { ctx, texts } = await mount(asRow)
        expect(texts()).toEqual(['one', 'two'])
        ctx.rows = ctx.rows.map(r => ({ ...r, label: r.label + '+' }))
        await settle()
        expect(texts()).toEqual(['one+', 'two+'])
    })

    const itIfSSR = hasFeature('ssr') ? it : it.skip

    itIfSSR('a component in a server-rendered row has the row\'s item', async () => {
        const parent = uname('parent')
        const child = uname('child')
        wildflower.component(parent, { state: { rows: [] } })
        wildflower.component(child, { computed: { lbl() { return this.listItem ? this.listItem.label : '?' } } })
        const row = (label, id) => `<li${id ? ` data-seed='{"id":${id}}'` : ''}><b data-bind="label">${label}</b><div data-component="${child}"><span class="lbl" data-bind="lbl">${label}</span></div></li>`
        container.innerHTML = `
            <div class="host" data-component="${parent}" data-ssr="true">
                <ul data-list="rows" data-key="id"><template>${row('', 0)}</template>${row('one', 1)}${row('two', 2)}</ul>
            </div>
        `
        wildflower.scan(container)
        await settle(200)
        const ctx = wildflower.getComponentInstance(container.querySelector('.host').dataset.componentId).context
        expect(wildflower.getComponents(child).map(c => c.listItem && c.listItem.label)).toEqual(['one', 'two'])
        ctx.rows[0].label = 'uno'
        await settle()
        expect([...container.querySelectorAll('.lbl')].map(e => e.textContent)).toEqual(['uno', 'two'])
    })

    it('a reorder of the same objects keeps each child with its item', async () => {
        const { ctx, texts, children } = await mount(inside)
        const before = children().length
        ctx.rows = [ctx.rows[1], ctx.rows[0]]
        await settle()
        expect(texts()).toEqual(['two', 'one'])
        expect(children().length).toBe(before)
    })
})
