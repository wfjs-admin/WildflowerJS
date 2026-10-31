/**
 * Server-rendered (data-ssr) lists that follow state after activation, in
 * three shapes:
 *
 *   A  a component on the uncompiled binding path: one whose list row
 *      template is a data-use-template reference, or a second instance whose
 *      static markup differs from the first's (the compiled snapshot is per
 *      component type and matched by structure). A1, a data-use-template
 *      slot elsewhere in the component, is expanded before bindings compile,
 *      so it stays on the compiled path; it is kept as a control.
 *   B  a list over a computed (`data-list="shown"` or "computed:shown"),
 *      keyless and keyed.
 *   C  a data-query list whose server rows hold nested lists: over the row
 *      item (`cells`), and over a dotted path whose head the component
 *      declares (`settings.options`, read from the component).
 *
 * Each case asserts the DOM after activation and after later changes: an
 * item edit, a push or a source edit, and a replacement. Where a node can
 * survive, it is checked to be the server-rendered node (`idx`: the node's
 * index among the server nodes, -1 for a node the framework created).
 * P1 is the control: a plain list on the compiled path keeps its nodes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const SSR = hasFeature('ssr') && hasFeature('lists')
const describeIfSSR = SSR ? describe : describe.skip
const describeIfSSRQuery = SSR && hasFeature('query') ? describe : describe.skip

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
const step = async (fn) => { fn(); await settle(100) }
let seq = 0
const uname = (p) => `sla-${p}-${++seq}`

const kids = (el) => el ? [...el.children].filter(c => c.tagName !== 'TEMPLATE') : []
const rowsOf = (host) => kids(host.querySelector('.outer'))
const view = (host) => rowsOf(host).map(r => r.textContent)
const idx = (host, initial) => rowsOf(host).map(r => initial.indexOf(r))
const ctxOf = (host) => window.wildflower.getComponentInstance(host.dataset.componentId).context

const ROW_TPL = '<template><li><span class="t" data-bind="title"></span></li></template>'
const row = (t, seed) => `<li${seed ? ` data-seed='${JSON.stringify(seed)}'` : ''}><span class="t" data-bind="title">${t}</span></li>`
const postsList = (titles, { list = 'posts', key = false, seeds = null } = {}) =>
    `<ul class="outer" data-list="${list}"${key ? ' data-key="id"' : ''}>${ROW_TPL}` +
    titles.map((t, i) => row(t, seeds && seeds[i])).join('') + '</ul>'

describeIfSSR('SSR lists follow state after activation', () => {
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

    async function mount(html, register) {
        register()
        container.innerHTML = html
        const hosts = [...container.querySelectorAll('.host')]
        const initials = hosts.map(h => rowsOf(h))
        wildflower.scan(container)
        await settle(150)
        return { hosts, initials }
    }

    // An item edit, a push and a replacement on a top-level `posts` list
    // whose server rows were First and Second.
    async function exercisePosts(host, initial) {
        const ctx = ctxOf(host)
        expect(view(host)).toEqual(['First', 'Second'])
        expect(ctx.posts.map(p => p.title)).toEqual(['First', 'Second'])
        expect(idx(host, initial)).toEqual([0, 1])
        await step(() => { ctx.posts[0].title = 'First!' })
        expect(view(host)).toEqual(['First!', 'Second'])
        expect(idx(host, initial)).toEqual([0, 1])
        await step(() => { ctx.posts.push({ title: 'Third' }) })
        expect(view(host)).toEqual(['First!', 'Second', 'Third'])
        expect(idx(host, initial)).toEqual([0, 1, -1])
        await step(() => { ctx.posts = [{ title: 'Only' }] })
        expect(view(host)).toEqual(['Only'])
    }

    // -----------------------------------------------------------------------
    // Control: the compiled path
    // -----------------------------------------------------------------------

    it('P1 a plain server list (compiled path) keeps its server nodes through an edit and a push', async () => {
        const c = uname('p1')
        const { hosts, initials } = await mount(
            `<div class="host" data-component="${c}" data-ssr="true">${postsList(['First', 'Second'])}</div>`,
            () => wildflower.component(c, { state: { posts: [] } }))
        await exercisePosts(hosts[0], initials[0])
    })

    // -----------------------------------------------------------------------
    // A: components on the uncompiled binding path
    // -----------------------------------------------------------------------

    it('A1 a component holding a data-use-template slot hydrates its server list and follows state', async () => {
        const c = uname('a1'); const prov = c + '-prov'
        const html = `<div data-component="${prov}"><template data-item-template="${c}-card"><b class="nm" data-bind="name"></b></template>` +
            `<div class="host" data-component="${c}" data-ssr="true"><div class="slot" data-use-template="${c}-card" data-with="who"></div>` +
            `${postsList(['First', 'Second'])}</div></div>`
        const { hosts, initials } = await mount(html, () => {
            wildflower.component(prov, { state: {} })
            wildflower.component(c, { state: { posts: [], who: { name: 'Ann' } } })
        })
        expect(hosts[0].querySelector('.nm').textContent).toBe('Ann')
        await exercisePosts(hosts[0], initials[0])
    })

    it('A1b a server list whose row template is a data-use-template reference hydrates and follows state', async () => {
        const c = uname('a1b'); const prov = c + '-prov'
        const html = `<div data-component="${prov}"><template data-item-template="${c}-row"><li><span class="t" data-bind="title"></span></li></template>` +
            `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="posts">` +
            `<template data-use-template="${c}-row"></template>${row('First')}${row('Second')}</ul></div></div>`
        const { hosts, initials } = await mount(html, () => {
            wildflower.component(prov, { state: {} })
            wildflower.component(c, { state: { posts: [] } })
        })
        await exercisePosts(hosts[0], initials[0])
    })

    it('A2 a second instance whose static markup differs from the first\'s hydrates its server list and follows state', async () => {
        const c = uname('a2')
        const host = (extra) => `<div class="host" data-component="${c}" data-ssr="true">${extra}${postsList(['First', 'Second'])}</div>`
        const { hosts, initials } = await mount(host('') + host('<p class="note">A note</p>'),
            () => wildflower.component(c, { state: { posts: [] } }))
        await exercisePosts(hosts[1], initials[1])
        // The first instance (compiled path) is left alone.
        expect(view(hosts[0])).toEqual(['First', 'Second'])
        expect(idx(hosts[0], initials[0])).toEqual([0, 1])
        await exercisePosts(hosts[0], initials[0])
    })

    it('A3 a second instance with differing markup and nested server lists: the nested rows follow their row', async () => {
        const c = uname('a3')
        const cellTpl = '<template><i class="c" data-bind="v"></i></template>'
        const groupRow = (n, vs) => `<section><b class="g" data-bind="name">${n}</b><p data-list="cells">${cellTpl}` +
            vs.map(v => `<i class="c" data-bind="v">${v}</i>`).join('') + '</p></section>'
        const host = (extra) => `<div class="host" data-component="${c}" data-ssr="true">${extra}<div class="outer" data-list="groups">` +
            `<template><section><b class="g" data-bind="name"></b><p data-list="cells">${cellTpl}</p></section></template>` +
            groupRow('G0', ['1', '2']) + groupRow('G1', ['3']) + '</div></div>'
        const { hosts } = await mount(host('') + host('<p class="note">A note</p>'),
            () => wildflower.component(c, { state: { groups: [] } }))
        const h = hosts[1]
        const ctx = ctxOf(h)
        const cells0 = [...h.querySelectorAll('.c')]
        const gview = () => rowsOf(h).map(r => r.querySelector('.g').textContent + ':' + [...r.querySelectorAll('.c')].map(e => e.textContent).join('|'))
        expect(ctx.groups.map(g => g.cells.map(x => x.v))).toEqual([['1', '2'], ['3']])
        expect(gview()).toEqual(['G0:1|2', 'G1:3'])
        await step(() => { ctx.groups[0].cells[1].v = '2!' })
        await step(() => { ctx.groups[1].cells.push({ v: '4' }) })
        expect(gview()).toEqual(['G0:1|2!', 'G1:3|4'])
        expect([...h.querySelectorAll('.c')].map(e => cells0.indexOf(e))).toEqual([0, 1, 2, -1])
    })

    // -----------------------------------------------------------------------
    // B: a list over a computed
    // -----------------------------------------------------------------------

    const ITEMS = [{ id: 1, title: 'A', done: false }, { id: 2, title: 'B', done: true }, { id: 3, title: 'C', done: false }]
    const shownDef = (extra = {}) => ({
        state: { items: [] },
        computed: { shown() { return this.items.filter(i => !i.done) } },
        ...extra
    })
    const seedAttr = (items) => ` data-seed='${JSON.stringify({ items })}'`

    for (const form of ['shown', 'computed:shown']) {
        it(`B1 a server list over a computed follows a source edit, an item edit and a replacement (data-list="${form}")`, async () => {
            const c = uname('b1')
            const html = `<div class="host" data-component="${c}" data-ssr="true"${seedAttr(ITEMS)}>${postsList(['A', 'C'], { list: form })}</div>`
            const { hosts, initials } = await mount(html, () => wildflower.component(c, shownDef()))
            const host = hosts[0]; const initial = initials[0]; const ctx = ctxOf(host)
            expect(ctx.items.map(i => i.title)).toEqual(['A', 'B', 'C'])
            expect(view(host)).toEqual(['A', 'C'])
            expect(idx(host, initial)).toEqual([0, 1])
            // An edit the computed does not read (it filters on done).
            await step(() => { ctx.items[0].title = 'A!' })
            expect(view(host)).toEqual(['A!', 'C'])
            expect(idx(host, initial)).toEqual([0, 1])
            await step(() => { ctx.items[1].done = false })
            expect(view(host)).toEqual(['A!', 'B', 'C'])
            expect(idx(host, initial)[0]).toBe(0)
            await step(() => { ctx.items[2].done = true })
            expect(view(host)).toEqual(['A!', 'B'])
            await step(() => { ctx.items = [{ id: 7, title: 'X', done: false }, { id: 8, title: 'Y', done: true }] })
            expect(view(host)).toEqual(['X'])
            await step(() => { ctx.items[0].title = 'X!' })
            expect(view(host)).toEqual(['X!'])
        })
    }

    it('B2 a keyed server list over a computed keeps each server node with its key', async () => {
        const c = uname('b2')
        const html = `<div class="host" data-component="${c}" data-ssr="true"${seedAttr(ITEMS)}>` +
            postsList(['A', 'C'], { key: true, seeds: [{ id: 1 }, { id: 3 }] }).replace('data-list="posts"', 'data-list="shown"') + '</div>'
        const { hosts, initials } = await mount(html, () => wildflower.component(c, shownDef()))
        const host = hosts[0]; const initial = initials[0]; const ctx = ctxOf(host)
        expect(view(host)).toEqual(['A', 'C'])
        expect(idx(host, initial)).toEqual([0, 1])
        await step(() => { ctx.items[1].done = false })
        expect(view(host)).toEqual(['A', 'B', 'C'])
        expect(idx(host, initial)).toEqual([0, -1, 1])
        await step(() => { ctx.items[2].title = 'C!' })
        expect(view(host)).toEqual(['A', 'B', 'C!'])
        expect(idx(host, initial)).toEqual([0, -1, 1])
        await step(() => { ctx.items[0].done = true })
        expect(view(host)).toEqual(['B', 'C!'])
        expect(idx(host, initial)).toEqual([-1, 1])
        await step(() => { ctx.items = [{ id: 3, title: 'C2', done: false }, { id: 9, title: 'Z', done: false }] })
        expect(view(host)).toEqual(['C2', 'Z'])
        expect(idx(host, initial)).toEqual([1, -1])
    })

    it('B3 a server list over a computed that is empty at activation keeps its server rows, then follows the data when it arrives', async () => {
        const c = uname('b3')
        const html = `<div class="host" data-component="${c}" data-ssr="true">${postsList(['A', 'C'], { list: 'shown' })}</div>`
        const { hosts, initials } = await mount(html, () => wildflower.component(c, shownDef()))
        const host = hosts[0]; const initial = initials[0]; const ctx = ctxOf(host)
        expect(view(host)).toEqual(['A', 'C'])
        expect(idx(host, initial)).toEqual([0, 1])
        await step(() => { ctx.items = [{ id: 1, title: 'P', done: false }, { id: 2, title: 'Q', done: true }] })
        expect(view(host)).toEqual(['P'])
        await step(() => { ctx.items[1].done = false })
        expect(view(host)).toEqual(['P', 'Q'])
        await step(() => { ctx.items[0].title = 'P!' })
        expect(view(host)).toEqual(['P!', 'Q'])
    })

    it('B3b the same, with the data arriving in a batch that spans a tick', async () => {
        const c = uname('b3b')
        const html = `<div class="host" data-component="${c}" data-ssr="true">${postsList(['A', 'C'], { list: 'shown' })}</div>`
        const { hosts } = await mount(html, () => wildflower.component(c, shownDef()))
        const host = hosts[0]; const ctx = ctxOf(host)
        expect(view(host)).toEqual(['A', 'C'])
        const b = wildflower.startBatch()
        ctx.items = [{ id: 1, title: 'P', done: false }, { id: 2, title: 'Q', done: false }]
        await settle(50)
        await step(() => b.apply())
        expect(view(host)).toEqual(['P', 'Q'])
        await step(() => { ctx.items[1].title = 'Q!' })
        expect(view(host)).toEqual(['P', 'Q!'])
    })

    it('B4 a server list over a computed with no write after activation keeps its server nodes', async () => {
        const c = uname('b4')
        const html = `<div class="host" data-component="${c}" data-ssr="true"${seedAttr(ITEMS)}><h2 class="ttl" data-bind="title">T</h2>${postsList(['A', 'C'], { list: 'shown' })}</div>`
        const { hosts, initials } = await mount(html, () => wildflower.component(c, shownDef({ state: { items: [], title: '' } })))
        const host = hosts[0]
        expect(view(host)).toEqual(['A', 'C'])
        await step(() => { ctxOf(host).title = 'T2' })
        expect(host.querySelector('.ttl').textContent).toBe('T2')
        expect(view(host)).toEqual(['A', 'C'])
        expect(idx(host, initials[0])).toEqual([0, 1])
    })

    it('B5 two server lists over one computed, empty at activation, both follow when the data arrives', async () => {
        const c = uname('b5')
        const two = postsList(['A'], { list: 'shown' }).replace('class="outer"', 'class="outer o1"') +
            postsList(['A'], { list: 'shown' }).replace('class="outer"', 'class="o2"')
        const { hosts } = await mount(`<div class="host" data-component="${c}" data-ssr="true">${two}</div>`, () => wildflower.component(c, shownDef()))
        const host = hosts[0]; const ctx = ctxOf(host)
        const both = () => ['.o1', '.o2'].map(s => kids(host.querySelector(s)).map(r => r.textContent))
        expect(both()).toEqual([['A'], ['A']])
        await step(() => { ctx.items = [{ id: 1, title: 'P', done: false }] })
        expect(both()).toEqual([['P'], ['P']])
        await step(() => { ctx.items.push({ id: 2, title: 'Q', done: false }) })
        expect(both()).toEqual([['P', 'Q'], ['P', 'Q']])
    })

    // Rows with an input the user is typing in.
    const INPUT_TPL = '<template><li><span class="t" data-bind="title"></span><input class="in"></li></template>'
    const inputRow = (it) => `<li data-seed='{"id":${it.id}}'><span class="t" data-bind="title">${it.title}</span><input class="in"></li>`
    const inputList = (list, items, keyed) =>
        `<ul class="outer" data-list="${list}"${keyed ? ' data-key="id"' : ''}>${INPUT_TPL}${items.map(inputRow).join('')}</ul>`
    // The nodes of the server rows, before the framework scans them.
    function serverMount(html, def) {
        const c = uname('in')
        wildflower.component(c, def)
        container.innerHTML = html.replace('%C%', c)
        const host = container.querySelector('.host')
        return { host, initial: rowsOf(host) }
    }

    for (const keyed of [true, false]) {
        it(`B6 the takeover at activation keeps the focus and the typed text in a server row whose position matches (${keyed ? 'keyed' : 'keyless'})`, async () => {
            const items = [{ id: 1, title: 'A', done: false }, { id: 2, title: 'B', done: false }]
            const { host, initial } = serverMount(`<div class="host" data-component="%C%" data-ssr="true"${seedAttr(items)}>${inputList('shown', items, keyed)}</div>`, shownDef())
            const inp = initial[1].querySelector('.in')
            inp.focus()
            inp.value = 'typed'
            expect(document.activeElement).toBe(inp)
            wildflower.scan(container)
            await settle(150)
            expect(!!host.querySelector('.outer')._mapArrayInitialized).toBe(true)
            expect(document.activeElement).toBe(inp)
            expect(inp.value).toBe('typed')
            expect(idx(host, initial)).toEqual([0, 1])
            const ctx = ctxOf(host)
            await step(() => { ctx.items[0].title = 'A!' })
            await step(() => { ctx.items.push({ id: 3, title: 'C', done: false }) })
            expect(rowsOf(host).map(r => r.querySelector('.t').textContent)).toEqual(['A!', 'B', 'C'])
            expect(idx(host, initial)).toEqual([0, 1, -1])
            expect(document.activeElement).toBe(inp)
        })
    }

    it('B7 keyed server rows pair with their items by key when the computed orders them differently', async () => {
        const items = [{ id: 1, title: 'A', rank: 2 }, { id: 2, title: 'B', rank: 3 }, { id: 3, title: 'C', rank: 1 }]
        const def = { state: { items: [] }, computed: { ranked() { return [...this.items].sort((a, b) => a.rank - b.rank) } } }
        const { host, initial } = serverMount(`<div class="host" data-component="%C%" data-ssr="true"${seedAttr(items)}>${inputList('ranked', items, true)}</div>`, def)
        initial[0].querySelector('.in').value = 'typed-1'
        wildflower.scan(container)
        await settle(150)
        expect(rowsOf(host).map(r => r.querySelector('.t').textContent)).toEqual(['C', 'A', 'B'])
        expect(idx(host, initial)).toEqual([2, 0, 1])
        expect(initial[0].querySelector('.t').textContent).toBe('A')
        expect(initial[0].querySelector('.in').value).toBe('typed-1')
        await step(() => { ctxOf(host).items[0].title = 'A!' })
        expect(initial[0].querySelector('.t').textContent).toBe('A!')
    })

    it('B7b keyed server rows with no item are removed, and items with no server row are rendered', async () => {
        const server = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }]
        const items = [{ id: 1, title: 'A', rank: 3 }, { id: 3, title: 'C', rank: 1 }, { id: 4, title: 'D', rank: 2 }]
        const def = { state: { items: [] }, computed: { ranked() { return [...this.items].sort((a, b) => a.rank - b.rank) } } }
        const { host, initial } = serverMount(`<div class="host" data-component="%C%" data-ssr="true"${seedAttr(items)}>${inputList('ranked', server, true)}</div>`, def)
        wildflower.scan(container)
        await settle(150)
        expect(rowsOf(host).map(r => r.querySelector('.t').textContent)).toEqual(['C', 'D', 'A'])
        expect(idx(host, initial)).toEqual([2, -1, 0])
        expect(initial[1].isConnected).toBe(false)
    })

    it.skipIf(isMinifiedBuild())('N1 a removed server row takes its nested list contexts with it', async () => {
        const c = uname('n1')
        const cellTpl = '<template><i class="c" data-bind="v"></i></template>'
        const groupRow = (n, vs) => `<section><b class="g" data-bind="name">${n}</b><p class="nl" data-list="cells">${cellTpl}` +
            vs.map(v => `<i class="c" data-bind="v">${v}</i>`).join('') + '</p></section>'
        const html = `<div class="host" data-component="${c}" data-ssr="true"><div class="outer" data-list="groups">` +
            `<template><section><b class="g" data-bind="name"></b><p class="nl" data-list="cells">${cellTpl}</p></section></template>` +
            groupRow('G0', ['1']) + groupRow('G1', ['3']) + groupRow('G2', ['5']) + '</div></div>'
        const { hosts } = await mount(html, () => wildflower.component(c, { state: { groups: [] } }))
        const host = hosts[0]
        const inst = wildflower.getComponentInstance(host.dataset.componentId)
        await step(() => { ctxOf(host).groups.splice(0, 1) })
        expect(rowsOf(host).map(r => r.textContent)).toEqual(['G13', 'G25'])
        expect([...inst._listContexts.values()].filter(cx => cx.element && !cx.element.isConnected)).toEqual([])
    })

    it('B7c keyed server rows pair by key when the key is bound as text in a child element', async () => {
        const items = [{ id: 1, title: 'A', rank: 2 }, { id: 2, title: 'B', rank: 3 }, { id: 3, title: 'C', rank: 1 }]
        const def = { state: { items: [] }, computed: { ranked() { return [...this.items].sort((a, b) => a.rank - b.rank) } } }
        const r = (it) => `<li><span class="k" data-bind="id">${it.id}</span><span class="t" data-bind="title">${it.title}</span></li>`
        const { host, initial } = serverMount(`<div class="host" data-component="%C%" data-ssr="true"${seedAttr(items)}>` +
            `<ul class="outer" data-list="ranked" data-key="id"><template>${r({ id: '', title: '' })}</template>${items.map(r).join('')}</ul></div>`, def)
        wildflower.scan(container)
        await settle(150)
        expect(view(host)).toEqual(['3C', '1A', '2B'])
        expect(idx(host, initial)).toEqual([2, 0, 1])
    })

    // Rows whose position shows: _index, and classes from _first and _last.
    const posRow = '<li data-bind-class="{ first: _first, last: _last }"><span class="t" data-bind="title"></span><b class="ix" data-bind="_index"></b></li>'
    const posView = (host) => rowsOf(host).map(r => r.querySelector('.t').textContent + '#' + r.querySelector('.ix').textContent +
        '[' + ['first', 'last'].filter(k => r.classList.contains(k)).join(' ') + ']')

    for (const keyed of [true, false]) {
        it(`P2 positions are right after a removal takes the list over (${keyed ? 'keyed' : 'keyless'})`, async () => {
            const c = uname('p2')
            const r = (id, t, i) => `<li data-seed='{"id":${id}}' class="${i === 0 ? 'first' : ''}${i === 2 ? 'last' : ''}"><span class="t" data-bind="title">${t}</span><b class="ix" data-bind="_index">${i}</b></li>`
            const html = `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="posts"${keyed ? ' data-key="id"' : ''}>` +
                `<template>${posRow}</template>${r(1, 'A', 0)}${r(2, 'B', 1)}${r(3, 'C', 2)}</ul></div>`
            const { hosts } = await mount(html, () => wildflower.component(c, { state: { posts: [] } }))
            const host = hosts[0]
            await step(() => { ctxOf(host).posts.splice(0, 1) })
            expect(posView(host)).toEqual(['B#0[first]', 'C#1[last]'])
            await step(() => { ctxOf(host).posts.push({ id: 9, title: 'Z' }) })
            expect(posView(host)).toEqual(['B#0[first]', 'C#1[]', 'Z#2[last]'])
        })
    }

    // A keyed list whose source is a store and whose server rows no item
    // claims: the store's items are shown and bound once activation is done.
    async function storeKeyed(storeItems, rows) {
        const s = 'slastore' + (++seq); const c = uname('sk')
        wildflower.store(s, { state: { items: storeItems } })
        const got = []
        wildflower.component(c, { state: {}, hit(e, el, d) { got.push(d && d.item ? d.item.title : null) } })
        const r = (k, t) => `<li${k.seed ? ` data-seed='{"id":${k.seed}}'` : ''}>${k.text !== undefined ? `<span class="k" data-bind="id">${k.text}</span>` : ''}` +
            `<span class="t" data-bind="title">${t}</span><button class="b" data-action="hit">x</button></li>`
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="$${s}.items" data-key="id">` +
            `<template>${r({ text: rows[0][0].text !== undefined ? '' : undefined }, '')}</template>${rows.map(([k, t]) => r(k, t)).join('')}</ul></div>`
        const host = container.querySelector('.host')
        wildflower.scan(container)
        await settle(200)
        return { host, got }
    }

    it('K1 a keyed $store list whose items have other keys than the server rows shows and binds the store\'s items', async () => {
        const { host, got } = await storeKeyed([{ id: 3, title: 'C' }, { id: 4, title: 'D' }], [[{ seed: 1 }, 'A'], [{ seed: 2 }, 'B']])
        expect(rowsOf(host).map(r => r.querySelector('.t').textContent)).toEqual(['C', 'D'])
        expect(rowsOf(host).map(r => r._listIndex)).toEqual([0, 1])
        rowsOf(host)[1].querySelector('.b').click()
        await settle(50)
        expect(got).toEqual(['D'])
    })

    it('K2 a keyed $store list whose server key text is formatted (1,000) shows and binds the store\'s items', async () => {
        const { host, got } = await storeKeyed([{ id: 1000, title: 'A' }, { id: 2000, title: 'B' }], [[{ text: '1,000' }, 'A'], [{ text: '2,000' }, 'B']])
        expect(rowsOf(host).map(r => r.querySelector('.k').textContent + r.querySelector('.t').textContent)).toEqual(['1000A', '2000B'])
        expect(rowsOf(host).map(r => r._listIndex)).toEqual([0, 1])
        rowsOf(host)[0].querySelector('.b').click()
        await settle(50)
        expect(got).toEqual(['A'])
    })
})

// ---------------------------------------------------------------------------
// C: nested lists in query-adopted rows
// ---------------------------------------------------------------------------

describeIfSSRQuery('SSR query rows with nested lists', () => {
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
    const plain = (v) => JSON.parse(JSON.stringify(v))
    const qname = () => uname('q').replace(/-/g, '_')

    it('C1 nested server rows over the row item land on their row and are adopted; a refresh and a patch reach them', async () => {
        const q = qname(); const c = uname('c1')
        respondWith([{ id: 1, sku: 'A1', cells: [{ v: 'a' }, { v: 'b2' }] }, { id: 2, sku: 'B2', cells: [{ v: 'c' }, { v: 'd' }] }])
        wildflower.query(q, { from: '/api/c1.json', key: 'id' })
        const cellTpl = '<template><li data-bind="v"></li></template>'
        const tr = (id, sku, vs) => `<tr data-seed='{"id":${id}}'><td class="sku" data-bind="sku">${sku}</td><td><ul class="cl" data-list="cells">${cellTpl}` +
            vs.map(v => `<li data-bind="v">${v}</li>`).join('') + '</ul></td></tr>'
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-query="${q}">` +
            `<template><tr><td class="sku" data-bind="sku"></td><td><ul class="cl" data-list="cells">${cellTpl}</ul></td></tr></template>` +
            tr(1, 'A1', ['a', 'b']) + tr(2, 'B2', ['c']) + '</tbody></table></div>'
        wildflower.component(c, { state: {} })
        const host = container.querySelector('.host')
        const cells0 = [...host.querySelectorAll('.cl li')]
        const rows0 = rowsOf(host)
        wildflower.scan(container)
        await settle(150)
        const qview = () => rowsOf(host).map(r => r.querySelector('.sku').textContent + ':' + [...r.querySelectorAll('.cl li')].map(l => l.textContent).join('|'))
        const cellIdx = () => [...host.querySelectorAll('.cl li')].map(l => cells0.indexOf(l))

        expect(plain(wildflower.getStore(q).rows)).toEqual([
            { id: 1, sku: 'A1', cells: [{ v: 'a' }, { v: 'b' }] },
            { id: 2, sku: 'B2', cells: [{ v: 'c' }] }
        ])
        expect(ctxOf(host).cells).toBeUndefined()
        expect(qview()).toEqual(['A1:a|b', 'B2:c'])

        release()
        await settle(200)
        expect(qview()).toEqual(['A1:a|b2', 'B2:c|d'])
        expect(rowsOf(host).map(r => rows0.indexOf(r))).toEqual([0, 1])
        expect(cellIdx()).toEqual([0, 1, 2, -1])

        await step(() => { wildflower.getQuery(q).patch([{ id: 1, sku: 'A1', cells: [{ v: 'a!' }, { v: 'b2' }] }]) })
        expect(qview()).toEqual(['A1:a!|b2', 'B2:c|d'])
        expect(rowsOf(host).map(r => rows0.indexOf(r))).toEqual([0, 1])
    })

    it('C2 a nested server list over a component path (settings.options) in query rows reads the component, which keeps its declared state', async () => {
        const q = qname(); const c = uname('c2')
        respondWith([{ id: 1, sku: 'A1' }, { id: 2, sku: 'B2x' }])
        wildflower.query(q, { from: '/api/c2.json', key: 'id' })
        const optTpl = '<template><li data-bind="o"></li></template>'
        const tr = (id, sku) => `<tr data-seed='{"id":${id}}'><td class="sku" data-bind="sku">${sku}</td><td><ul class="op" data-list="settings.options">${optTpl}` +
            '<li data-bind="o">p</li><li data-bind="o">q</li></ul></td></tr>'
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-query="${q}">` +
            `<template><tr><td class="sku" data-bind="sku"></td><td><ul class="op" data-list="settings.options">${optTpl}</ul></td></tr></template>` +
            tr(1, 'A1') + tr(2, 'B2') + '</tbody></table></div>'
        wildflower.component(c, { state: { settings: { mode: 'm', options: [{ o: 'p' }, { o: 'q' }] } } })
        const host = container.querySelector('.host')
        wildflower.scan(container)
        await settle(150)
        const ctx = ctxOf(host)
        const qview = () => rowsOf(host).map(r => r.querySelector('.sku').textContent + ':' + [...r.querySelectorAll('.op li')].map(l => l.textContent).join('|'))

        expect(plain(ctx.settings)).toEqual({ mode: 'm', options: [{ o: 'p' }, { o: 'q' }] })
        expect(plain(wildflower.getStore(q).rows)).toEqual([{ id: 1, sku: 'A1' }, { id: 2, sku: 'B2' }])
        expect(qview()).toEqual(['A1:p|q', 'B2:p|q'])

        await step(() => { ctx.settings.options.push({ o: 'r' }) })
        expect(qview()).toEqual(['A1:p|q|r', 'B2:p|q|r'])

        release()
        await settle(200)
        expect(qview()).toEqual(['A1:p|q|r', 'B2x:p|q|r'])
        await step(() => { ctx.settings.options[0].o = 'p!' })
        expect(qview()).toEqual(['A1:p!|q|r', 'B2x:p!|q|r'])
    })

    const cellTpl = '<template><li data-bind="v"></li></template>'
    const cellsTr = (id, sku, vs) => `<tr${id ? ` data-seed='{"id":${id}}'` : ''}>${sku ? `<td class="sku" data-bind="sku">${sku}</td>` : ''}` +
        `<td><ul class="cl" data-list="cells">${cellTpl}` + vs.map(v => `<li data-bind="v">${v}</li>`).join('') + '</ul></td></tr>'
    const cellsQuery = (c, q, rows) => `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-query="${q}">` +
        `<template><tr><td class="sku" data-bind="sku"></td><td><ul class="cl" data-list="cells">${cellTpl}</ul></td></tr></template>` +
        rows + '</tbody></table></div>'

    it.skipIf(isMinifiedBuild())('C3 a refresh that drops an adopted row takes its nested list contexts with it', async () => {
        const q = qname(); const c = uname('c3')
        respondWith([{ id: 2, sku: 'B2', cells: [{ v: 'c' }] }])
        wildflower.query(q, { from: '/api/c3.json', key: 'id' })
        wildflower.component(c, { state: {} })
        container.innerHTML = cellsQuery(c, q, cellsTr(1, 'A1', ['a', 'b']) + cellsTr(2, 'B2', ['c']))
        const host = container.querySelector('.host')
        wildflower.scan(container)
        await settle(150)
        release()
        await settle(200)
        expect(rowsOf(host).map(r => r.textContent)).toEqual(['B2c'])
        const inst = wildflower.getComponentInstance(host.dataset.componentId)
        expect([...inst._listContexts.values()].filter(cx => cx.element && !cx.element.isConnected)).toEqual([])
    })

    it('C3b positions are right after a refresh drops the first adopted row', async () => {
        const q = qname(); const c = uname('c3b')
        respondWith([{ id: 2, sku: 'B' }, { id: 3, sku: 'C' }])
        wildflower.query(q, { from: '/api/c3b.json', key: 'id' })
        wildflower.component(c, { state: {} })
        const tpl = '<tr data-bind-class="{ first: _first, last: _last }"><td class="t" data-bind="sku"></td><td class="ix" data-bind="_index"></td></tr>'
        const tr = (id, sku, i) => `<tr data-seed='{"id":${id}}' class="${i === 0 ? 'first' : ''}${i === 2 ? 'last' : ''}"><td class="t" data-bind="sku">${sku}</td><td class="ix" data-bind="_index">${i}</td></tr>`
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-query="${q}">` +
            `<template>${tpl}</template>${tr(1, 'A', 0)}${tr(2, 'B', 1)}${tr(3, 'C', 2)}</tbody></table></div>`
        const host = container.querySelector('.host')
        wildflower.scan(container)
        await settle(150)
        release()
        await settle(200)
        expect(rowsOf(host).map(r => r.querySelector('.t').textContent + '#' + r.querySelector('.ix').textContent +
            '[' + ['first', 'last'].filter(k => r.classList.contains(k)).join(' ') + ']')).toEqual(['B#0[first]', 'C#1[last]'])
    })

    it('C4 a query row that is itself a list parses its cells into the row, not their fields', async () => {
        const q = qname(); const c = uname('c4')
        respondWith([{ id: 1, cells: [{ v: 'a' }, { v: 'b2' }] }])
        wildflower.query(q, { from: '/api/c4.json', key: 'id' })
        wildflower.component(c, { state: {} })
        const tdTpl = '<template><td data-bind="v"></td></template>'
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-query="${q}">` +
            `<template><tr data-list="cells">${tdTpl}</tr></template>` +
            `<tr data-seed='{"id":1}' data-list="cells">${tdTpl}<td data-bind="v">a</td><td data-bind="v">b</td></tr></tbody></table></div>`
        const host = container.querySelector('.host')
        wildflower.scan(container)
        await settle(150)
        expect(plain(wildflower.getStore(q).rows)).toEqual([{ id: 1, cells: [{ v: 'a' }, { v: 'b' }] }])
        const cellsView = () => rowsOf(host).map(r => kids(r).map(td => td.textContent).join('|'))
        expect(cellsView()).toEqual(['a|b'])
        release()
        await settle(200)
        expect(cellsView()).toEqual(['a|b2'])
    })

    it('C5 a row with only a nested list: a keyed query does not adopt it, an unkeyed query does', async () => {
        window.fetch = () => new Promise(() => {})
        const qk = qname(); const qu = qname()
        wildflower.query(qk, { from: '/api/c5k.json', key: 'id' })
        wildflower.query(qu, { from: '/api/c5u.json' })
        const ck = uname('c5k'); const cu = uname('c5u')
        wildflower.component(ck, { state: {} })
        wildflower.component(cu, { state: {} })
        container.innerHTML = cellsQuery(ck, qk, cellsTr(1, 'A1', ['a']) + cellsTr(null, null, ['z'])) +
            cellsQuery(cu, qu, cellsTr(null, null, ['z']))
        wildflower.scan(container)
        await settle(150)
        expect(plain(wildflower.getStore(qk).rows)).toEqual([{ id: 1, sku: 'A1', cells: [{ v: 'a' }] }])
        expect(plain(wildflower.getStore(qu).rows)).toEqual([{ cells: [{ v: 'z' }] }])
    })
})
