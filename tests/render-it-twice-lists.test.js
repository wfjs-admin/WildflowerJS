/**
 * "Render it twice": the same data shown by two lists, across the ways two
 * lists can differ (row kind, order, component, visibility, instance).
 *
 * Why these exist: the list engine's fast paths each assume one consumer per
 * thing (one list per array, one renderer per item, one template per path),
 * so each case renders the same data twice and checks both lists.
 *
 * Every case must pass when run ALONE (`-t "<id> "`): a shared module flag
 * once let a test pass only because an earlier test had run.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('render it twice: lists', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())
    const texts = (sel, root = host) => [...root.querySelectorAll(sel)].map((e) => e.textContent.trim())
    const ctxOf = (el) => wildflower.componentInstances.get(el.dataset.componentId).context

    // Row kinds, by the update path each takes in the renderer:
    //   span: a child text binding (per-node sink, upgraded to a direct writer)
    //   root: a text binding on the row root (one owner record per item)
    //   comp: an item-level computed (the computed dispatcher's frame stamps)
    const KINDS = {
        span: { row: (c) => `<li><span class="${c}" data-bind="name"></span></li>`, show: (n) => n },
        root: { row: (c) => `<li class="${c}" data-bind="name"></li>`, show: (n) => n },
        comp: { row: (c) => `<li class="${c}" data-bind="shout"></li>`, show: (n) => n + '!' }
    }
    const items = () => [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
    const shout = { shout(item) { return item.name + '!' } }

    let n = 0
    for (const a of Object.keys(KINDS)) {
        for (const b of Object.keys(KINDS)) {
            const id = 'K' + String(++n).padStart(2, '0')
            it(`${id} two components over one store array: ${a} rows and ${b} rows both follow an edit`, async () => {
                const s = `rt-${id.toLowerCase()}`
                wildflower.store(s, { state: { items: items() }, rename(i, v) { this.items[i].name = v } })
                // A component with any computed never takes direct writers, so
                // only the comp kind declares one.
                wildflower.component(s + '-a', a === 'comp' ? { state: {}, computed: shout } : { state: {} })
                wildflower.component(s + '-b', b === 'comp' ? { state: {}, computed: shout } : { state: {} })
                host.innerHTML = `
                    <div data-component="${s}-a"><ul data-list="$${s}.items" data-key="id"><template>${KINDS[a].row('ra')}</template></ul></div>
                    <div data-component="${s}-b"><ul data-list="$${s}.items" data-key="id"><template>${KINDS[b].row('rb')}</template></ul></div>`
                wildflower.scan()
                await settle()
                expect(texts('.ra')).toEqual(['A', 'B'].map(KINDS[a].show))
                expect(texts('.rb')).toEqual(['A', 'B'].map(KINDS[b].show))
                wildflower.getStore(s).rename(0, 'Z')
                await settle()
                wildflower.getStore(s).rename(1, 'Y')
                await settle()
                // Again on the same rows: the first write may have upgraded a
                // leaf to a suppressing direct writer.
                wildflower.getStore(s).rename(0, 'Z2')
                await settle()
                wildflower.getStore(s).rename(1, 'Y2')
                await settle()
                expect(texts('.ra')).toEqual(['Z2', 'Y2'].map(KINDS[a].show))
                expect(texts('.rb')).toEqual(['Z2', 'Y2'].map(KINDS[b].show))
            })
        }
    }
    for (const a of Object.keys(KINDS)) {
        for (const b of Object.keys(KINDS)) {
            const id = 'K' + String(++n).padStart(2, '0')
            it(`${id} one component, two lists over its array: ${a} rows and ${b} rows both follow an edit`, async () => {
                const c = `rt-${id.toLowerCase()}`
                const def = { state: { items: items() }, rename(i, v) { this.items[i].name = v } }
                if (a === 'comp' || b === 'comp') def.computed = shout
                wildflower.component(c, def)
                host.innerHTML = `<div data-component="${c}">
                    <ul data-list="items" data-key="id"><template>${KINDS[a].row('ra')}</template></ul>
                    <ol data-list="items" data-key="id"><template>${KINDS[b].row('rb')}</template></ol></div>`
                wildflower.scan()
                await settle()
                const ctx = wildflower.getComponent(c)
                ctx.rename(0, 'Z')
                await settle()
                ctx.rename(1, 'Y')
                await settle()
                ctx.rename(0, 'Z2')
                await settle()
                ctx.rename(1, 'Y2')
                await settle()
                expect(texts('.ra')).toEqual(['Z2', 'Y2'].map(KINDS[a].show))
                expect(texts('.rb')).toEqual(['Z2', 'Y2'].map(KINDS[b].show))
            })
        }
    }

    it('T01 two lists with IDENTICAL templates over one array both render and update', async () => {
        wildflower.component('rt-same', { state: { items: items() }, rename(i, v) { this.items[i].name = v } })
        const list = (id) => `<ul id="${id}" data-list="items" data-key="id"><template><li class="r" data-bind="name"></li></template></ul>`
        host.innerHTML = `<div data-component="rt-same">${list('l1')}${list('l2')}</div>`
        wildflower.scan()
        await settle()
        wildflower.getComponent('rt-same').rename(0, 'Z')
        await settle()
        expect(texts('#l1 .r')).toEqual(['Z', 'B'])
        expect(texts('#l2 .r')).toEqual(['Z', 'B'])
    })

    // Two views over one array in data-render blocks. A re-shown block is a
    // CLONE of its original markup, so nothing kept on the old element survives.
    const tabs = (name, showA, showB) => {
        wildflower.component(name, {
            state: { showA, showB, cats: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] },
            rename(i, v) { this.cats[i].name = v }
        })
        host.innerHTML = `<div data-component="${name}">
            <div data-render="showA"><ul data-list="cats" data-key="key"><template><li class="va" data-bind="name"></li></template></ul></div>
            <div data-render="showB"><ol data-list="cats" data-key="key"><template><li><b class="vb" data-bind="name"></b></li></template></ol></div></div>`
        wildflower.scan()
    }

    it('T02 tabs: the later view, re-shown while the earlier one is hidden, keeps its own template', async () => {
        tabs('rt-tabs1', false, true)
        await settle()
        const ctx = wildflower.getComponent('rt-tabs1')
        expect(texts('.vb')).toEqual(['A', 'B'])
        ctx.showB = false
        await settle()
        ctx.showB = true
        await settle()
        expect(texts('.vb')).toEqual(['A', 'B'])
        expect(texts('.va')).toEqual([])
        ctx.showA = true
        await settle()
        expect(texts('.va')).toEqual(['A', 'B'])
        ctx.rename(0, 'Z')
        await settle()
        expect(texts('.va')).toEqual(['Z', 'B'])
        expect(texts('.vb')).toEqual(['Z', 'B'])
    })

    it('T03 tabs: switching back and forth, each view renders its own rows and follows edits', async () => {
        tabs('rt-tabs2', true, false)
        await settle()
        const ctx = wildflower.getComponent('rt-tabs2')
        expect(texts('.va')).toEqual(['A', 'B'])
        for (let round = 0; round < 2; round++) {
            ctx.showA = false; ctx.showB = true
            await settle()
            expect(texts('.vb')).toEqual([round ? 'Z' : 'A', 'B'])
            expect(host.querySelectorAll('.va').length).toBe(0)
            ctx.showB = false; ctx.showA = true
            await settle()
            expect(host.querySelectorAll('.vb').length).toBe(0)
            ctx.rename(0, 'Z')
            await settle()
            expect(texts('.va')).toEqual(['Z', 'B'])
        }
    })

    it('T04 a component added later, its first list hidden at mount: a second instance still gets the right templates', async () => {
        wildflower.component('rt-dyn', { state: { open: false, cats: [{ key: 'a', name: 'A' }] } })
        const markup = `<div data-component="rt-dyn">
            <div data-render="open"><ul data-list="cats" data-key="key"><template><li class="p" data-bind="name"></li></template></ul></div>
            <ol data-list="cats" data-key="key"><template><li><i class="q" data-bind="name"></i></li></template></ol></div>`
        host.innerHTML = markup
        wildflower.scan()
        await settle()
        const first = host.querySelector('[data-component="rt-dyn"]')
        ctxOf(first).open = true            // instance 1: the later list rendered first
        await settle()
        expect(texts('.p', first)).toEqual(['A'])
        expect(texts('.q', first)).toEqual(['A'])
        host.insertAdjacentHTML('beforeend', markup)
        wildflower.scan()
        await settle()
        const second = host.querySelectorAll('[data-component="rt-dyn"]')[1]
        expect(texts('.q', second)).toEqual(['A'])
        ctxOf(second).open = true
        await settle()
        expect(texts('.p', second)).toEqual(['A'])
        expect(texts('.q', second)).toEqual(['A'])
    })

    // A data-render block re-inserts a cloneNode copy of its content. A copy
    // taken AFTER the lists inside rendered has their rows but no <template>
    // (it is removed once extracted) and no expandos.
    it('T13 a component cloned after render and re-inserted: each of two lists keeps its own template', async () => {
        wildflower.component('rt-clone', { state: { cats: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] }, rename(i, v) { this.cats[i].name = v } })
        host.innerHTML = `<div data-component="rt-clone">
            <ul id="c1" data-list="cats" data-key="key"><template><li class="one" data-bind="name"></li></template></ul>
            <ol id="c2" data-list="cats" data-key="key"><template><li><b class="two" data-bind="name"></b></li></template></ol></div>`
        if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
        wildflower.scan()
        await settle(120)
        const original = host.querySelector('[data-component="rt-clone"]')
        const clone = original.cloneNode(true)
        original.remove()
        await settle(150)
        host.appendChild(clone)
        wildflower.scan()
        await settle(200)
        expect(texts('#c1 .one')).toEqual(['A', 'B'])
        expect(texts('#c2 .two')).toEqual(['A', 'B'])
        expect(host.querySelectorAll('#c1 li').length).toBe(2)
        expect(host.querySelectorAll('#c2 li').length).toBe(2)
        ctxOf(host.querySelector('[data-component="rt-clone"]')).rename(0, 'Z')
        await settle()
        expect(texts('#c1 .one')).toEqual(['Z', 'B'])
        expect(texts('#c2 .two')).toEqual(['Z', 'B'])
    })

    it.skipIf(!hasFeature('configurable-templates'))('T05 a data-use-template list beside an inline-template list over the same path', async () => {
        wildflower.component('rt-use', { state: { cats: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] } })
        host.innerHTML = `<div data-component="rt-use">
            <template data-item-template="chip"><li class="chip"><span data-bind="name"></span></li></template>
            <ul id="u" data-list="cats" data-key="key"><template data-use-template="chip"></template></ul>
            <ol id="o" data-list="cats" data-key="key"><template><li class="plain" data-bind="name"></li></template></ol></div>`
        wildflower.scan()
        await settle()
        expect(texts('#u .chip')).toEqual(['A', 'B'])
        expect(texts('#o .plain')).toEqual(['A', 'B'])
        expect(host.querySelectorAll('#u .plain').length).toBe(0)
        expect(host.querySelectorAll('#o .chip').length).toBe(0)
    })

    // A nested list over a row field named like a top-level list, in the
    // order where the nested one registers first.
    it('T06 namesake, nested list first: the top-level list still renders its own template', async () => {
        wildflower.component('rt-name', {
            state: { cats: [{ key: 'c1', label: 'Top' }], groups: [{ id: 1, cats: [{ key: 'n1', label: 'Inner' }] }], on: true }
        })
        host.innerHTML = `<div data-component="rt-name">
            <div data-list="groups" data-key="id"><template><div><p data-list="cats" data-key="key"><template><em class="inner" data-bind="label"></em></template></p></div></template></div>
            <div data-render="on"><ul data-list="cats" data-key="key"><template><li class="top" data-bind="label"></li></template></ul></div></div>`
        wildflower.scan()
        await settle()
        expect(texts('.top')).toEqual(['Top'])
        expect(texts('.inner')).toEqual(['Inner'])
        // Remount the top-level list: it must not pick up the nested template.
        const ctx = wildflower.getComponent('rt-name')
        ctx.on = false
        await settle()
        ctx.on = true
        await settle()
        expect(texts('.top')).toEqual(['Top'])
        expect(texts('.inner')).toEqual(['Inner'])
    })

    it('T07 one of two lists of different kinds is destroyed: the other keeps updating', async () => {
        wildflower.store('rt-gone', { state: { items: items() }, rename(i, v) { this.items[i].name = v } })
        wildflower.component('rt-gone-a', { state: {} })
        wildflower.component('rt-gone-b', { state: {} })
        host.innerHTML = `
            <div data-component="rt-gone-a"><ul data-list="$rt-gone.items" data-key="id"><template>${KINDS.span.row('ra')}</template></ul></div>
            <div id="gb" data-component="rt-gone-b"><ul data-list="$rt-gone.items" data-key="id"><template>${KINDS.root.row('rb')}</template></ul></div>`
        wildflower.scan()
        await settle()
        const s = wildflower.getStore('rt-gone')
        s.rename(0, 'Z')
        await settle()
        expect(texts('.ra')).toEqual(['Z', 'B'])
        expect(texts('.rb')).toEqual(['Z', 'B'])
        host.querySelector('#gb').remove()
        await settle(150)
        s.rename(0, 'Q')
        await settle()
        s.rename(1, 'R')
        await settle()
        expect(texts('.ra')).toEqual(['Q', 'R'])
    })

    it('T08 an item replaced under the same key in one list, while another list still shows the old object', async () => {
        wildflower.store('rt-rep', {
            state: { items: items(), kept: [] },
            keep() { this.kept = [this.items[0]] },
            replace() { this.items[0] = { id: 1, name: 'New' } },
            renameKept(v) { this.kept[0].name = v },
            renameNew(v) { this.items[0].name = v }
        })
        wildflower.component('rt-rep-a', { state: {} })
        wildflower.component('rt-rep-b', { state: {} })
        host.innerHTML = `
            <div data-component="rt-rep-a"><ul data-list="$rt-rep.items" data-key="id"><template>${KINDS.span.row('ra')}</template></ul></div>
            <div data-component="rt-rep-b"><ul data-list="$rt-rep.kept" data-key="id"><template>${KINDS.root.row('rb')}</template></ul></div>`
        wildflower.scan()
        await settle()
        const s = wildflower.getStore('rt-rep')
        s.keep()
        await settle()
        expect(texts('.rb')).toEqual(['A'])
        s.replace()
        await settle()
        expect(texts('.ra')).toEqual(['New', 'B'])
        s.renameKept('Old2')
        await settle()
        expect(texts('.rb')).toEqual(['Old2'])
        expect(texts('.ra')).toEqual(['New', 'B'])
        s.renameNew('New2')
        await settle()
        expect(texts('.ra')).toEqual(['New2', 'B'])
        expect(texts('.rb')).toEqual(['Old2'])
    })

    it('T09 both lists drop a shared item, then follow an edit to one that remains', async () => {
        wildflower.store('rt-drop', {
            state: { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }] },
            drop() { this.items.splice(0, 1) },
            rename(i, v) { this.items[i].name = v }
        })
        wildflower.component('rt-drop-a', { state: {} })
        wildflower.component('rt-drop-b', { state: {} })
        host.innerHTML = `
            <div data-component="rt-drop-a"><ul data-list="$rt-drop.items" data-key="id"><template>${KINDS.span.row('ra')}</template></ul></div>
            <div data-component="rt-drop-b"><ul data-list="$rt-drop.items" data-key="id"><template>${KINDS.root.row('rb')}</template></ul></div>`
        wildflower.scan()
        await settle()
        const s = wildflower.getStore('rt-drop')
        s.rename(0, 'A2')                 // stamp writers before the removal
        await settle()
        s.drop()
        await settle()
        s.rename(0, 'Z')
        await settle()
        expect(texts('.ra')).toEqual(['Z', 'C'])
        expect(texts('.rb')).toEqual(['Z', 'C'])
    })

    // data-render on a child of the row (the tested shape). On the row ROOT a
    // hidden row does not come back even with one list; see the root-render
    // cases below.
    it('T10 part of a row hidden by data-render in one list: the other list updates, and the part returns current', async () => {
        wildflower.component('rt-rowr', {
            state: { items: [{ id: 1, name: 'A', on: true }, { id: 2, name: 'B', on: true }] },
            set(i, k, v) { this.items[i][k] = v }
        })
        host.innerHTML = `<div data-component="rt-rowr">
            <ul data-list="items" data-key="id"><template><li><div data-render="on"><span class="ra" data-bind="name"></span></div></li></template></ul>
            <ol data-list="items" data-key="id"><template>${KINDS.root.row('rb')}</template></ol></div>`
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent('rt-rowr')
        ctx.set(0, 'on', false)
        await settle()
        expect(texts('.ra')).toEqual(['B'])
        ctx.set(0, 'name', 'Z')
        await settle()
        expect(texts('.rb')).toEqual(['Z', 'B'])
        ctx.set(0, 'on', true)
        await settle()
        expect(texts('.ra')).toEqual(['Z', 'B'])
    })

    it('T14 the list with child text bindings is destroyed; the root-bound list keeps updating, edit after edit', async () => {
        wildflower.store('rt-gone2', { state: { items: items() }, rename(i, v) { this.items[i].name = v } })
        wildflower.component('rt-gone2-a', { state: {} })
        wildflower.component('rt-gone2-b', { state: {} })
        host.innerHTML = `
            <div id="ga" data-component="rt-gone2-a"><ul data-list="$rt-gone2.items" data-key="id"><template>${KINDS.span.row('ra')}</template></ul></div>
            <div data-component="rt-gone2-b"><ul data-list="$rt-gone2.items" data-key="id"><template>${KINDS.root.row('rb')}</template></ul></div>`
        wildflower.scan()
        await settle()
        const s = wildflower.getStore('rt-gone2')
        s.rename(0, 'Z')
        await settle()
        s.rename(0, 'Z1')                 // the span list's leaf is now a direct writer
        await settle()
        expect(texts('.ra')).toEqual(['Z1', 'B'])
        expect(texts('.rb')).toEqual(['Z1', 'B'])
        host.querySelector('#ga').remove()
        await settle(150)
        for (const v of ['Q1', 'Q2', 'Q3']) {
            s.rename(0, v)
            await settle()
            expect(texts('.rb')).toEqual([v, 'B'])
        }
    })

    // A list emptied in one step drops its rows without visiting each leaf,
    // so its stamps stay on the items. Disposed afterwards, they must not
    // stand in front of the list that still shows those items.
    it('T15 a list emptied and then destroyed leaves the other list updating, edit after edit', async () => {
        const objs = items()
        wildflower.store('rt-empt', {
            state: { items: objs, visible: objs.slice() },
            hideAll() { this.visible = [] },
            rename(i, v) { this.items[i].name = v }
        })
        wildflower.component('rt-empt-a', { state: {} })
        wildflower.component('rt-empt-b', { state: {} })
        host.innerHTML = `
            <div id="ea" data-component="rt-empt-a"><ul data-list="$rt-empt.visible" data-key="id"><template>${KINDS.span.row('ra')}</template></ul></div>
            <div data-component="rt-empt-b"><ul data-list="$rt-empt.items" data-key="id"><template>${KINDS.root.row('rb')}</template></ul></div>`
        wildflower.scan()
        await settle()
        const s = wildflower.getStore('rt-empt')
        s.rename(0, 'Z')
        await settle()
        expect(texts('.ra')).toEqual(['Z', 'B'])
        expect(texts('.rb')).toEqual(['Z', 'B'])
        s.hideAll()
        await settle()
        expect(texts('.ra')).toEqual([])
        s.rename(0, 'Y')                  // both lists live, one no longer shows the item
        await settle()
        expect(texts('.rb')).toEqual(['Y', 'B'])
        host.querySelector('#ea').remove()
        await settle(150)
        for (const v of ['Q1', 'Q2', 'Q3']) {
            s.rename(0, v)
            await settle()
            expect(texts('.rb')).toEqual([v, 'B'])
        }
    })

    // Markup present when the framework indexes templates (page load) is
    // keyed by that pass, not at first render. Nested lists then arrive in
    // each row with their own inline template.
    // Calls the indexing pass by its internal name, which production builds
    // mangle: dev and raw builds only.
    it.skipIf(isMinifiedBuild())('T16 templates indexed up front: two lists and their nested lists keep their own templates', async () => {
        wildflower.component('rt-init', {
            state: { teams: [{ id: 1, name: 'Red', members: [{ id: 'm1', name: 'Ana' }] }, { id: 2, name: 'Blue', members: [{ id: 'm2', name: 'Ben' }] }] },
            rename(v) { this.teams[1].members[0].name = v }
        })
        const inner = (cls) => `<div data-list="members" data-key="id"><template><span class="${cls}" data-bind="name"></span></template></div>`
        host.innerHTML = `<div data-component="rt-init">
            <div id="i1" data-list="teams" data-key="id"><template><section><h4 class="t1" data-bind="name"></h4>${inner('n1')}</section></template></div>
            <div id="i2" data-list="teams" data-key="id"><template><article><h5 class="t2" data-bind="name"></h5>${inner('n2')}</article></template></div></div>`
        wildflower._initializeTemplates()
        const k1 = host.querySelector('#i1')._wfTplKey, k2 = host.querySelector('#i2')._wfTplKey
        expect(typeof k1).toBe('string')
        expect(k1).not.toBe(k2)
        wildflower.scan()
        await settle()
        expect(texts('#i1 .t1')).toEqual(['Red', 'Blue'])
        expect(texts('#i2 .t2')).toEqual(['Red', 'Blue'])
        expect(texts('#i1 .n1')).toEqual(['Ana', 'Ben'])
        expect(texts('#i2 .n2')).toEqual(['Ana', 'Ben'])
        expect(host.querySelectorAll('#i1 .n2, #i2 .n1, #i1 .t2, #i2 .t1').length).toBe(0)
        wildflower.getComponent('rt-init').rename('Bo')
        await settle()
        expect(texts('#i1 .n1')).toEqual(['Ana', 'Bo'])
        expect(texts('#i2 .n2')).toEqual(['Ana', 'Bo'])
    })

    it('T17 two nested lists over the same field in one row, with different templates', async () => {
        wildflower.component('rt-sib', {
            state: { teams: [{ id: 1, members: [{ id: 'm1', name: 'Ana' }] }, { id: 2, members: [{ id: 'm2', name: 'Ben' }] }] },
            rename(v) { this.teams[1].members[0].name = v }
        })
        host.innerHTML = `<div data-component="rt-sib"><div data-list="teams" data-key="id"><template><section>
            <ul data-list="members" data-key="id"><template><li class="s1" data-bind="name"></li></template></ul>
            <ol data-list="members" data-key="id"><template><li><b class="s2" data-bind="name"></b></li></template></ol>
            </section></template></div></div>`
        wildflower.scan()
        await settle()
        expect(texts('.s1')).toEqual(['Ana', 'Ben'])
        expect(texts('.s2')).toEqual(['Ana', 'Ben'])
        wildflower.getComponent('rt-sib').rename('Bo')
        await settle()
        expect(texts('.s1')).toEqual(['Ana', 'Bo'])
        expect(texts('.s2')).toEqual(['Ana', 'Bo'])
    })

    it('T18 polymorphic rows: each variant\'s nested list over the same field keeps its own template', async () => {
        wildflower.component('rt-poly', {
            state: { items: [
                { id: 1, type: 'a', tags: [{ id: 'x', t: 'X' }] },
                { id: 2, type: 'b', tags: [{ id: 'y', t: 'Y' }] }
            ] }
        })
        host.innerHTML = `<div data-component="rt-poly"><div data-list="items" data-key="id" data-template-key="type">
            <template data-type="a"><div class="va"><ul data-list="tags" data-key="id"><template><li class="ta" data-bind="t"></li></template></ul></div></template>
            <template data-type="b"><div class="vb"><ol data-list="tags" data-key="id"><template><li><i class="tb" data-bind="t"></i></li></template></ol></div></template>
            </div></div>`
        wildflower.scan()
        await settle()
        expect(texts('.va .ta')).toEqual(['X'])
        expect(texts('.vb .tb')).toEqual(['Y'])
        expect(host.querySelectorAll('.va .tb, .vb .ta').length).toBe(0)
    })

    // data-render on the row ROOT, with ONE list. Not currently supported; dev
    // builds warn (WF-517) and the docs point to data-show or a filtering
    // computed. Full support
    // needs the list reconciler to follow a hidden row's placeholder. These
    // pin today's behaviour: it.fails passes while it is broken and fails
    // once it works; flip to it() then.
    const rootRender = async (name, row) => {
        wildflower.component(name, {
            state: { items: [{ id: 1, name: 'A', on: true }, { id: 2, name: 'B', on: true }] },
            set(i, k, v) { this.items[i][k] = v }
        })
        host.innerHTML = `<div data-component="${name}"><ul data-list="items" data-key="id"><template>${row}</template></ul></div>`
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent(name)
        ctx.set(0, 'on', false)
        await settle()
        expect(texts('.ra')).toEqual(['B'])
        ctx.set(0, 'name', 'Z')
        await settle()
        ctx.set(0, 'on', true)
        await settle()
        expect(texts('.ra')).toEqual(['Z', 'B'])
    }
    it.fails('X01 known: a row hidden by data-render on its root comes back (child text binding)', async () => {
        await rootRender('rt-root1', '<li data-render="on"><span class="ra" data-bind="name"></span></li>')
    })
    it.fails('X02 known: a row hidden by data-render on its root comes back with edits made while hidden (root text binding)', async () => {
        await rootRender('rt-root2', '<li class="ra" data-render="on" data-bind="name"></li>')
    })

    it('T11 a row computed that throws in one list does not stop the other list updating', async () => {
        const orig = console.error
        console.error = () => {}
        try {
            wildflower.component('rt-throw', {
                state: { items: items() },
                computed: { risky(item) { if (item.name === 'BOOM') throw new Error('rt-throw'); return item.name } },
                rename(i, v) { this.items[i].name = v }
            })
            host.innerHTML = `<div data-component="rt-throw">
                <ul data-list="items" data-key="id"><template><li class="ra" data-bind="risky"></li></template></ul>
                <ol data-list="items" data-key="id"><template>${KINDS.span.row('rb')}</template></ol></div>`
            wildflower.scan()
            await settle()
            const ctx = wildflower.getComponent('rt-throw')
            try { ctx.rename(0, 'BOOM') } catch (e) { /* the app is erroring; the other list must still update */ }
            await settle()
            expect(texts('.rb')).toEqual(['BOOM', 'B'])
            ctx.rename(0, 'OK')
            await settle()
            expect(texts('.rb')).toEqual(['OK', 'B'])
            expect(texts('.ra')).toEqual(['OK', 'B'])
        } finally { console.error = orig }
    })

    it.skipIf(!hasFeature('ssr'))('T12 server-rendered: two lists over one array hydrate, keep their own rows, and follow an edit', async () => {
        wildflower.component('rt-ssr', {
            state: { items: [{ name: 'A' }, { name: 'B' }] },
            rename(i, v) { this.items[i].name = v },
            add() { this.items.push({ name: 'C' }) }
        })
        host.innerHTML = `<div data-component="rt-ssr" data-ssr="true">
            <ul id="s1" data-list="items">
                <template><li class="one"><span class="n1" data-bind="name"></span></li></template>
                <li class="one"><span class="n1" data-bind="name">A</span></li>
                <li class="one"><span class="n1" data-bind="name">B</span></li>
            </ul>
            <ol id="s2" data-list="items">
                <template><li class="two"><b class="n2" data-bind="name"></b></li></template>
                <li class="two"><b class="n2" data-bind="name">A</b></li>
                <li class="two"><b class="n2" data-bind="name">B</b></li>
            </ol></div>`
        wildflower.scan()
        await settle(200)
        const ctx = wildflower.getComponent('rt-ssr')
        ctx.rename(0, 'Z')
        await settle(150)
        expect(texts('.n1')).toEqual(['Z', 'B'])
        expect(texts('.n2')).toEqual(['Z', 'B'])
        ctx.add()
        await settle(150)
        expect(texts('#s1 .n1')).toEqual(['Z', 'B', 'C'])
        expect(texts('#s2 .n2')).toEqual(['Z', 'B', 'C'])
        expect(host.querySelectorAll('#s1 .two').length).toBe(0)
        expect(host.querySelectorAll('#s2 .one').length).toBe(0)
    })
})
