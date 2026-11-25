/**
 * An item-level computed on a server-rendered row follows component state.
 *
 * A computed that takes the item and also reads the component's state
 * (visible(item) reads this.q) is evaluated again for every row when that
 * state changes. Rows adopted from server HTML behave as rows rendered on the
 * client do, for data-show on the row, data-show inside the row, and
 * data-bind.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const SSR = hasFeature('ssr') && hasFeature('lists')
const describeIfSSR = SSR ? describe : describe.skip

const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uname = (p) => `sricfs-${p}-${++seq}`

describeIfSSR('item-level computeds on rows, after a component state change', () => {
    let wildflower
    let container

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    const names = ['apple', 'pear']
    const shapes = {
        'data-show on the row': (name) => `<li data-show="visible"${name ? ` data-seed='{"id":${names.indexOf(name) + 1}}'` : ''}><span class="name" data-bind="name">${name || ''}</span></li>`,
        'data-show inside the row': (name) => `<li${name ? ` data-seed='{"id":${names.indexOf(name) + 1}}'` : ''}><span class="name" data-show="visible" data-bind="name">${name || ''}</span></li>`,
        'data-bind': (name) => `<li${name ? ` data-seed='{"id":${names.indexOf(name) + 1}}'` : ''}><span class="name" data-bind="name">${name || ''}</span><i class="label" data-bind="label">${name ? name + '/' : ''}</i></li>`,
    }
    const definition = (items) => ({
        state: { q: '', items },
        computed: {
            visible(item) { const q = this.q; return q === '' || item.name.includes(q) },
            label(item) { return item.name + '/' + this.q },
        },
    })

    const mount = async (shape, server) => {
        const c = uname(server ? 's' : 'c')
        wildflower.component(c, definition(server ? [] : names.map((name, i) => ({ id: i + 1, name }))))
        const rows = server ? names.map(n => shapes[shape](n)).join('') : ''
        container.innerHTML = `<div class="host" data-component="${c}"${server ? ' data-ssr="true"' : ''}>
            <ul data-list="items" data-key="id"><template>${shapes[shape]('')}</template>${rows}</ul></div>`
        wildflower.scan(container)
        await settle(150)
        const host = container.querySelector('.host')
        const ctx = wildflower.getComponentInstance(host.dataset.componentId).context
        const shown = () => [...host.querySelectorAll('li')].map(li => {
            const el = shape === 'data-show on the row' ? li : li.querySelector('.name')
            return getComputedStyle(el).display === 'none' ? 'hidden' : 'shown'
        })
        const labels = () => [...host.querySelectorAll('.label')].map(e => e.textContent)
        return { ctx, shown, labels }
    }

    it('server-rendered rows: the parse leaves no copy of the computed on the item', async () => {
        const { ctx } = await mount('data-bind', true)
        expect(ctx.items.map(i => Object.prototype.hasOwnProperty.call(i, 'label'))).toEqual([false, false])
        expect(ctx.items.map(i => i.name)).toEqual(['apple', 'pear'])
    })

    it('server-rendered rows: a field the row seeds under the computed\'s name stays the item\'s', async () => {
        const c = uname('seed')
        wildflower.component(c, definition([]))
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true">
            <ul data-list="items" data-key="id"><template><li><span data-bind="name"></span><i class="label" data-bind="label"></i></li></template>
            <li data-seed='{"id":1,"label":"own"}'><span data-bind="name">apple</span><i class="label" data-bind="label">own</i></li></ul></div>`
        wildflower.scan(container)
        await settle(150)
        const host = container.querySelector('.host')
        const ctx = wildflower.getComponentInstance(host.dataset.componentId).context
        expect(ctx.items[0].label).toBe('own')
        ctx.q = 'X'
        await settle()
        expect(host.querySelector('.label').textContent).toBe('own')
    })

    for (const server of [false, true]) {
        const where = server ? 'server-rendered rows' : 'client-rendered rows'

        it(`${where}: data-show on the row follows this.q`, async () => {
            const { ctx, shown } = await mount('data-show on the row', server)
            expect(shown()).toEqual(['shown', 'shown'])
            ctx.q = 'pea'
            await settle()
            expect(shown()).toEqual(['hidden', 'shown'])
            ctx.q = ''
            await settle()
            expect(shown()).toEqual(['shown', 'shown'])
        })

        it(`${where}: data-show inside the row follows this.q`, async () => {
            const { ctx, shown } = await mount('data-show inside the row', server)
            ctx.q = 'pea'
            await settle()
            expect(shown()).toEqual(['hidden', 'shown'])
        })

        it(`${where}: data-bind to an item-level computed follows this.q`, async () => {
            const { ctx, labels } = await mount('data-bind', server)
            expect(labels()).toEqual(['apple/', 'pear/'])
            ctx.q = 'X'
            await settle()
            expect(labels()).toEqual(['apple/X', 'pear/X'])
        })
    }
})
