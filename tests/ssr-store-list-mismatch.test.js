/**
 * A server-rendered list over a store ($name.path) whose store already holds
 * data that disagrees with the server rows in length shows the store at
 * activation. Server rows a|b with the store at [x] showed x|b: the first row
 * took the store item and the second kept its server text, until the next
 * store change. A store still empty at activation keeps the server rows
 * (ssr-nested-lists.test.js 1.6b).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const SSR = hasFeature('ssr') && hasFeature('lists')
const describeIfSSR = SSR ? describe : describe.skip

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
const step = async (fn) => { fn(); await settle(100) }
let seq = 0
const uname = (p) => `sslm-${p}-${++seq}`
const kids = (el) => el ? [...el.children].filter(c => c.tagName !== 'TEMPLATE') : []

describeIfSSR('a server list over a store that disagrees with the server rows', () => {
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

    const inner = (path, ts) => `<ul class="tags" data-list="${path}"><template><i data-bind="t"></i></template>` +
        ts.map(t => `<i data-bind="t">${t}</i>`).join('') + '</ul>'
    const tags = (host) => [...host.querySelectorAll('.tags')].map(u => kids(u).map(l => l.textContent).join('|'))
    const scan = async () => { wildflower.scan(container); await settle(150); return container.querySelector('.host') }

    it('a $store list in every server row shows the store at activation and follows it', async () => {
        const c = uname('n'); const s = 'sslmstore' + seq
        wildflower.store(s, { state: { items: [{ t: 'x' }] } })
        wildflower.component(c, { state: { groups: [] } })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="groups">` +
            `<template><li><b class="g" data-bind="name"></b>${inner(`$${s}.items`, [])}</li></template>` +
            ['G0', 'G1'].map(g => `<li><b class="g" data-bind="name">${g}</b>${inner(`$${s}.items`, ['a', 'b'])}</li>`).join('') + '</ul></div>'
        const host = await scan()
        expect(tags(host)).toEqual(['x', 'x'])
        expect([...host.querySelectorAll('.g')].map(b => b.textContent)).toEqual(['G0', 'G1'])
        await step(() => { wildflower.getStore(s).items.push({ t: 'y' }) })
        expect(tags(host)).toEqual(['x|y', 'x|y'])
    })

    it('a top-level $store list shows the store at activation and follows it', async () => {
        const c = uname('t'); const s = 'sslmstore' + seq
        wildflower.store(s, { state: { items: [{ t: 'x' }] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true">${inner(`$${s}.items`, ['a', 'b'])}</div>`
        const host = await scan()
        expect(tags(host)).toEqual(['x'])
        await step(() => { wildflower.getStore(s).items.push({ t: 'y' }) })
        expect(tags(host)).toEqual(['x|y'])
    })

    it('a top-level $store list with more store items than server rows shows them all', async () => {
        const c = uname('m'); const s = 'sslmstore' + seq
        wildflower.store(s, { state: { items: [{ t: 'x' }, { t: 'y' }, { t: 'z' }] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true">${inner(`$${s}.items`, ['a'])}</div>`
        const host = await scan()
        expect(tags(host)).toEqual(['x|y|z'])
    })

    // The outer list reads the store, the inner one a field of each store
    // row. Whether the store has loaded is asked of the list that reads it
    // (the outer one, which holds a row), not of the inner list: an inner
    // list the store row leaves empty shows no rows. (The emptiness of the
    // inner list was read as "the store has not loaded", so its server rows
    // stayed, with no state behind them.)
    const groupsHtml = (c, s, groups) => `<div class="host" data-component="${c}" data-ssr="true"><div class="outer" data-list="$${s}.groups">` +
        `<template><section><h3 data-bind="n"></h3>${inner('tags', [])}</section></template>` +
        groups.map(([n, ts]) => `<section><h3 data-bind="n">${n}</h3>${inner('tags', ts)}</section>`).join('') + '</div></div>'
    const groupsView = (host) => [...host.querySelectorAll('section')].map(sec => sec.querySelector('h3').textContent + ':' + kids(sec.querySelector('.tags')).map(l => l.textContent).join('|'))

    it('a list in a $store row that the store row leaves empty shows no rows, and follows the store', async () => {
        const c = uname('ge'); const s = 'sslmstore' + seq
        wildflower.store(s, { state: { groups: [{ n: 'G', tags: [] }] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = groupsHtml(c, s, [['G', ['a', 'b']]])
        const host = await scan()
        expect(groupsView(host)).toEqual(['G:'])
        await step(() => { wildflower.getStore(s).groups[0].tags.push({ t: 'y' }) })
        expect(groupsView(host)).toEqual(['G:y'])
    })

    it('a list in a $store row whose items differ from the server rows shows the store (control)', async () => {
        const c = uname('gd'); const s = 'sslmstore' + seq
        wildflower.store(s, { state: { groups: [{ n: 'G', tags: [{ t: 'x' }] }] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = groupsHtml(c, s, [['G', ['a', 'b']]])
        const host = await scan()
        expect(groupsView(host)).toEqual(['G:x'])
    })

    it('with the store still empty, the outer rows and the lists in them keep their server rows until it loads (control)', async () => {
        const c = uname('g0'); const s = 'sslmstore' + seq
        wildflower.store(s, { state: { groups: [] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = groupsHtml(c, s, [['G', ['a', 'b']]])
        const host = await scan()
        expect(groupsView(host)).toEqual(['G:a|b'])
        await step(() => { wildflower.getStore(s).groups = [{ n: 'H', tags: [{ t: 'z' }] }] })
        expect(groupsView(host)).toEqual(['H:z'])
    })

    it('a store list matching the server rows keeps the server nodes (control)', async () => {
        const c = uname('k'); const s = 'sslmstore' + seq
        wildflower.store(s, { state: { items: [{ t: 'a' }, { t: 'b' }] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true">${inner(`$${s}.items`, ['a', 'b'])}</div>`
        const nodes = [...container.querySelectorAll('.tags i')]
        const host = await scan()
        expect(tags(host)).toEqual(['a|b'])
        expect([...host.querySelectorAll('.tags i')].map(n => nodes.indexOf(n))).toEqual([0, 1])
    })
})
