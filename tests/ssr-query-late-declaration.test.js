/**
 * A data-query inside data-ssr markup whose wildflower.query() runs after the
 * markup was scanned (a late declaration, which the query system supports)
 * adopts its server rows, as when the query is declared first. The store's
 * creation woke the component and re-rendered the list from the new, empty
 * store, which removed the server rows before the query's drain could adopt
 * them: the list showed nothing until the fetch landed, then built new nodes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('ssr') && hasFeature('lists') && hasFeature('query') ? describe : describe.skip

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uname = (p) => `sqld_${p}_${++seq}`
const kids = (el) => el ? [...el.children].filter(c => c.tagName !== 'TEMPLATE') : []
const plain = (v) => JSON.parse(JSON.stringify(v))

describeIf('a data-query declared after its server-rendered markup was scanned', () => {
    let wildflower
    let container
    let realFetch
    let release

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        realFetch = window.fetch
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    const respondWith = (data) => {
        window.fetch = () => new Promise(res => {
            release = () => res(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
        })
    }
    const tr = (id, sku) => `<tr data-seed='{"id":${id}}'><td class="sku" data-bind="sku">${sku}</td></tr>`
    const listHtml = (c, q) => `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-query="${q}">` +
        `<template><tr><td class="sku" data-bind="sku"></td></tr></template>${tr(1, 'A1')}${tr(2, 'B2')}</tbody></table></div>`

    for (const order of ['first', 'late']) {
        it(`a list query declared ${order} keeps and adopts its server rows, and the fetch updates the same nodes`, async () => {
            const q = uname('l'); const c = uname('c').replace(/_/g, '-')
            respondWith([{ id: 1, sku: 'A1!' }, { id: 2, sku: 'B2' }, { id: 3, sku: 'C3' }])
            const declare = () => wildflower.query(q, { from: `/api/${q}.json`, key: 'id' })
            wildflower.component(c, { state: {} })
            if (order === 'first') declare()
            container.innerHTML = listHtml(c, q)
            const outer = container.querySelector('.outer')
            const rows0 = kids(outer)
            const view = () => kids(outer).map(r => r.textContent)
            const idx = () => kids(outer).map(r => rows0.indexOf(r))
            wildflower.scan(container)
            await settle()
            expect(view()).toEqual(['A1', 'B2'])
            if (order === 'late') {
                declare()
                await settle()
            }
            expect(plain(wildflower.getStore(q).rows)).toEqual([{ id: 1, sku: 'A1' }, { id: 2, sku: 'B2' }])
            expect(view()).toEqual(['A1', 'B2'])
            expect(idx()).toEqual([0, 1])
            release()
            await settle(200)
            expect(view()).toEqual(['A1!', 'B2', 'C3'])
            expect(idx()).toEqual([0, 1, -1])
        })
    }

    // Two lists over one query, in two components: each keeps its own server
    // nodes. (Declared late, the first list kept them and the second was
    // rebuilt.)
    for (const order of ['first', 'late']) {
        it(`two lists over one query declared ${order} both keep their server nodes`, async () => {
            const q = uname('t'); const c1 = uname('c').replace(/_/g, '-'); const c2 = uname('c').replace(/_/g, '-')
            respondWith([{ id: 1, sku: 'A1!' }, { id: 2, sku: 'B2' }, { id: 3, sku: 'C3' }])
            const declare = () => wildflower.query(q, { from: `/api/${q}.json`, key: 'id' })
            wildflower.component(c1, { state: {} })
            wildflower.component(c2, { state: {} })
            if (order === 'first') declare()
            container.innerHTML = listHtml(c1, q) + listHtml(c2, q)
            const lists = [...container.querySelectorAll('.outer')]
            const rows0 = lists.map(kids)
            const view = () => lists.map(l => kids(l).map(r => r.textContent))
            const idx = () => lists.map((l, i) => kids(l).map(r => rows0[i].indexOf(r)))
            wildflower.scan(container)
            await settle()
            if (order === 'late') {
                declare()
                await settle()
            }
            expect(view()).toEqual([['A1', 'B2'], ['A1', 'B2']])
            expect(idx()).toEqual([[0, 1], [0, 1]])
            release()
            await settle(200)
            expect(view()).toEqual([['A1!', 'B2', 'C3'], ['A1!', 'B2', 'C3']])
            expect(idx()).toEqual([[0, 1, -1], [0, 1, -1]])
        })
    }

    // A query list inside a server-rendered data-list row: its rows belong to
    // the query, not to the row around it. (Declared late, the row's parse
    // took the query rows' fields for its own, and the list did not follow
    // the fetch.)
    for (const order of ['first', 'late']) {
        it(`a query list inside a server-rendered list row, declared ${order}, adopts its rows and follows the fetch`, async () => {
            const q = uname('n'); const c = uname('c').replace(/_/g, '-')
            respondWith([{ id: 1, sku: 'A1!' }, { id: 2, sku: 'B2' }, { id: 3, sku: 'C3' }])
            const declare = () => wildflower.query(q, { from: `/api/${q}.json`, key: 'id' })
            wildflower.component(c, { state: { groups: [] } })
            if (order === 'first') declare()
            const li = (id, sku) => `<li data-seed='{"id":${id}}'><span data-bind="sku">${sku}</span></li>`
            const list = (rows) => `<ul class="inner" data-query="${q}"><template><li><span data-bind="sku"></span></li></template>${rows}</ul>`
            container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><div class="groups" data-list="groups">` +
                `<template><section><h3 data-bind="name"></h3>${list('')}</section></template>` +
                `<section><h3 data-bind="name">G1</h3>${list(li(1, 'A1') + li(2, 'B2'))}</section></div></div>`
            const inner = () => container.querySelector('.inner')
            const rows0 = kids(inner())
            const view = () => kids(inner()).map(r => r.textContent)
            const idx = () => kids(inner()).map(r => rows0.indexOf(r))
            wildflower.scan(container)
            await settle()
            expect(view()).toEqual(['A1', 'B2'])
            if (order === 'late') {
                declare()
                await settle()
            }
            const ctx = wildflower.componentInstances.get(container.querySelector('.host').dataset.componentId).context
            // The row is the group; the query's rows are the query's.
            expect(plain(ctx.groups)).toEqual([{ name: 'G1' }])
            expect(plain(wildflower.getStore(q).rows)).toEqual([{ id: 1, sku: 'A1' }, { id: 2, sku: 'B2' }])
            expect(view()).toEqual(['A1', 'B2'])
            expect(idx()).toEqual([0, 1])
            release()
            await settle(200)
            expect(view()).toEqual(['A1!', 'B2', 'C3'])
            expect(idx()).toEqual([0, 1, -1])
            expect(container.querySelector('h3').textContent).toBe('G1')
        })
    }

    for (const order of ['first', 'late']) {
        it(`a record query declared ${order} keeps its server content until the fetch lands`, async () => {
            const q = uname('r'); const c = uname('c').replace(/_/g, '-')
            respondWith({ id: 7, title: 'Fresh' })
            const declare = () => wildflower.query(q, { from: `/api/${q}.json`, key: 'id' })
            wildflower.component(c, { state: {} })
            if (order === 'first') declare()
            container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><div class="rec" data-query="${q}" data-seed='{"id":7}'>` +
                '<h2 class="title" data-bind="title">Server title</h2></div></div>'
            const title = () => container.querySelector('.title').textContent
            wildflower.scan(container)
            await settle()
            expect(title()).toBe('Server title')
            if (order === 'late') {
                declare()
                await settle()
            }
            expect(plain(wildflower.getStore(q).rows)).toEqual([{ id: 7, title: 'Server title' }])
            expect(title()).toBe('Server title')
            release()
            await settle(200)
            expect(title()).toBe('Fresh')
        })
    }

    it('a $store binding in server markup keeps its server text until the store registers', async () => {
        const c = uname('c').replace(/_/g, '-'); const s = uname('s')
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><span class="v" data-bind="$${s}.title">Server</span></div>`
        const v = () => container.querySelector('.v').textContent
        wildflower.scan(container)
        await settle()
        expect(v()).toBe('Server')
        wildflower.store(s, { state: { title: 'Store' } })
        await settle()
        expect(v()).toBe('Store')
    })

    it('a $store binding outside server markup still renders empty until the store registers (control)', async () => {
        const c = uname('c').replace(/_/g, '-'); const s = uname('s')
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div class="host" data-component="${c}"><span class="v" data-bind="$${s}.title">Placeholder</span></div>`
        const v = () => container.querySelector('.v').textContent
        wildflower.scan(container)
        await settle()
        expect(v()).toBe('')
        wildflower.store(s, { state: { title: 'Store' } })
        await settle()
        expect(v()).toBe('Store')
    })
})
