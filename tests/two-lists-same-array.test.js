/**
 * Two data-list elements over the same array in one component, each with its
 * own template: a <select> of <option>s and a summary of <div>s. Each must
 * render its own template. Found by the AI bake-off chain (2026-10-01): the
 * summary list rendered the select's <option> template.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('two lists over the same array', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const cats = () => [{ key: 'travel', name: 'Travel' }, { key: 'food', name: 'Food' }]

    it('each list renders its own template', async () => {
        wildflower.component('tl-same', { state: { cats: cats(), pick: 'Travel' } })
        host.innerHTML = `
            <div data-component="tl-same">
                <select id="pick" data-model="pick" data-list="cats" data-key="key">
                    <template><option data-bind="name"></option></template>
                </select>
                <div id="summary" data-list="cats" data-key="key">
                    <template><div class="cat"><span class="nm" data-bind="name"></span></div></template>
                </div>
            </div>`
        wildflower.scan()
        await settle()
        expect(host.querySelectorAll('#pick option').length).toBe(2)
        expect(host.querySelectorAll('#summary option').length).toBe(0)
        expect([...host.querySelectorAll('#summary .cat .nm')].map((e) => e.textContent)).toEqual(['Travel', 'Food'])
    })

    it('both lists follow a change to the array', async () => {
        wildflower.component('tl-same-upd', { state: { cats: cats() }, add() { this.cats.push({ key: 'sw', name: 'Software' }) } })
        host.innerHTML = `
            <div data-component="tl-same-upd">
                <select id="pick" data-list="cats" data-key="key"><template><option data-bind="name"></option></template></select>
                <ul id="summary" data-list="cats" data-key="key"><template><li data-bind="name"></li></template></ul>
            </div>`
        wildflower.scan()
        await settle()
        wildflower.getComponent('tl-same-upd').add()
        await settle()
        expect(host.querySelectorAll('#pick option').length).toBe(3)
        expect([...host.querySelectorAll('#summary li')].map((e) => e.textContent)).toEqual(['Travel', 'Food', 'Software'])
    })

    // The two lists once shared one list context (keyed by path) whose
    // element pointed at whichever list rendered last. Each row feature below
    // is exercised on BOTH lists, the first one especially.
    const twoLists = (extra = {}) => Object.assign({
        state: { cats: cats(), picked: null },
        pick(e, el, d) { this.picked = d.item.name },
        removeFirst() { this.cats.splice(0, 1) },
        reverse() { this.cats.reverse() }
    }, extra)
    const twoListsHtml = (name) => `
        <div data-component="${name}">
            <ul id="a" data-list="cats" data-key="key"><template>
                <li class="a-row" data-bind-class="{ last: _last }"><button class="a-pick" data-action="pick" data-bind="name"></button><input class="a-name" data-model="name"></li>
            </template></ul>
            <ol id="b" data-list="cats" data-key="key"><template>
                <li class="b-row" data-bind-class="{ last: _last }"><button class="b-pick" data-action="pick" data-bind="name"></button><input class="b-name" data-model="name"></li>
            </template></ol>
        </div>`
    const names = (sel) => [...host.querySelectorAll(sel)].map((e) => e.textContent)

    it('row actions in either list receive their own item', async () => {
        wildflower.component('tl-act', twoLists())
        host.innerHTML = twoListsHtml('tl-act')
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent('tl-act')
        host.querySelectorAll('.a-pick')[1].click()
        await settle()
        expect(ctx.picked).toBe('Food')
        host.querySelectorAll('.b-pick')[0].click()
        await settle()
        expect(ctx.picked).toBe('Travel')
    })

    it('data-model in either list writes its own row, and both lists show it', async () => {
        wildflower.component('tl-model', twoLists())
        host.innerHTML = twoListsHtml('tl-model')
        wildflower.scan()
        await settle()
        const a = host.querySelectorAll('.a-name')[1]
        a.value = 'Meals'
        a.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(wildflower.getComponent('tl-model').cats[1].name).toBe('Meals')
        expect(names('.b-pick')).toEqual(['Travel', 'Meals'])
        const b = host.querySelectorAll('.b-name')[0]
        b.value = 'Trips'
        b.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(names('.a-pick')).toEqual(['Trips', 'Meals'])
    })

    it('removal and reorder reach both lists, with position classes', async () => {
        wildflower.component('tl-order', twoLists())
        host.innerHTML = twoListsHtml('tl-order')
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent('tl-order')
        ctx.cats.push({ key: 'sw', name: 'Software' })
        await settle()
        ctx.reverse()
        await settle()
        expect(names('.a-pick')).toEqual(['Software', 'Food', 'Travel'])
        expect(names('.b-pick')).toEqual(['Software', 'Food', 'Travel'])
        ctx.removeFirst()
        await settle()
        expect(names('.a-pick')).toEqual(['Food', 'Travel'])
        expect(names('.b-pick')).toEqual(['Food', 'Travel'])
        expect([...host.querySelectorAll('.a-row')].map((e) => e.classList.contains('last'))).toEqual([false, true])
        expect([...host.querySelectorAll('.b-row')].map((e) => e.classList.contains('last'))).toEqual([false, true])
    })

    it('rows with data-show in one list only use that list\'s template', async () => {
        wildflower.component('tl-show', { state: { cats: [{ key: 'a', name: 'A', on: true }, { key: 'b', name: 'B', on: false }] } })
        host.innerHTML = `
            <div data-component="tl-show">
                <ul id="a" data-list="cats" data-key="key"><template><li><span class="flag" data-show="on">on</span><b data-bind="name"></b></li></template></ul>
                <ol id="b" data-list="cats" data-key="key"><template><li><i class="nm" data-bind="name"></i></li></template></ol>
            </div>`
        wildflower.scan()
        await settle()
        const flags = [...host.querySelectorAll('#a .flag')].map((e) => e.style.display !== 'none')
        expect(flags).toEqual([true, false])
        expect(names('#b .nm')).toEqual(['A', 'B'])
        wildflower.getComponent('tl-show').cats[1].on = true
        await settle()
        expect([...host.querySelectorAll('#a .flag')].map((e) => e.style.display !== 'none')).toEqual([true, true])
    })
})

// The same item OBJECTS rendered by two lists. Each list stamps the items so
// a field write updates its row directly; a second list must not take the
// first list's place, and one list dropping an item must not unhook the other.
describeIfLists('two lists over the same items', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())
    const texts = (sel) => [...host.querySelectorAll(sel)].map((e) => e.textContent)

    it('one component, two lists, plain text rows: a field edit reaches both', async () => {
        wildflower.component('ti-plain', { state: { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }, rename(i, n) { this.items[i].name = n } })
        host.innerHTML = `<div data-component="ti-plain">
            <ul data-list="items" data-key="id"><template><li class="a" data-bind="name"></li></template></ul>
            <ol data-list="items" data-key="id"><template><li class="b" data-bind="name"></li></template></ol></div>`
        wildflower.scan()
        await settle()
        wildflower.getComponent('ti-plain').rename(0, 'Z')
        await settle()
        expect(texts('.a')).toEqual(['Z', 'B'])
        expect(texts('.b')).toEqual(['Z', 'B'])
    })

    it('two components listing one store array: text, class and attr follow a field edit in both', async () => {
        wildflower.store('ti-store', {
            state: { items: [{ id: 1, name: 'A', hot: false }, { id: 2, name: 'B', hot: false }] },
            rename(i, n) { this.items[i].name = n },
            heat(i) { this.items[i].hot = true }
        })
        wildflower.component('ti-sa', { state: {} })
        wildflower.component('ti-sb', { state: {} })
        const row = (cls) => `<template><li class="${cls}" data-bind="name" data-bind-class="{ hot: hot }" data-bind-attr="{ title: name }"></li></template>`
        host.innerHTML = `
            <div data-component="ti-sa"><ul data-list="$ti-store.items" data-key="id">${row('a')}</ul></div>
            <div data-component="ti-sb"><ul data-list="$ti-store.items" data-key="id">${row('b')}</ul></div>`
        wildflower.scan()
        await settle()
        const s = wildflower.getStore('ti-store')
        s.rename(0, 'Z')
        s.heat(1)
        await settle()
        for (const cls of ['.a', '.b']) {
            expect(texts(cls)).toEqual(['Z', 'B'])
            expect([...host.querySelectorAll(cls)].map((e) => e.getAttribute('title'))).toEqual(['Z', 'B'])
            expect([...host.querySelectorAll(cls)].map((e) => e.classList.contains('hot'))).toEqual([false, true])
        }
    })

    // The t9 shape: a filtered view and a full list of the same objects.
    const filtered = (name) => wildflower.component(name, {
        state: { items: [{ id: 1, name: 'A', cat: 'x' }, { id: 2, name: 'B', cat: 'y' }], only: 'all' },
        computed: { shown() { return this.only === 'all' ? this.items : this.items.filter((i) => i.cat === this.only) } },
        rename(i, n) { this.items[i].name = n }
    })
    const filteredHtml = (name) => `<div data-component="${name}">
        <ul data-list="shown" data-key="id"><template><li class="f" data-bind="name"></li></template></ul>
        <ol data-list="items" data-key="id"><template><li class="all" data-bind="name"></li></template></ol></div>`

    it('a filtered view and the full list: an edit reaches both', async () => {
        filtered('ti-filt')
        host.innerHTML = filteredHtml('ti-filt')
        wildflower.scan()
        await settle()
        wildflower.getComponent('ti-filt').rename(1, 'Z')
        await settle()
        expect(texts('.f')).toEqual(['A', 'Z'])
        expect(texts('.all')).toEqual(['A', 'Z'])
    })

    it('the filter hiding an item does not unhook it from the full list', async () => {
        filtered('ti-hide')
        host.innerHTML = filteredHtml('ti-hide')
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent('ti-hide')
        ctx.only = 'x'
        await settle()
        expect(texts('.f')).toEqual(['A'])
        ctx.rename(1, 'Z')
        await settle()
        expect(texts('.all')).toEqual(['A', 'Z'])
        ctx.only = 'all'
        await settle()
        expect(texts('.f')).toEqual(['A', 'Z'])
    })

    it('destroying one component leaves the other list updating', async () => {
        wildflower.store('ti-gone', { state: { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }, rename(i, n) { this.items[i].name = n } })
        wildflower.component('ti-g1', { state: {} })
        wildflower.component('ti-g2', { state: {} })
        host.innerHTML = `
            <div id="g1" data-component="ti-g1"><ul data-list="$ti-gone.items" data-key="id"><template><li class="a" data-bind="name"></li></template></ul></div>
            <div id="g2" data-component="ti-g2"><ul data-list="$ti-gone.items" data-key="id"><template><li class="b" data-bind="name"></li></template></ul></div>`
        wildflower.scan()
        await settle()
        host.querySelector('#g2').remove()
        await settle(150)
        wildflower.getStore('ti-gone').rename(0, 'Z')
        await settle()
        expect(texts('.a')).toEqual(['Z', 'B'])
        // A new instance of the same component type (same markup: templates
        // are cached per type) joins the surviving list.
        host.insertAdjacentHTML('beforeend', `<div id="g3" data-component="ti-g2"><ul data-list="$ti-gone.items" data-key="id"><template><li class="b" data-bind="name"></li></template></ul></div>`)
        wildflower.scan()
        await settle()
        wildflower.getStore('ti-gone').rename(1, 'Y')
        await settle()
        expect(texts('.a')).toEqual(['Z', 'Y'])
        expect(texts('#g3 .b')).toEqual(['Z', 'Y'])
    })

    it('a list remounted inside a data-render block keeps updating (one list, no sharing)', async () => {
        wildflower.component('ti-remount', {
            state: { open: true, items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] },
            rename(i, n) { this.items[i].name = n }
        })
        host.innerHTML = `<div data-component="ti-remount"><div data-render="open">
            <ul data-list="items" data-key="id"><template><li class="r" data-bind="name"></li></template></ul></div></div>`
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent('ti-remount')
        ctx.open = false
        await settle()
        ctx.open = true
        await settle()
        ctx.rename(0, 'Z')
        await settle()
        expect(texts('.r')).toEqual(['Z', 'B'])
    })

    it('an item moved from one list\'s array to another\'s updates where it now is', async () => {
        wildflower.component('ti-move', {
            state: { left: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], right: [] },
            move() { const it = this.left.splice(0, 1)[0]; this.right.push(it) },
            rename(n) { this.right[0].name = n }
        })
        host.innerHTML = `<div data-component="ti-move">
            <ul data-list="left" data-key="id"><template><li class="l" data-bind="name"></li></template></ul>
            <ul data-list="right" data-key="id"><template><li class="r" data-bind="name"></li></template></ul></div>`
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent('ti-move')
        ctx.move()
        await settle()
        ctx.rename('Z')
        await settle()
        expect(texts('.l')).toEqual(['B'])
        expect(texts('.r')).toEqual(['Z'])
    })

    const teams = () => ({
        state: { teams: [{ id: 1, members: [{ id: 'm1', name: 'Ana' }] }, { id: 2, members: [{ id: 'm2', name: 'Ben' }] }] },
        rename(n) { this.teams[1].members[0].name = n }
    })
    const innerList = (cls) => `<div data-list="members" data-key="id"><template><span class="${cls}" data-bind="name"></span></template></div>`

    it('nested lists keep sharing one template across rows (same inner template in two lists over the same teams)', async () => {
        wildflower.component('ti-nest', teams())
        host.innerHTML = `<div data-component="ti-nest">
            <div id="t1" data-list="teams" data-key="id"><template><section>${innerList('m')}</section></template></div>
            <div id="t2" data-list="teams" data-key="id"><template><article>${innerList('m')}</article></template></div></div>`
        wildflower.scan()
        await settle()
        expect(texts('#t1 section .m')).toEqual(['Ana', 'Ben'])
        expect(texts('#t2 article .m')).toEqual(['Ana', 'Ben'])
        wildflower.getComponent('ti-nest').rename('Bo')
        await settle()
        expect(texts('#t1 .m')).toEqual(['Ana', 'Bo'])
        expect(texts('#t2 .m')).toEqual(['Ana', 'Bo'])
    })

    // Nested templates register under their parent's key (`parent>child`),
    // so two same-path lists whose rows hold DIFFERENT inner templates over
    // the same child path each keep their own (in 1.5.4 they shared one).
    it('nested lists with different inner templates under two same-path lists each render their own', async () => {
        wildflower.component('ti-nest2', teams())
        host.innerHTML = `<div data-component="ti-nest2">
            <div id="t1" data-list="teams" data-key="id"><template><section>${innerList('m1')}</section></template></div>
            <div id="t2" data-list="teams" data-key="id"><template><article>${innerList('m2')}</article></template></div></div>`
        wildflower.scan()
        await settle()
        expect(texts('.m1')).toEqual(['Ana', 'Ben'])
        expect(texts('.m2')).toEqual(['Ana', 'Ben'])
    })

    it('three levels: grandchild templates follow their own parent chain', async () => {
        wildflower.component('ti-deep', {
            state: { orgs: [{ id: 1, teams: [{ id: 't1', members: [{ id: 'm1', name: 'Ana' }] }] }] },
            rename(n) { this.orgs[0].teams[0].members[0].name = n }
        })
        const lvl = (outer, cls) => `<${outer} data-list="orgs" data-key="id"><template><div><div data-list="teams" data-key="id"><template><div>${innerList(cls)}</div></template></div></div></template></${outer}>`
        host.innerHTML = `<div data-component="ti-deep">${lvl('section', 'g1')}${lvl('article', 'g2')}</div>`
        wildflower.scan()
        await settle()
        expect(texts('.g1')).toEqual(['Ana'])
        expect(texts('.g2')).toEqual(['Ana'])
        wildflower.getComponent('ti-deep').rename('Bo')
        await settle()
        expect(texts('.g1')).toEqual(['Bo'])
        expect(texts('.g2')).toEqual(['Bo'])
    })

    // A nested list over a row field named like a top-level list's path: the
    // nested key is `groups>cats`, the top-level one `cats`.
    it('a nested list over a row field named like a top-level list renders its own template', async () => {
        wildflower.component('ti-namesake', {
            state: {
                cats: [{ key: 'c1', label: 'Top' }],
                groups: [{ id: 1, cats: [{ key: 'n1', label: 'Inner' }] }]
            }
        })
        host.innerHTML = `<div data-component="ti-namesake">
            <ul id="top" data-list="cats" data-key="key"><template><li class="top" data-bind="label"></li></template></ul>
            <div data-list="groups" data-key="id"><template><div><p data-list="cats" data-key="key"><template><em class="inner" data-bind="label"></em></template></p></div></template></div></div>`
        wildflower.scan()
        await settle()
        expect(texts('.top')).toEqual(['Top'])
        expect(texts('.inner')).toEqual(['Inner'])
    })
})
