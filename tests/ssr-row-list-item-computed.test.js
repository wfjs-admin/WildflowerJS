/**
 * A list nested in a server-rendered row over an undotted name the
 * component declares as a computed (data-list="chips", chips(item)) reads
 * the computed, as on the client. The server-row parse wrote the nested
 * rows onto the item as a chips field, which the row then read first, so
 * the list stopped following the computed's inputs. An undotted name with
 * no computed behind it is still a field of its row (control).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const SSR = hasFeature('ssr') && hasFeature('lists')
const describeIfSSR = SSR ? describe : describe.skip

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
const step = async (fn) => { fn(); await settle(100) }
let seq = 0
const uname = (p) => `srlic-${p}-${++seq}`
const kids = (el) => el ? [...el.children].filter(c => c.tagName !== 'TEMPLATE') : []
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

describeIfSSR('a server row list over an item-level computed', () => {
    let wildflower
    let container

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    const inner = (path, vs) => `<ul class="chips" data-list="${path}"><template><i data-bind="v"></i></template>` +
        vs.map(v => `<i data-bind="v">${v}</i>`).join('') + '</ul>'
    const mount = async (c, path, rows) => {
        const tpl = `<template><li><b data-bind="name"></b>${inner(path, [])}</li></template>`
        const row = ([name, vs, seed]) => `<li${seed ? ` data-seed='${JSON.stringify(seed)}'` : ''}><b data-bind="name">${name}</b>${inner(path, vs)}</li>`
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="items">${tpl}${rows.map(row).join('')}</ul></div>`
        wildflower.scan(container)
        await settle(150)
        const host = container.querySelector('.host')
        return { host, ctx: wildflower.getComponentInstance(host.dataset.componentId).context }
    }
    const chips = (host) => [...host.querySelectorAll('.chips')].map(u => kids(u).map(l => l.textContent).join('|'))

    it('the row list follows the computed after activation, and the item holds no copy of it', async () => {
        const c = uname('ic')
        wildflower.component(c, {
            state: { items: [] },
            computed: { chips(item) { return (item.tags || []).map(t => ({ v: t })) } }
        })
        const { host, ctx } = await mount(c, 'chips', [['R0', ['a', 'b'], { tags: ['a', 'b'] }], ['R1', ['c'], { tags: ['c'] }]])
        expect(chips(host)).toEqual(['a|b', 'c'])
        expect(ctx.items.map(i => has(i, 'chips'))).toEqual([false, false])
        await step(() => { ctx.items[0].tags.push('z') })
        expect(chips(host)).toEqual(['a|b|z', 'c'])
        await step(() => { ctx.items[1].tags = ['q', 'r'] })
        expect(chips(host)).toEqual(['a|b|z', 'q|r'])
    })

    it('a row list over an item field of the same shape is still parsed into its row (control)', async () => {
        const c = uname('f')
        wildflower.component(c, { state: { items: [] } })
        const { host, ctx } = await mount(c, 'cells', [['R0', ['a', 'b']], ['R1', ['c']]])
        expect(chips(host)).toEqual(['a|b', 'c'])
        expect(ctx.items.map(i => (i.cells || []).map(x => x.v))).toEqual([['a', 'b'], ['c']])
        await step(() => { ctx.items[0].cells.push({ v: 'z' }) })
        expect(chips(host)).toEqual(['a|b|z', 'c'])
    })
})
