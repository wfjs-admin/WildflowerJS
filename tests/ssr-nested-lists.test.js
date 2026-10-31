/**
 * Server-rendered (data-ssr) lists inside server-rendered list rows.
 *
 *   <div data-list="groups">
 *     <template><section><b data-bind="name"></b><p data-list="cells"><template>…</template></p></section></template>
 *     <section><b data-bind="name">G0</b>
 *       <p data-list="cells"><template>…</template><span data-bind="label">320</span>…</p>
 *     </section>
 *   </div>
 *
 * Every list container carries its own <template>, the inner containers in the
 * server rows included. Keyed rows (data-key, ids from data-seed) match by key,
 * keyless rows by position. A row may itself be a list (<tr data-list="cells">
 * under <tbody data-list="members">).
 *
 * Most cases assert node identity as well as text: `ids` maps every row, cell
 * and third-level row on the page to its index among the server-rendered nodes
 * of the same depth, so -1 is a node the framework created. A server node
 * whose item survives a change must still be on the page afterwards.
 *
 * The N cases pin what must not change for top-level server lists. Query
 * adoption keeping its nodes, two server lists over one array, and in-place
 * and immutable item edits are pinned by ssr-hydrated-list-identity,
 * render-it-twice-lists T12 and ssr-hydrated-list-item-reactivity.
 *
 * The PL cases load real pages in iframes, framework in <head> and at the end
 * of <body>, so the page-load path (template pre-compilation, the async scan,
 * the activation timer) runs as it does for a user.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild, getFrameworkScripts } from './helpers/load-framework.js'

const SSR = hasFeature('ssr') && hasFeature('lists')
const describeIfSSR = SSR ? describe : describe.skip
const DEV = hasFeature('validation')

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uname = (p) => `snl-${p}-${++seq}`

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

// Self-contained: also serialized into the iframe pages. The rows of a host's
// .outer list, each with the rows of its nested list (the row itself when the
// row is a list), recursively.
function captureTree(host) {
    var kids = function (el) { return el ? Array.prototype.filter.call(el.children, function (c) { return c.tagName !== 'TEMPLATE' }) : [] }
    var isList = function (el) { return el.hasAttribute('data-list') || el.hasAttribute('data-wf-list') }
    var innerOf = function (row) {
        if (isList(row)) return row
        for (var i = 0; i < row.children.length; i++) if (isList(row.children[i])) return row.children[i]
        return null
    }
    var node = function (el) { var inner = innerOf(el); return { el: el, sub: inner ? kids(inner).map(node) : [] } }
    return kids(host.querySelector('.outer')).map(node)
}

const kids = (el) => el ? [...el.children].filter(c => c.tagName !== 'TEMPLATE') : []

// Each current node's index among the server nodes of its depth (-1: new).
function idsOf(host, initial) {
    const flat = [[], [], []]
    const walk = (nodes, d) => { for (const n of nodes) { flat[d].push(n.el); if (d < 2) walk(n.sub, d + 1) } }
    walk(initial, 0)
    const cur = captureTree(host)
    const out = {
        rows: cur.map(n => flat[0].indexOf(n.el)),
        cells: cur.map(n => n.sub.map(s => flat[1].indexOf(s.el)))
    }
    if (flat[2].length) out.marks = cur.map(n => n.sub.map(s => s.sub.map(m => flat[2].indexOf(m.el))))
    return out
}

// 'name:cell|cell' per group row.
const groupsView = (host) => captureTree(host).map(n =>
    ((n.el.querySelector('.g') || {}).textContent ?? '') + ':' + n.sub.map(s => s.el.textContent).join('|'))
// One array of cell texts per row (rows that are lists).
const grid = (host) => captureTree(host).map(n => n.sub.map(s => s.el.textContent))
// Three levels: 'name:label[mark,mark]|…'.
const l3View = (host) => captureTree(host).map(n =>
    n.el.querySelector('.g').textContent + ':' + n.sub.map(c =>
        c.el.querySelector('.l').textContent + '[' + c.sub.map(m => m.el.textContent).join(',') + ']').join('|'))

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const INNER_TPL = '<template><span class="c" data-bind="label"></span></template>'
const G2 = [{ name: 'G0', cells: ['320', '150'] }, { name: 'G1', cells: ['0', '80'] }]
const G3 = [{ name: 'H0', cells: ['a', 'b', 'c'] }, { name: 'H1', cells: ['d', 'e', 'f'] }, { name: 'H2', cells: ['g', 'h', 'i'] }]
const G4 = [{ name: 'G0', cells: ['1', '2'] }, { name: 'G1', cells: ['3', '4'] }, { name: 'G2', cells: ['5', '6'] }, { name: 'G3', cells: ['7', '8'] }]

function groupsHtml(comp, groups, { keyed = false, extraRow = null, after = '' } = {}) {
    const k = keyed ? ' data-key="id"' : ''
    const rowTpl = `<template><section><b class="g" data-bind="name"></b><p data-list="cells"${k}>${INNER_TPL}</p>${extraRow ? extraRow.tpl : ''}</section></template>`
    const rows = groups.map((g, gi) => {
        const gseed = keyed ? ` data-seed='{"id":"g${gi}"}'` : ''
        const cells = g.cells.map((c, ci) =>
            `<span class="c" data-bind="label"${keyed ? ` data-seed='{"id":"c${gi}-${ci}"}'` : ''}>${c}</span>`).join('')
        return `<section${gseed}><b class="g" data-bind="name">${g.name}</b><p data-list="cells"${k}>${INNER_TPL}${cells}</p>${extraRow ? extraRow.row(gi) : ''}</section>`
    }).join('')
    return `<div class="host" data-component="${comp}" data-ssr="true"><div class="outer" data-list="groups"${k}>${rowTpl}${rows}</div>${after}</div>`
}

// Rows that are lists: <tr data-list="cells"> rows of <tbody data-list="members">,
// or <li data-list="cells"> rows of <ul>.
function membersHtml(comp, { table = true, memberSeeds = null, keyed = false } = {}) {
    const k = keyed ? ' data-key="id"' : ''
    const seed = (i) => memberSeeds ? ` data-seed='${JSON.stringify(memberSeeds[i])}'` : ''
    const cseed = (r, c) => keyed ? ` data-seed='{"id":"c${r}-${c}"}'` : ''
    const [outerTag, rowTag, cellTag] = table ? ['tbody', 'tr', 'td'] : ['ul', 'li', 'span']
    const cellTpl = `<template><${cellTag} data-bind="v"></${cellTag}></template>`
    const row = (r, vals) => `<${rowTag} data-list="cells"${k}${seed(r)}>${cellTpl}` +
        vals.map((v, c) => `<${cellTag} data-bind="v"${cseed(r, c)}>${v}</${cellTag}>`).join('') + `</${rowTag}>`
    const list = `<${outerTag} class="outer" data-list="members"${k}><template><${rowTag} data-list="cells"${k}>${cellTpl}</${rowTag}></template>` +
        row(0, ['1', '2']) + row(1, ['3', '4']) + `</${outerTag}>`
    return `<div class="host" data-component="${comp}" data-ssr="true">${table ? `<table>${list}</table>` : list}</div>`
}

function l3Html(comp) {
    const markTpl = '<template><em class="m" data-bind="m"></em></template>'
    const cellTpl = `<template><span class="c"><i class="l" data-bind="label"></i><u class="marks" data-list="marks">${markTpl}</u></span></template>`
    const rowTpl = `<template><section><b class="g" data-bind="name"></b><p data-list="cells">${cellTpl}</p></section></template>`
    const data = [{ name: 'G0', cells: [['a', ['a1', 'a2']], ['b', ['b1']]] }, { name: 'G1', cells: [['c', ['c1', 'c2']]] }]
    const rows = data.map(g => `<section><b class="g" data-bind="name">${g.name}</b><p data-list="cells">${cellTpl}` +
        g.cells.map(([l, ms]) => `<span class="c"><i class="l" data-bind="label">${l}</i><u class="marks" data-list="marks">${markTpl}` +
            ms.map(m => `<em class="m" data-bind="m">${m}</em>`).join('') + '</u></span>').join('') + '</p></section>').join('')
    return `<div class="host" data-component="${comp}" data-ssr="true"><div class="outer" data-list="groups">${rowTpl}${rows}</div></div>`
}

const postsHtml = (comp, titles = ['First', 'Second']) =>
    `<div class="host" data-component="${comp}" data-ssr="true"><ul class="outer" data-list="posts"><template><li><span data-bind="title"></span></li></template>` +
    titles.map(t => `<li><span data-bind="title">${t}</span></li>`).join('') + '</ul></div>'
const postsView = (host) => kids(host.querySelector('.outer')).map(li => li.textContent)

const wf = (html) => html.replace(/ data-/g, ' data-wf-')

// ---------------------------------------------------------------------------
// Scan path
// ---------------------------------------------------------------------------

describeIfSSR('SSR nested lists (scan path)', () => {
    let wildflower
    let container
    let warns
    let origWarn

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        warns = []
        origWarn = console.warn
        console.warn = (...a) => { warns.push(a.map(String).join(' ')); origWarn.apply(console, a) }
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => {
        console.warn = origWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    const wfWarns = () => warns.filter(w => /WF-\d+/.test(w))

    async function mount(html, register) {
        register()
        container.innerHTML = html
        const hosts = [...container.querySelectorAll('.host')]
        const initials = hosts.map(h => captureTree(h))
        wildflower.scan(container)
        await settle(150)
        const ctxs = hosts.map(h => wildflower.getComponentInstance(h.dataset.componentId).context)
        return { hosts, host: hosts[0], initials, initial: initials[0], ctxs, ctx: ctxs[0] }
    }
    const mountGroups = (groups = G2, opts = {}, state = { groups: [] }) => {
        const c = uname('g')
        return mount(groupsHtml(c, groups, opts), () => wildflower.component(c, { state }))
    }
    const step = async (fn) => { fn(); await settle(100) }

    // -----------------------------------------------------------------------
    // Contexts and hydration
    // -----------------------------------------------------------------------

    it('1.1 every nested list gets a child context of the outer list; the server DOM is kept at activation', async () => {
        const { host, initial, ctx } = await mountGroups()
        const outer = host.querySelector('.outer')
        const inners = kids(outer).map(r => r.querySelector(':scope > [data-list="cells"]'))
        expect(inners.map(el => !!el._listContext && el._listContext.parent === outer._listContext)).toEqual([true, true])
        expect(inners.map(el => el._ssrPhase)).toEqual(['complete', 'complete'])
        expect(ctx.groups.map(g => g.cells.map(c => c.label))).toEqual([['320', '150'], ['0', '80']])
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('1.2 an outer scalar edit, then a push into the first group', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups[0].name = 'G0x' })
        expect(groupsView(host)).toEqual(['G0x:320|150', 'G1:0|80'])
        await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
        expect(groupsView(host)).toEqual(['G0x:320|150|NEW0', 'G1:0|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3]] })
    })

    it('1.3 an outer push of a group, then edits and pushes in every group', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups.push({ name: 'G2', cells: [{ label: 'n1' }, { label: 'n2' }] }) })
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80', 'G2:n1|n2'])
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        await step(() => { ctx.groups[2].cells[0].label = 'z' })
        await step(() => { ctx.groups[2].cells.push({ label: 'n3' }) })
        await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
        expect(groupsView(host)).toEqual(['G0:x|150|NEW0', 'G1:0|80|NEW1', 'G2:z|n2|n3'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1, -1], cells: [[0, 1, -1], [2, 3, -1], [-1, -1, -1]] })
    })

    it('1.4 an immutable replacement of one of four groups, then an edit inside it', async () => {
        const { host, initial, ctx } = await mountGroups(G4)
        await step(() => { ctx.groups[0] = { name: 'R0', cells: [{ label: 'r1' }, { label: 'r2' }] } })
        expect(groupsView(host)).toEqual(['R0:r1|r2', 'G1:3|4', 'G2:5|6', 'G3:7|8'])
        await step(() => { ctx.groups[0].cells[1].label = 'r2x' })
        expect(groupsView(host)).toEqual(['R0:r1|r2x', 'G1:3|4', 'G2:5|6', 'G3:7|8'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1, 2, 3], cells: [[0, 1], [2, 3], [4, 5], [6, 7]] })
    })

    it('1.5 a child component in a server row whose list has the row list\'s name keeps its own data', async () => {
        const c = uname('e4'); const kid = c + '-kid'
        const kidRow = {
            tpl: `<div class="kid" data-component="${kid}"><ul class="things" data-list="cells"><template><li data-bind="n"></li></template></ul></div>`,
            row: () => `<div class="kid" data-component="${kid}"><ul class="things" data-list="cells"><template><li data-bind="n"></li></template><li data-bind="n">k1</li></ul></div>`
        }
        const { host, initial, ctx } = await mount(groupsHtml(c, G2, { extraRow: kidRow }), () => {
            wildflower.component(kid, { state: { cells: [{ n: 'k1' }] }, addOne() { this.cells.push({ n: 'k2' }) } })
            wildflower.component(c, { state: { groups: [] } })
        })
        const kidsView = () => [...host.querySelectorAll('.things')].map(u => kids(u).map(l => l.textContent).join('|'))
        expect(ctx.groups.map(g => g.cells.map(x => x.label))).toEqual([['320', '150'], ['0', '80']])
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        expect(kidsView()).toEqual(['k1', 'k1'])
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:0|80'])
        await step(() => { wildflower.getComponentInstance(host.querySelector('.kid').dataset.componentId).context.addOne() })
        expect(kidsView()).toEqual(['k1|k2', 'k1'])
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:0|80'])
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        await step(() => { ctx.groups.push({ name: 'G2', cells: [{ label: 'n1' }] }) })
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:0|80|NEW1', 'G2:n1'])
        expect(kidsView()).toEqual(['k1|k2', 'k1', 'k1'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1, -1], cells: [[0, 1], [2, 3, -1], [-1]] })
    })

    it('1.6 a $store list in every server row follows the store before and after the outer list is taken over', async () => {
        const c = uname('st'); const store = 'snlstore' + seq
        wildflower.store(store, { state: { items: [{ t: 'a' }, { t: 'b' }] } })
        const tagsRow = {
            tpl: `<ul class="tags" data-list="$${store}.items"><template><li data-bind="t"></li></template></ul>`,
            row: () => `<ul class="tags" data-list="$${store}.items"><template><li data-bind="t"></li></template><li data-bind="t">a</li><li data-bind="t">b</li></ul>`
        }
        const { host, initial, ctx } = await mount(groupsHtml(c, G2, { extraRow: tagsRow }), () => wildflower.component(c, { state: { groups: [] } }))
        const tags = () => [...host.querySelectorAll('.tags')].map(u => kids(u).map(l => l.textContent).join('|'))
        expect(tags()).toEqual(['a|b', 'a|b'])
        await step(() => { wildflower.getStore(store).items.push({ t: 'c' }) })
        expect(tags()).toEqual(['a|b|c', 'a|b|c'])
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80|NEW1'])
        expect(tags()).toEqual(['a|b|c', 'a|b|c'])
        await step(() => { wildflower.getStore(store).items.push({ t: 'd' }) })
        expect(tags()).toEqual(['a|b|c|d', 'a|b|c|d'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3, -1]] })
    })

    it('1.6b a $store list in every server row, with the store still empty at activation, keeps its server rows until the store loads', async () => {
        const c = uname('st0'); const store = 'snlstore0' + seq
        wildflower.store(store, { state: { items: [] } })
        const tagsRow = {
            tpl: `<ul class="tags" data-list="$${store}.items"><template><li data-bind="t"></li></template></ul>`,
            row: () => `<ul class="tags" data-list="$${store}.items"><template><li data-bind="t"></li></template><li data-bind="t">a</li><li data-bind="t">b</li></ul>`
        }
        const html = groupsHtml(c, G2, { extraRow: tagsRow })
        wildflower.component(c, { state: { groups: [] } })
        container.innerHTML = html
        const host = container.querySelector('.host')
        const initial = captureTree(host)
        const serverTags = [...host.querySelectorAll('.tags li')]
        wildflower.scan(container)
        await settle(150)
        const tags = () => [...host.querySelectorAll('.tags')].map(u => kids(u).map(l => l.textContent).join('|'))
        expect(tags()).toEqual(['a|b', 'a|b'])
        expect([...host.querySelectorAll('.tags li')].map(l => serverTags.indexOf(l))).toEqual([0, 1, 2, 3])
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
        const outer = host.querySelector('.outer')
        expect(!!outer._mapArrayInitialized).toBe(false)
        expect([...host.querySelectorAll('.tags, [data-list="cells"]')].map(el => !!el._mapArrayInitialized)).toEqual([false, false, false, false])
        await step(() => { wildflower.getStore(store).items = [{ t: 'x' }, { t: 'y' }, { t: 'z' }] })
        expect(tags()).toEqual(['x|y|z', 'x|y|z'])
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
    })

    // A nested list in the long form is read as a field of its row, not as a
    // shared source (only a path starting with $ is): hydration fills that
    // field from the server rows, and the rows do not follow the store. What
    // they do when the store loads is not pinned here.
    it('1.6c the long form external(\'store\', \'items\'), at the top level and in every server row, with the store still empty at activation, keeps its server rows until the store loads', async () => {
        const c = uname('stx'); const store = 'snlstorex' + seq
        wildflower.store(store, { state: { items: [] } })
        const list = `data-list="external('${store}', 'items')"`
        const tpl = '<template><li data-bind="t"></li></template>'
        const serverRows = '<li data-bind="t">a</li><li data-bind="t">b</li>'
        const tagsRow = {
            tpl: `<ul class="tags" ${list}>${tpl}</ul>`,
            row: () => `<ul class="tags" ${list}>${tpl}${serverRows}</ul>`
        }
        const after = `<ul class="tags top" ${list}>${tpl}${serverRows}</ul>`
        const html = groupsHtml(c, G2, { extraRow: tagsRow, after })
        wildflower.component(c, { state: { groups: [] } })
        container.innerHTML = html
        const host = container.querySelector('.host')
        const initial = captureTree(host)
        const serverTags = [...host.querySelectorAll('.tags li')]
        wildflower.scan(container)
        await settle(150)
        const tags = () => [...host.querySelectorAll('.tags')].map(u => kids(u).map(l => l.textContent).join('|'))
        expect(tags()).toEqual(['a|b', 'a|b', 'a|b'])
        expect([...host.querySelectorAll('.tags li')].map(l => serverTags.indexOf(l))).toEqual([0, 1, 2, 3, 4, 5])
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
        const outer = host.querySelector('.outer')
        expect(!!outer._mapArrayInitialized).toBe(false)
        expect([...host.querySelectorAll('.tags, [data-list="cells"]')].map(el => !!el._mapArrayInitialized)).toEqual([false, false, false, false, false])
        await step(() => { wildflower.getStore(store).items = [{ t: 'x' }, { t: 'y' }, { t: 'z' }] })
        expect(kids(host.querySelector('.top')).map(l => l.textContent)).toEqual(['x', 'y', 'z'])
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
    })

    it('1.7 a top-level list named like the nested lists keeps its own data', async () => {
        const c = uname('top')
        const after = '<div class="top" data-list="cells"><template><i class="t" data-bind="label"></i></template><i class="t" data-bind="label">top</i></div>'
        const { host, initial, ctx } = await mount(groupsHtml(c, G2, { after }), () => wildflower.component(c, { state: { groups: [], cells: [] } }))
        const top = () => [...host.querySelectorAll('.top .t')].map(e => e.textContent)
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        expect(top()).toEqual(['top'])
        await step(() => { wildflower.scan(container) })
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        expect(top()).toEqual(['top'])
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:0|80'])
        expect(top()).toEqual(['top'])
        await step(() => { ctx.cells[0].label = 'T' })
        expect(top()).toEqual(['T'])
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:0|80'])
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:0|80|NEW1'])
        expect(top()).toEqual(['T'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3, -1]] })
    })

    it('1.8 a nested list the server rendered with no rows takes a push', async () => {
        const { host, initial, ctx } = await mountGroups([{ name: 'G0', cells: ['320'] }, { name: 'G1', cells: [] }])
        expect(groupsView(host)).toEqual(['G0:320', 'G1:'])
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        expect(groupsView(host)).toEqual(['G0:320', 'G1:NEW1'])
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
        expect(groupsView(host)).toEqual(['G0:x|NEW0', 'G1:NEW1'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, -1], [-1]] })
    })

    it('1.9 every attribute with the data-wf- prefix', async () => {
        const c = uname('wf')
        const { host, initial, ctx } = await mount(wf(groupsHtml(c, G2)), () => wildflower.component(c, { state: { groups: [] } }))
        const outer = host.querySelector('.outer')
        expect(kids(outer).map(r => r.querySelector(':scope > [data-wf-list]')._listContext.parent === outer._listContext)).toEqual([true, true])
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        expect(groupsView(host)).toEqual(['G0:x|150|NEW0', 'G1:0|80|NEW1'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3, -1]] })
    })

    // -----------------------------------------------------------------------
    // Change signal
    // -----------------------------------------------------------------------

    it('2.1 edits inside the first and the second group', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:0|80'])
        await step(() => { ctx.groups[1].cells[0].label = 'y' })
        expect(groupsView(host)).toEqual(['G0:x|150', 'G1:y|80'])
        await step(() => { ctx.groups[0].cells[1].label = 'z' })
        expect(groupsView(host)).toEqual(['G0:x|z', 'G1:y|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('2.2a pushes into the first group, then the second', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
        expect(groupsView(host)).toEqual(['G0:320|150|NEW0', 'G1:0|80'])
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        expect(groupsView(host)).toEqual(['G0:320|150|NEW0', 'G1:0|80|NEW1'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3, -1]] })
    })

    it('2.2b pushes into the second group, then the first', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80|NEW1'])
        await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
        expect(groupsView(host)).toEqual(['G0:320|150|NEW0', 'G1:0|80|NEW1'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3, -1]] })
    })

    it('2.3 removing the first and the last item of each group', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups[0].cells.splice(0, 1) })
        expect(groupsView(host)).toEqual(['G0:150', 'G1:0|80'])
        await step(() => { ctx.groups[1].cells.splice(1, 1) })
        expect(groupsView(host)).toEqual(['G0:150', 'G1:0'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0], [2]] })
        await step(() => { ctx.groups[0].cells.splice(0, 1) })
        await step(() => { ctx.groups[1].cells.splice(0, 1) })
        expect(groupsView(host)).toEqual(['G0:', 'G1:'])
        await step(() => { ctx.groups[0].cells.push({ label: 'again' }) })
        expect(groupsView(host)).toEqual(['G0:again', 'G1:'])
    })

    it('2.4 replacing a nested array with a same-length, a longer and a shorter one', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups[1].cells = [{ label: 'q1' }, { label: 'q2' }] })
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:q1|q2'])
        await step(() => { ctx.groups[0].cells = [{ label: 'r1' }, { label: 'r2' }, { label: 'r3' }] })
        expect(groupsView(host)).toEqual(['G0:r1|r2|r3', 'G1:q1|q2'])
        await step(() => { ctx.groups[1].cells = [{ label: 's1' }] })
        expect(groupsView(host)).toEqual(['G0:r1|r2|r3', 'G1:s1'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2]] })
    })

    it('2.5 keyed: edits, pushes and a reverse keep each server node with its key', async () => {
        const { host, initial, ctx } = await mountGroups(G2, { keyed: true })
        expect(ctx.groups.map(g => [g.id, g.cells.map(x => x.id)])).toEqual([['g0', ['c0-0', 'c0-1']], ['g1', ['c1-0', 'c1-1']]])
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        await step(() => { ctx.groups[1].cells[0].label = 'y' })
        await step(() => { ctx.groups[0].cells.push({ id: 'n0', label: 'NEW0' }) })
        await step(() => { ctx.groups[1].cells.push({ id: 'n1', label: 'NEW1' }) })
        await step(() => { ctx.groups[0].cells.reverse() })
        expect(groupsView(host)).toEqual(['G0:NEW0|150|x', 'G1:y|80|NEW1'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[-1, 1, 0], [2, 3, -1]] })
    })

    it('2.6 nested edits inside wildflower.batch() are painted, and so is a later edit outside it', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => wildflower.batch(() => { ctx.groups[0].cells[0].label = 'bx'; ctx.groups[1].cells[1].label = 'by' }))
        expect(groupsView(host)).toEqual(['G0:bx|150', 'G1:0|by'])
        await step(() => { ctx.groups[1].cells[0].label = 'after' })
        expect(groupsView(host)).toEqual(['G0:bx|150', 'G1:after|by'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('2.6b a cancelled batch paints nothing until the next write', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { const b = wildflower.startBatch(); ctx.groups[0].cells[0].label = 'cx'; b.cancel() })
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        await step(() => { ctx.groups[1].cells[0].label = 'after' })
        expect(groupsView(host)).toEqual(['G0:cx|150', 'G1:after|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('2.8 an inner edit to an empty string clears the cell', async () => {
        const { host, initial, ctx } = await mountGroups()
        await step(() => { ctx.groups[0].cells[0].label = '' })
        expect(groupsView(host)).toEqual(['G0:|150', 'G1:0|80'])
        await step(() => { ctx.groups[1].cells[1].label = '' })
        expect(groupsView(host)).toEqual(['G0:|150', 'G1:0|'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('2.9 three levels: edits and pushes at the second and the third level', async () => {
        const c = uname('l3')
        const { host, initial, ctx } = await mount(l3Html(c), () => wildflower.component(c, { state: { groups: [] } }))
        expect(l3View(host)).toEqual(['G0:a[a1,a2]|b[b1]', 'G1:c[c1,c2]'])
        await step(() => { ctx.groups[0].cells[1].marks[0].m = 'X' })
        expect(l3View(host)).toEqual(['G0:a[a1,a2]|b[X]', 'G1:c[c1,c2]'])
        await step(() => { ctx.groups[1].cells[0].marks.push({ m: 'N' }) })
        await step(() => { ctx.groups[1].cells[0].label = 'C' })
        await step(() => { ctx.groups[0].cells.push({ label: 'z', marks: [{ m: 'z1' }] }) })
        await step(() => { ctx.groups[0].cells[0].marks.push({ m: 'a3' }) })
        expect(l3View(host)).toEqual(['G0:a[a1,a2,a3]|b[X]|z[z1]', 'G1:C[c1,c2,N]'])
        expect(idsOf(host, initial)).toEqual({
            rows: [0, 1],
            cells: [[0, 1, -1], [2]],
            marks: [[[0, 1, -1], [2], [-1]], [[3, 4, -1]]]
        })
    })

    it('2.10 init() pushes into one nested array and edits another before activation', async () => {
        const c = uname('init')
        const { host, initial } = await mount(groupsHtml(c, G2), () => wildflower.component(c, {
            state: { groups: [] },
            init() { this.groups[0].cells.push({ label: 'NEW0' }); this.groups[1].cells[0].label = 'E1' }
        }))
        expect(groupsView(host)).toEqual(['G0:320|150|NEW0', 'G1:E1|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3]] })
    })

    it('2.11a init() pushes into a top-level server list before activation', async () => {
        const c = uname('initp')
        const { host, initial } = await mount(postsHtml(c), () => wildflower.component(c, {
            state: { posts: [] }, init() { this.posts.push({ title: 'Third' }) }
        }))
        expect(postsView(host)).toEqual(['First', 'Second', 'Third'])
        expect(idsOf(host, initial).rows).toEqual([0, 1, -1])
    })

    it('2.11b init() removes a row from a top-level server list before activation', async () => {
        const c = uname('inits')
        const { host, initial } = await mount(postsHtml(c), () => wildflower.component(c, {
            state: { posts: [] }, init() { this.posts.splice(1, 1) }
        }))
        expect(postsView(host)).toEqual(['First'])
        expect(idsOf(host, initial).rows).toEqual([0])
    })

    // A computed source can lag the server markup until its data loads, as a
    // $store source can: the takeover at activation is for plain state arrays.
    // What such a list does when the computed's data arrives is not pinned here.
    for (const form of ['computed:shown', 'shown']) {
        it(`2.12 a server list over a computed that is empty at activation keeps its server rows (data-list="${form}")`, async () => {
            const c = uname('cmp')
            const html = postsHtml(c).replace('data-list="posts"', `data-list="${form}"`)
            const { host, initial } = await mount(html, () => wildflower.component(c, {
                state: { posts: [] },
                computed: { shown() { return this.posts } }
            }))
            expect(postsView(host)).toEqual(['First', 'Second'])
            expect(idsOf(host, initial).rows).toEqual([0, 1])
            expect(!!host.querySelector('.outer')._mapArrayInitialized).toBe(false)
        })
    }

    it('2.12b a server list over a dotted path whose head is a computed, empty at activation, keeps its server rows (data-list="menu.items")', async () => {
        const c = uname('cmpd')
        const html = postsHtml(c).replace('data-list="posts"', 'data-list="menu.items"')
        const { host, initial } = await mount(html, () => wildflower.component(c, {
            state: { posts: [] },
            computed: { menu() { return { items: this.posts } } }
        }))
        expect(postsView(host)).toEqual(['First', 'Second'])
        expect(idsOf(host, initial).rows).toEqual([0, 1])
        expect(!!host.querySelector('.outer')._mapArrayInitialized).toBe(false)
    })

    // -----------------------------------------------------------------------
    // Several instances of one component
    // -----------------------------------------------------------------------

    async function twoInstances(a, b) {
        const c = uname('two')
        return mount(groupsHtml(c, a) + groupsHtml(c, b), () => wildflower.component(c, { state: { groups: [] } }))
    }

    it('3.1 the second instance (3×3) hydrates every nested list before any write', async () => {
        const { hosts, initials: initial } = await twoInstances(G2, G3)
        const outer = hosts[1].querySelector('.outer')
        const inners = kids(outer).map(r => r.querySelector(':scope > [data-list="cells"]'))
        expect(inners.map(el => !!el._listContext && el._listContext.parent === outer._listContext)).toEqual([true, true, true])
        expect(groupsView(hosts[1])).toEqual(['H0:a|b|c', 'H1:d|e|f', 'H2:g|h|i'])
        expect(idsOf(hosts[1], initial[1])).toEqual({ rows: [0, 1, 2], cells: [[0, 1, 2], [3, 4, 5], [6, 7, 8]] })
    })

    it('3.2 / 3.4 writes in the second instance\'s third group keep its nodes and leave the first instance alone', async () => {
        const { hosts, initials: initial, ctxs } = await twoInstances(G2, G3)
        await step(() => { ctxs[1].groups[2].cells[0].label = 'Z' })
        await step(() => { ctxs[1].groups[2].cells.push({ label: 'N2' }) })
        await step(() => { ctxs[1].groups[1].cells[0].label = 'Y' })
        await step(() => { ctxs[1].groups[0].cells.push({ label: 'N0' }) })
        expect(groupsView(hosts[1])).toEqual(['H0:a|b|c|N0', 'H1:Y|e|f', 'H2:Z|h|i|N2'])
        expect(idsOf(hosts[1], initial[1])).toEqual({ rows: [0, 1, 2], cells: [[0, 1, 2, -1], [3, 4, 5], [6, 7, 8, -1]] })
        expect(groupsView(hosts[0])).toEqual(['G0:320|150', 'G1:0|80'])
        expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('3.3 a second instance with fewer groups than the first', async () => {
        const { hosts, initials: initial, ctxs } = await twoInstances(G3, G2)
        await step(() => { ctxs[1].groups[1].cells[0].label = 'Y' })
        await step(() => { ctxs[1].groups[0].cells.push({ label: 'N0' }) })
        expect(groupsView(hosts[1])).toEqual(['G0:320|150|N0', 'G1:Y|80'])
        expect(idsOf(hosts[1], initial[1])).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3]] })
        expect(groupsView(hosts[0])).toEqual(['H0:a|b|c', 'H1:d|e|f', 'H2:g|h|i'])
    })

    it('3.5 two instances, each with a child component in its server rows: the child\'s list is the child\'s', async () => {
        const c = uname('kid2'); const kid = c + '-kid'
        const kidRow = {
            tpl: `<div class="kid" data-component="${kid}"><ul class="things" data-list="things"><template><li data-bind="n"></li></template></ul></div>`,
            row: () => `<div class="kid" data-component="${kid}"><ul class="things" data-list="things"><template><li data-bind="n"></li></template><li data-bind="n">k1</li></ul></div>`
        }
        const { hosts, initials: initial, ctxs } = await mount(groupsHtml(c, G2, { extraRow: kidRow }) + groupsHtml(c, G3, { extraRow: kidRow }), () => {
            wildflower.component(kid, { state: { things: [{ n: 'k1' }] }, addOne() { this.things.push({ n: 'k2' }) } })
            wildflower.component(c, { state: { groups: [] } })
        })
        const things = (h) => [...h.querySelectorAll('.things')].map(u => kids(u).map(l => l.textContent).join('|'))
        expect(things(hosts[0])).toEqual(['k1', 'k1'])
        expect(things(hosts[1])).toEqual(['k1', 'k1', 'k1'])
        expect([...container.querySelectorAll('.things')].map(u => !!u._listContext && !u._listContext.parent)).toEqual([true, true, true, true, true])
        const lastKid = hosts[1].querySelectorAll('.kid')[2]
        await step(() => { wildflower.getComponentInstance(lastKid.dataset.componentId).context.addOne() })
        expect(things(hosts[1])).toEqual(['k1', 'k1', 'k1|k2'])
        expect(things(hosts[0])).toEqual(['k1', 'k1'])
        await step(() => { ctxs[1].groups[2].cells.push({ label: 'N2' }) })
        expect(groupsView(hosts[1])).toEqual(['H0:a|b|c', 'H1:d|e|f', 'H2:g|h|i|N2'])
        expect(things(hosts[1])).toEqual(['k1', 'k1', 'k1|k2'])
        expect(idsOf(hosts[1], initial[1])).toEqual({ rows: [0, 1, 2], cells: [[0, 1, 2], [3, 4, 5], [6, 7, 8, -1]] })
    })

    it('3.6 polymorphic rows in a different order per instance: no stray list, and the real nested list hydrates', async () => {
        const c = uname('poly')
        const tplA = `<template data-type="a"><section><b class="g" data-bind="name"></b><p data-list="cells">${INNER_TPL}</p></section></template>`
        const tplB = `<template data-type="b"><section><b class="g" data-bind="name"></b><em class="note" data-bind="note"></em></section></template>`
        const html = (k) => `<div class="host" data-component="${c}" data-ssr="true"><div class="outer" data-list="groups" data-template-key="kind">${tplA}${tplB}` +
            k.map((x, i) => x === 'a'
                ? `<section data-seed='{"kind":"a"}'><b class="g" data-bind="name">A${i}</b><p data-list="cells">${INNER_TPL}<span class="c" data-bind="label">x${i}</span><span class="c" data-bind="label">y${i}</span></p></section>`
                : `<section data-seed='{"kind":"b"}'><b class="g" data-bind="name">B${i}</b><em class="note" data-bind="note">note${i}</em></section>`).join('') + '</div></div>'
        const { hosts, ctxs } = await mount(html(['a', 'b']) + html(['b', 'a']), () => wildflower.component(c, { state: { groups: [] } }))
        const note = hosts[1].querySelector('.note')
        expect(note.textContent).toBe('note0')
        expect(!!note._listContext).toBe(false)
        const realInner = hosts[1].querySelector('p[data-list]')
        expect(!!realInner._listContext && realInner._listContext.parent === hosts[1].querySelector('.outer')._listContext).toBe(true)
        if (DEV) expect(wfWarns()).toEqual([])
        await step(() => { ctxs[1].groups[1].cells[0].label = 'EDIT' })
        expect(kids(hosts[1].querySelector('.outer')).map(r => r.textContent)).toEqual(['B0note0', 'A1EDITy1'])
        expect(kids(hosts[0].querySelector('.outer')).map(r => r.textContent)).toEqual(['A0x0y0', 'B1note1'])
    })

    it('3.7 a client-rendered component with nested lists is unchanged', async () => {
        const c = uname('client')
        wildflower.component(c, { state: { groups: [{ name: 'C0', cells: [{ label: 'a' }] }, { name: 'C1', cells: [] }] } })
        container.innerHTML = `<div class="host" data-component="${c}"><div class="outer" data-list="groups"><template><section><b class="g" data-bind="name"></b><p data-list="cells">${INNER_TPL}</p></section></template></div></div>`
        wildflower.scan(container)
        await settle(150)
        const host = container.querySelector('.host')
        const ctx = wildflower.getComponentInstance(host.dataset.componentId).context
        expect(groupsView(host)).toEqual(['C0:a', 'C1:'])
        const cell = host.querySelector('.c')
        await step(() => { ctx.groups[0].cells[0].label = 'x' })
        await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
        await step(() => { ctx.groups.push({ name: 'C2', cells: [{ label: 'z' }] }) })
        expect(groupsView(host)).toEqual(['C0:x', 'C1:NEW1', 'C2:z'])
        expect(host.querySelector('.c')).toBe(cell)
        if (DEV) expect(wfWarns()).toEqual([])
    })

    // -----------------------------------------------------------------------
    // Development diagnostics
    // -----------------------------------------------------------------------

    it.skipIf(!DEV)('4.1 nested server lists raise no WF-509', async () => {
        await mountGroups()
        await mountGroups(G3)
        expect(warns.filter(w => /WF-509/.test(w))).toEqual([])
    })

    it.skipIf(!DEV)('4.2 server rows that are lists raise no WF-509', async () => {
        const c = uname('ril509')
        await mount(membersHtml(c), () => wildflower.component(c, { state: { members: [] } }))
        expect(warns.filter(w => /WF-509/.test(w))).toEqual([])
    })

    it.skipIf(!DEV)('4.3 a top-level list naming a missing state field still raises WF-509', async () => {
        const c = uname('w509')
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}"><ul data-list="nope"><template><li></li></template></ul></div>`
        wildflower.scan(container)
        await settle(100)
        expect(warns.some(w => /WF-509/.test(w) && /nope/.test(w))).toBe(true)
    })

    // -----------------------------------------------------------------------
    // Rows that are lists
    // -----------------------------------------------------------------------

    const mountMembers = (opts = {}, def = {}) => {
        const c = uname('ril')
        const html = opts.wfPrefix ? wf(membersHtml(c, opts)) : membersHtml(c, opts)
        return mount(html, () => wildflower.component(c, { state: { members: [] }, ...def }))
    }

    it('5.1 the parse puts each row\'s cells into its member, keyless and keyed, with either prefix', async () => {
        const plain = await mountMembers()
        expect(plain.ctx.members.map(m => m.cells.map(x => x.v))).toEqual([['1', '2'], ['3', '4']])
        const keyed = await mountMembers({ keyed: true, memberSeeds: [{ id: 'm0' }, { id: 'm1' }] })
        expect(keyed.ctx.members.map(m => [m.id, m.cells.map(x => x.id + '=' + x.v)])).toEqual([['m0', ['c0-0=1', 'c0-1=2']], ['m1', ['c1-0=3', 'c1-1=4']]])
        const prefixed = await mountMembers({ wfPrefix: true, keyed: true, memberSeeds: [{ id: 'm0' }, { id: 'm1' }] })
        expect(prefixed.ctx.members.map(m => [m.id, m.cells.map(x => x.id + '=' + x.v)])).toEqual([['m0', ['c0-0=1', 'c0-1=2']], ['m1', ['c1-0=3', 'c1-1=4']]])
    })

    it('5.2 the cell text survives the mount: synchronously, after a tick, and after activation', async () => {
        const c = uname('ril52')
        wildflower.component(c, { state: { members: [] } })
        container.innerHTML = membersHtml(c)
        const host = container.querySelector('.host')
        wildflower.scan(container)
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
        await settle(0)
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
        await settle(150)
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
    })

    it('5.3 each row\'s inner list is a child context of the outer list at its row index', async () => {
        const { host } = await mountMembers()
        const outer = host.querySelector('.outer')
        const rows = kids(outer)
        expect(rows.map(r => !!r._listContext && r._listContext.parent === outer._listContext)).toEqual([true, true])
        expect(rows.map(r => r._listIndex)).toEqual([0, 1])
        if (!isMinifiedBuild()) expect(rows.map(r => r._listContext._parentIndex)).toEqual([0, 1])
    })

    it('5.4 an inner edit repaints its cell', async () => {
        const { host, initial, ctx } = await mountMembers()
        await step(() => { ctx.members[0].cells[0].v = 'x' })
        expect(grid(host)).toEqual([['x', '2'], ['3', '4']])
        await step(() => { ctx.members[1].cells[1].v = 'y' })
        expect(grid(host)).toEqual([['x', '2'], ['3', 'y']])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('5.5 an inner push, an outer push, then an inner edit', async () => {
        const { host, initial, ctx } = await mountMembers()
        await step(() => { ctx.members[1].cells.push({ v: 'N' }) })
        expect(grid(host)).toEqual([['1', '2'], ['3', '4', 'N']])
        await step(() => { ctx.members.push({ cells: [{ v: 'p1' }, { v: 'p2' }] }) })
        expect(grid(host)).toEqual([['1', '2'], ['3', '4', 'N'], ['p1', 'p2']])
        await step(() => { ctx.members[0].cells[1].v = 'w' })
        expect(grid(host)).toEqual([['1', 'w'], ['3', '4', 'N'], ['p1', 'p2']])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1, -1], cells: [[0, 1], [2, 3, -1], [-1, -1]] })
    })

    it('5.6 an action in a cell gets the cell as its item and the row as its parent, before and after the takeover', async () => {
        const seen = []
        const c = uname('ril56')
        const cellTpl = '<template><td><button data-action="pick" data-bind="v"></button></td></template>'
        const row = (key, vals) => `<tr data-list="cells" data-seed='{"key":"${key}"}'>${cellTpl}` +
            vals.map(v => `<td><button data-action="pick" data-bind="v">${v}</button></td>`).join('') + '</tr>'
        const html = `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-list="members">` +
            `<template><tr data-list="cells">${cellTpl}</tr></template>${row('ana', ['1', '2'])}${row('ben', ['3', '4'])}</tbody></table></div>`
        const { host, ctx } = await mount(html, () => wildflower.component(c, {
            state: { members: [] },
            pick(event, element, details) {
                seen.push([details.item.v, details.index, details.parent && details.parent.item.key, details.parent && details.parent.index])
            }
        }))
        let buttons = host.querySelectorAll('button')
        buttons[3].click()
        buttons[0].click()
        await settle(50)
        expect(seen).toEqual([['4', 1, 'ben', 1], ['1', 0, 'ana', 0]])
        await step(() => { ctx.members.push({ key: 'cara', cells: [{ v: '5' }] }) })
        seen.length = 0
        buttons = host.querySelectorAll('button')
        expect(buttons.length).toBe(5)
        buttons[1].click()
        buttons[4].click()
        await settle(50)
        expect(seen).toEqual([['2', 1, 'ana', 0], ['5', 0, 'cara', 2]])
    })

    it('5.7 a binding and an action on the row root read the outer item', async () => {
        const seen = []
        const c = uname('ril57')
        const cellTpl = '<template><td data-bind="v"></td></template>'
        const row = (seed, vals) => `<tr data-list="cells" data-seed='${JSON.stringify(seed)}' data-bind-attr="{ title: name }" data-action="pickRow" title="${seed.name}">${cellTpl}` +
            vals.map(v => `<td data-bind="v">${v}</td>`).join('') + '</tr>'
        const html = `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-list="members">` +
            `<template><tr data-list="cells" data-bind-attr="{ title: name }" data-action="pickRow">${cellTpl}</tr></template>` +
            `${row({ key: 'ana', name: 'Ana' }, ['1', '2'])}${row({ key: 'ben', name: 'Ben' }, ['3', '4'])}</tbody></table></div>`
        const { host, initial, ctx } = await mount(html, () => wildflower.component(c, {
            state: { members: [] },
            pickRow(event, element, details) { seen.push([details.item.key, details.index]) }
        }))
        const rows = () => [...host.querySelectorAll('tbody > tr')]
        expect(rows().map(r => r.title)).toEqual(['Ana', 'Ben'])
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
        rows()[1].click()
        host.querySelectorAll('td')[0].click()
        await settle(50)
        expect(seen).toEqual([['ben', 1], ['ana', 0]])
        await step(() => { ctx.members[0].name = 'Anna' })
        expect(rows().map(r => r.title)).toEqual(['Anna', 'Ben'])
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
        seen.length = 0
        rows()[1].click()
        host.querySelectorAll('td')[1].click()
        await settle(50)
        expect(seen).toEqual([['ben', 1], ['ana', 0]])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it('5.8 three levels, each row the container of the next', async () => {
        const c = uname('ril58')
        const spanTpl = '<template><span data-bind="t"></span></template>'
        const lcTpl = `<template><div class="lc" data-list="c">${spanTpl}</div></template>`
        const html = `<div class="host" data-component="${c}" data-ssr="true"><div class="outer la" data-list="a">` +
            `<template><div class="lb" data-list="b">${lcTpl}</div></template>` +
            `<div class="lb" data-list="b">${lcTpl}` +
            `<div class="lc" data-list="c">${spanTpl}<span data-bind="t">x</span><span data-bind="t">y</span></div>` +
            `<div class="lc" data-list="c">${spanTpl}<span data-bind="t">z</span></div>` +
            '</div></div></div>'
        const { host, initial, ctx } = await mount(html, () => wildflower.component(c, { state: { a: [] } }))
        const read = () => [...host.querySelectorAll('.la > .lb > .lc')].map(r => kids(r).map(s => s.textContent))
        expect(ctx.a.map(x => x.b.map(y => y.c.map(z => z.t)))).toEqual([[['x', 'y'], ['z']]])
        expect(read()).toEqual([['x', 'y'], ['z']])
        await step(() => { ctx.a[0].b[1].c.push({ t: 'w' }) })
        await step(() => { ctx.a[0].b[0].c[1].t = 'y2' })
        expect(read()).toEqual([['x', 'y2'], ['z', 'w']])
        expect(idsOf(host, initial)).toEqual({ rows: [0], cells: [[0, 1]], marks: [[[0, 1], [2, -1]]] })
    })

    it('5.9 a member and its cells share a field name: the cells show cell values', async () => {
        const { host, initial, ctx } = await mountMembers({ memberSeeds: [{ v: 'M0' }, { v: 'M1' }] })
        expect(ctx.members.map(m => m.v)).toEqual(['M0', 'M1'])
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
        await step(() => { ctx.members[0] = { v: 'MZ', cells: [{ v: 'k1' }, { v: 'k2' }] } })
        expect(grid(host)).toEqual([['k1', 'k2'], ['3', '4']])
        await step(() => { ctx.members[1].cells[0].v = 'q' })
        expect(grid(host)).toEqual([['k1', 'k2'], ['q', '4']])
        expect(idsOf(host, initial).rows).toEqual([0, 1])
    })

    it('5.10 rows that are lists outside a table (<li data-list>)', async () => {
        const { host, initial, ctx } = await mountMembers({ table: false })
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
        await step(() => { ctx.members[0].cells[0].v = 'x' })
        await step(() => { ctx.members[1].cells.push({ v: 'N' }) })
        await step(() => { ctx.members.push({ cells: [{ v: 'p1' }] }) })
        expect(grid(host)).toEqual([['x', '2'], ['3', '4', 'N'], ['p1']])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1, -1], cells: [[0, 1], [2, 3, -1], [-1]] })
    })

    it('5.11 rows that are lists with the data-wf- prefix', async () => {
        const { host, initial, ctx } = await mountMembers({ wfPrefix: true })
        expect(grid(host)).toEqual([['1', '2'], ['3', '4']])
        await step(() => { ctx.members[0].cells[0].v = 'x' })
        await step(() => { ctx.members[1].cells.push({ v: 'N' }) })
        await step(() => { ctx.members.push({ cells: [{ v: 'p1' }] }) })
        expect(grid(host)).toEqual([['x', '2'], ['3', '4', 'N'], ['p1']])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1, -1], cells: [[0, 1], [2, 3, -1], [-1]] })
    })

    // -----------------------------------------------------------------------
    // Top-level server lists: what must not change
    // -----------------------------------------------------------------------

    it('N1 an in-place edit patches the server rows as the same nodes', async () => {
        const c = uname('n1')
        const { host, initial, ctx } = await mount(postsHtml(c, ['A', 'B', 'C']), () => wildflower.component(c, { state: { posts: [] } }))
        await step(() => { ctx.posts[0].title = 'A!' })
        expect(postsView(host)).toEqual(['A!', 'B', 'C'])
        expect(idsOf(host, initial).rows).toEqual([0, 1, 2])
    })

    it('N2 an immutable replacement of one of four rows', async () => {
        const c = uname('n2')
        const { host, initial, ctx } = await mount(postsHtml(c, ['A', 'B', 'C', 'D']), () => wildflower.component(c, { state: { posts: [] } }))
        await step(() => { ctx.posts[1] = { title: 'B!' } })
        expect(postsView(host)).toEqual(['A', 'B!', 'C', 'D'])
        expect(idsOf(host, initial).rows).toEqual([0, 1, 2, 3])
        // The route this write takes (sparse update, no takeover) is unchanged.
        expect(!!host.querySelector('.outer')._mapArrayInitialized).toBe(false)
    })

    for (const where of ['root', 'child']) {
        it(`N11 an immutable replacement of one of four rows repaints a binding on the row's ${where} element`, async () => {
            const c = uname('n11')
            const row = (t) => where === 'root' ? `<li data-bind="title">${t}</li>` : `<li><span data-bind="title">${t}</span></li>`
            const html = `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="posts"><template>${row('')}</template>` +
                ['A', 'B', 'C', 'D'].map(row).join('') + '</ul></div>'
            const { host, initial, ctx } = await mount(html, () => wildflower.component(c, { state: { posts: [] } }))
            await step(() => { ctx.posts[1] = { title: 'B!' } })
            expect(ctx.posts[1].title).toBe('B!')
            expect(postsView(host)).toEqual(['A', 'B!', 'C', 'D'])
            expect(idsOf(host, initial).rows).toEqual([0, 1, 2, 3])
        })
    }

    it('N3 with no write after activation no list is taken over', async () => {
        const { host } = await mountGroups()
        await settle(150)
        const outer = host.querySelector('.outer')
        expect(!!outer._mapArrayInitialized).toBe(false)
        expect(kids(outer).map(r => !!r.querySelector('[data-list]')._mapArrayInitialized)).toEqual([false, false])
    })

    it('N4 a write to a component scalar takes no list over', async () => {
        const c = uname('n4')
        const html = groupsHtml(c, G2).replace('<div class="outer"', '<h2 class="title" data-bind="title">T</h2><div class="outer"')
        const { host, initial, ctx } = await mount(html, () => wildflower.component(c, { state: { groups: [], title: '' } }))
        await step(() => { ctx.title = 'T2' })
        expect(host.querySelector('.title').textContent).toBe('T2')
        expect(!!host.querySelector('.outer')._mapArrayInitialized).toBe(false)
        expect(groupsView(host)).toEqual(['G0:320|150', 'G1:0|80'])
        expect(idsOf(host, initial)).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
    })

    it.skipIf(!hasFeature('query'))('N8 query-adopted rows with nested lists: the server text until the refresh, the fetched data after it', async () => {
        const realFetch = window.fetch
        let release
        window.fetch = () => new Promise(res => {
            release = () => res(new Response(JSON.stringify([
                { id: 1, sku: 'A1', tags: [{ t: 'x' }, { t: 'y2' }] }, { id: 2, sku: 'B2', tags: [{ t: 'z' }] }
            ]), { headers: { 'Content-Type': 'application/json' } }))
        })
        try {
            const q = uname('q').replace(/-/g, '_'); const c = uname('qc')
            wildflower.query(q, { from: '/api/nested.json', key: 'id' })
            const tagsTpl = '<template><li data-bind="t"></li></template>'
            container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><table><tbody class="outer" data-query="${q}">` +
                `<template><tr><td class="sku" data-bind="sku"></td><td><ul class="tg" data-list="tags">${tagsTpl}</ul></td></tr></template>` +
                `<tr data-seed='{"id":1}'><td class="sku" data-bind="sku">A1</td><td><ul class="tg" data-list="tags">${tagsTpl}<li data-bind="t">x</li><li data-bind="t">y</li></ul></td></tr>` +
                `<tr data-seed='{"id":2}'><td class="sku" data-bind="sku">B2</td><td><ul class="tg" data-list="tags">${tagsTpl}<li data-bind="t">z</li></ul></td></tr>` +
                '</tbody></table></div>'
            wildflower.component(c, { state: {} })
            wildflower.scan(container)
            await settle(150)
            const host = container.querySelector('.host')
            const view = () => [...host.querySelectorAll('tbody tr')].map(r =>
                r.querySelector('.sku').textContent + ':' + [...r.querySelectorAll('.tg li')].map(l => l.textContent).join('|'))
            expect(view()).toEqual(['A1:x|y', 'B2:z'])
            const before = [...host.querySelectorAll('.tg li')]
            release()
            await settle(200)
            expect(view()).toEqual(['A1:x|y2', 'B2:z'])
            // The query's parse carries each row's nested array, so the
            // nested rows are adopted and patched in place.
            expect([...host.querySelectorAll('.tg li')].map(l => before.indexOf(l))).toEqual([0, 1, 2])
        } finally {
            window.fetch = realFetch
        }
    })

    it('N10 a write into a nested object of a top-level server row repaints the row', async () => {
        const c = uname('n10')
        const html = `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="posts">` +
            '<template><li><span class="t" data-bind="title"></span> <em class="col" data-bind="meta.color"></em></li></template>' +
            '<li><span class="t" data-bind="title">A</span> <em class="col" data-bind="meta.color">red</em></li>' +
            '<li><span class="t" data-bind="title">B</span> <em class="col" data-bind="meta.color">green</em></li></ul></div>'
        const { host, initial, ctx } = await mount(html, () => wildflower.component(c, { state: { posts: [] } }))
        expect(ctx.posts.map(p => p.meta.color)).toEqual(['red', 'green'])
        await step(() => { ctx.posts[0].meta.color = 'blue' })
        expect([...host.querySelectorAll('.col')].map(e => e.textContent)).toEqual(['blue', 'green'])
        expect(idsOf(host, initial).rows).toEqual([0, 1])
    })

    it('N9 a top-level server list edited inside wildflower.batch() repaints', async () => {
        const c = uname('n9')
        const { host, initial, ctx } = await mount(postsHtml(c), () => wildflower.component(c, { state: { posts: [] } }))
        await step(() => wildflower.batch(() => { ctx.posts[0].title = 'B' }))
        expect(postsView(host)).toEqual(['B', 'Second'])
        await step(() => { ctx.posts[1].title = 'S!' })
        expect(postsView(host)).toEqual(['B', 'S!'])
        expect(idsOf(host, initial).rows).toEqual([0, 1])
    })
})

// ---------------------------------------------------------------------------
// Page load (iframe)
// ---------------------------------------------------------------------------

const SCRIPT_SRC = getFrameworkScripts()[0]
const CAPTURE = `<script>
window.__canary = { warns: [], errors: [] };
(function () {
    var w = console.warn.bind(console), e = console.error.bind(console);
    console.warn = function () { var a = Array.prototype.slice.call(arguments); window.__canary.warns.push(a.map(String).join(' ')); w.apply(console, a); };
    console.error = function () { var a = Array.prototype.slice.call(arguments); window.__canary.errors.push(a.map(String).join(' ')); e.apply(console, a); };
    window.addEventListener('error', function (ev) { window.__canary.errors.push('error: ' + ev.message); });
    window.addEventListener('unhandledrejection', function (ev) { window.__canary.errors.push('rejection: ' + (ev.reason && ev.reason.message || ev.reason)); });
})();
</script>`
// Runs right after the server markup, before any list is mounted on either
// page shape: records the server nodes.
const RECORD = `<script>window.__init = Array.prototype.map.call(document.querySelectorAll('.host'), function (h) { return (${captureTree.toString()})(h) });</script>`

function pageHtml({ body, script, framework }) {
    const fw = `<script src="${SCRIPT_SRC}"></script>`
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${CAPTURE}${framework === 'head' ? fw : ''}</head>` +
        `<body>${body}${RECORD}${framework === 'bottom' ? fw : ''}<script>${script}</script></body></html>`
}

const frames = []
async function loadPage(opts) {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px;height:400px'
    document.body.appendChild(iframe)
    frames.push(iframe)
    await new Promise(resolve => { iframe.addEventListener('load', resolve, { once: true }); iframe.srcdoc = pageHtml(opts) })
    const win = iframe.contentWindow
    const doc = iframe.contentDocument
    const hosts = [...doc.querySelectorAll('.host')]
    const start = performance.now()
    while (!hosts.every(h => { const o = h.querySelector('.outer'); return o._ssrPhase === 'complete' || o._mapArrayInitialized })) {
        if (performance.now() - start > 4000) break
        await settle(20)
    }
    await settle(150)
    const ctxOf = (h) => win.wildflower.getComponentInstance(h.dataset.componentId).context
    return { win, doc, hosts, initial: win.__init, ctxOf }
}

function expectCleanPage(win) {
    expect(win.__canary.errors).toEqual([])
    if (DEV) expect(win.__canary.warns.filter(w => /WF-\d+/.test(w))).toEqual([])
}

const reg = (name) => `wildflower.component('${name}', { state: { groups: [] } })`

describeIfSSR('SSR nested lists (page load)', () => {
    afterEach(() => { for (const f of frames) f.remove(); frames.length = 0 })

    for (const framework of ['head', 'bottom']) {
        const step = async (fn) => { fn(); await settle(120) }

        it(`PL2a edits in both groups, then pushes into both [${framework}]`, async () => {
            const { win, hosts, initial, ctxOf } = await loadPage({ framework, body: groupsHtml('pla', G2), script: reg('pla') })
            const ctx = ctxOf(hosts[0])
            expect(groupsView(hosts[0])).toEqual(['G0:320|150', 'G1:0|80'])
            await step(() => { ctx.groups[0].cells[0].label = 'x' })
            await step(() => { ctx.groups[1].cells[0].label = 'y' })
            await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
            await step(() => { ctx.groups[1].cells.push({ label: 'NEW1' }) })
            expect(groupsView(hosts[0])).toEqual(['G0:x|150|NEW0', 'G1:y|80|NEW1'])
            expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3, -1]] })
            expectCleanPage(win)
        })

        it(`PL2b a push into the first group first [${framework}]`, async () => {
            const { win, hosts, initial, ctxOf } = await loadPage({ framework, body: groupsHtml('plb', G2), script: reg('plb') })
            const ctx = ctxOf(hosts[0])
            await step(() => { ctx.groups[0].cells.push({ label: 'NEW0' }) })
            await step(() => { ctx.groups[1].cells[0].label = 'y' })
            expect(groupsView(hosts[0])).toEqual(['G0:320|150|NEW0', 'G1:y|80'])
            expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3]] })
            expectCleanPage(win)
        })

        it(`PL2c keyed lists [${framework}]`, async () => {
            const { win, hosts, initial, ctxOf } = await loadPage({ framework, body: groupsHtml('plc', G2, { keyed: true }), script: reg('plc') })
            const ctx = ctxOf(hosts[0])
            await step(() => { ctx.groups[1].cells[0].label = 'y' })
            await step(() => { ctx.groups[0].cells.push({ id: 'n0', label: 'NEW0' }) })
            await step(() => { ctx.groups[1].cells.reverse() })
            expect(groupsView(hosts[0])).toEqual(['G0:320|150|NEW0', 'G1:80|y'])
            expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [3, 2]] })
            expectCleanPage(win)
        })

        for (const prefix of ['data-', 'data-wf-']) {
            it(`PL2d rows that are lists, ${prefix} [${framework}]`, async () => {
                const body = prefix === 'data-' ? membersHtml('pld') : wf(membersHtml('pld'))
                const { win, hosts, initial, ctxOf } = await loadPage({ framework, body, script: `wildflower.component('pld', { state: { members: [] } })` })
                const ctx = ctxOf(hosts[0])
                expect(grid(hosts[0])).toEqual([['1', '2'], ['3', '4']])
                await step(() => { ctx.members[0].cells[0].v = 'x' })
                await step(() => { ctx.members[1].cells.push({ v: 'N' }) })
                await step(() => { ctx.members.push({ cells: [{ v: 'p1' }, { v: 'p2' }] }) })
                expect(grid(hosts[0])).toEqual([['x', '2'], ['3', '4', 'N'], ['p1', 'p2']])
                expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1, -1], cells: [[0, 1], [2, 3, -1], [-1, -1]] })
                expectCleanPage(win)
            })
        }

        it(`PL2e two instances, 2×2 and 3×3 [${framework}]`, async () => {
            const { win, hosts, initial, ctxOf } = await loadPage({ framework, body: groupsHtml('ple', G2) + groupsHtml('ple', G3), script: reg('ple') })
            const ctx = ctxOf(hosts[1])
            await step(() => { ctx.groups[2].cells[0].label = 'Z' })
            await step(() => { ctx.groups[2].cells.push({ label: 'N2' }) })
            expect(groupsView(hosts[1])).toEqual(['H0:a|b|c', 'H1:d|e|f', 'H2:Z|h|i|N2'])
            expect(idsOf(hosts[1], initial[1])).toEqual({ rows: [0, 1, 2], cells: [[0, 1, 2], [3, 4, 5], [6, 7, 8, -1]] })
            expect(groupsView(hosts[0])).toEqual(['G0:320|150', 'G1:0|80'])
            expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1], cells: [[0, 1], [2, 3]] })
            expectCleanPage(win)
        })

        it(`PL2f three levels [${framework}]`, async () => {
            const { win, hosts, initial, ctxOf } = await loadPage({ framework, body: l3Html('plf'), script: reg('plf') })
            const ctx = ctxOf(hosts[0])
            await step(() => { ctx.groups[0].cells[1].marks[0].m = 'X' })
            await step(() => { ctx.groups[1].cells[0].marks.push({ m: 'N' }) })
            expect(l3View(hosts[0])).toEqual(['G0:a[a1,a2]|b[X]', 'G1:c[c1,c2,N]'])
            expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1], cells: [[0, 1], [2]], marks: [[[0, 1], [2]], [[3, 4, -1]]] })
            expectCleanPage(win)
        })

        it(`PL2g init() writes, nested and top-level [${framework}]`, async () => {
            const script = `wildflower.component('plg', { state: { groups: [] }, init() { this.groups[0].cells.push({ label: 'NEW0' }); this.groups[1].cells[0].label = 'E1' } });
                wildflower.component('plt', { state: { posts: [] }, init() { this.posts.push({ title: 'Third' }); this.posts[0].title = 'First!' } })`
            const { win, hosts, initial, ctxOf } = await loadPage({ framework, body: groupsHtml('plg', G2) + postsHtml('plt'), script })
            expect(groupsView(hosts[0])).toEqual(['G0:320|150|NEW0', 'G1:E1|80'])
            expect(idsOf(hosts[0], initial[0])).toEqual({ rows: [0, 1], cells: [[0, 1, -1], [2, 3]] })
            expect(postsView(hosts[1])).toEqual(['First!', 'Second', 'Third'])
            expect(idsOf(hosts[1], initial[1]).rows).toEqual([0, 1, -1])
            await step(() => { ctxOf(hosts[0]).groups[1].name = 'G1x' })
            await step(() => { ctxOf(hosts[1]).posts[1].title = 'Second!' })
            expect(groupsView(hosts[0])).toEqual(['G0:320|150|NEW0', 'G1x:E1|80'])
            expect(postsView(hosts[1])).toEqual(['First!', 'Second!', 'Third'])
            expectCleanPage(win)
        })
    }
})
