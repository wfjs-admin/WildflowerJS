/**
 * When an entity a component reads registers late (a store, a plugin, or a
 * query declared after the scan), the component's mounted lists keep their
 * rows: the same nodes, and what was typed in them. A row that reads the
 * arriving entity shows it, and follows it from then on. Before, the wake
 * emptied every mounted list in the component and built it again from its
 * template, so the rows were new nodes and an input's text was lost. A
 * server-rendered list whose rows read a store is mounted at activation, so
 * it lost its server rows the same way; a client-rendered list always had.
 * The list is no longer rebuilt: what in it missed the entity runs again
 * when the entity registers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('lists') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIf('a late entity arriving in a component with mounted lists', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    const tpl = (s, late) => `<template><li><b data-bind="name"></b><input class="in"><span class="t" data-bind="$${s}.v"></span><em class="l" data-bind="$${late}.x"></em></li></template>`
    const serverRow = (id, name, s, late) => `<li data-seed='{"id":${id}}'><b data-bind="name">${name}</b><input class="in"><span class="t" data-bind="$${s}.v">S1</span><em class="l" data-bind="$${late}.x"></em></li>`
    const rows = (sel = 'li') => [...container.querySelectorAll(sel)]
    const texts = (sel) => rows(sel).map(el => el.textContent)

    for (const server of [true, false]) {
        it.skipIf(server && !hasFeature('ssr'))(`a ${server ? 'server-rendered list whose rows read a store' : 'client-rendered list'} keeps its rows, and its rows show the arriving store and follow it`, async () => {
            const c = `lekr-${++seq}`; const s = `lekrstore${seq}`; const late = `lekrlate${seq}`
            wildflower.store(s, { state: { v: 'S1' } })
            wildflower.component(c, { state: { items: server ? [] : [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } })
            container.innerHTML = `<div data-component="${c}"${server ? ' data-ssr="true"' : ''}><p class="late" data-bind="$${late}.x">-</p>` +
                `<ul data-list="items" data-key="id">${tpl(s, late)}${server ? serverRow(1, 'A', s, late) + serverRow(2, 'B', s, late) : ''}</ul></div>`
            const before = server ? rows() : null
            wildflower.scan(container)
            await settle()
            const nodes = rows()
            if (server) expect(nodes).toEqual(before)
            nodes[0].querySelector('.in').value = 'typed'
            wildflower.store(late, { state: { x: 'X' } })
            await settle()
            expect(rows()).toEqual(nodes)
            expect(rows()[0].querySelector('.in').value).toBe('typed')
            expect(container.querySelector('.late').textContent).toBe('X')
            expect(texts('.l')).toEqual(['X', 'X'])
            wildflower.getStore(late).x = 'Y'
            await settle()
            expect(texts('.l')).toEqual(['Y', 'Y'])
            expect(container.querySelector('.late').textContent).toBe('Y')
            wildflower.getStore(s).v = 'S2'
            await settle()
            expect(texts('.t')).toEqual(['S2', 'S2'])
            expect(rows()).toEqual(nodes)
        })
    }

    it('a list whose rows read nothing of the arriving store is left alone', async () => {
        const c = `lekr-${++seq}`; const late = `lekrlate${seq}`
        wildflower.component(c, { state: { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } })
        container.innerHTML = `<div data-component="${c}"><p class="late" data-bind="$${late}.x">-</p>` +
            `<ul data-list="items" data-key="id"><template><li><b data-bind="name"></b><input class="in"></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const nodes = rows()
        nodes[1].querySelector('.in').value = 'typed'
        wildflower.store(late, { state: { x: 'X' } })
        await settle()
        expect(rows()).toEqual(nodes)
        expect(rows()[1].querySelector('.in').value).toBe('typed')
        expect(container.querySelector('.late').textContent).toBe('X')
        wildflower.getComponent(c).items.push({ id: 3, name: 'C' })
        await settle()
        expect(texts('b')).toEqual(['A', 'B', 'C'])
    })

    // Every way a row can read the arriving store.
    const READS = [
        ['a class binding', (late) => `<i class="r" data-bind-class="{ on: $${late}.on }">r</i>`,
            () => rows('.r').map(el => el.classList.contains('on'))],
        ['data-show', (late) => `<i class="r" data-show="$${late}.on">r</i>`,
            () => rows('.r').map(el => el.style.display !== 'none')],
        ['an attribute binding', (late) => `<i class="r" data-bind-attr="{ title: $${late}.on }">r</i>`,
            () => rows('.r').map(el => el.getAttribute('title') === 'true')],
        ['an expression with an item field', (late) => `<i class="r" data-bind="$${late}.on && name ? 'yes' : 'no'">r</i>`,
            () => rows('.r').map(el => el.textContent === 'yes')],
    ]
    for (const [label, cell, read] of READS) {
        it(`a row that reads the arriving store through ${label} shows it and follows it`, async () => {
            const c = `lekr-${++seq}`; const late = `lekrlate${seq}`
            wildflower.component(c, { state: { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } })
            container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li><b data-bind="name"></b>${cell(late)}</li></template></ul></div>`
            wildflower.scan(container)
            await settle()
            const nodes = rows()
            expect(read()).toEqual([false, false])
            wildflower.store(late, { state: { on: true } })
            await settle()
            expect(read()).toEqual([true, true])
            expect(rows()).toEqual(nodes)
            wildflower.getStore(late).on = false
            await settle()
            expect(read()).toEqual([false, false])
            wildflower.getStore(late).on = true
            await settle()
            expect(read()).toEqual([true, true])
            expect(rows()).toEqual(nodes)
        })
    }

    it('a row computed that reads the arriving store shows it and follows it', async () => {
        const c = `lekr-${++seq}`; const late = `lekrlate${seq}`
        wildflower.component(c, {
            state: { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] },
            computed: { tag(item) { const st = wildflower.getStore(late); return item.name + ':' + (st ? st.x : '-') } },
        })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li><b class="r" data-bind="tag"></b></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const nodes = rows()
        expect(texts('.r')).toEqual(['A:-', 'B:-'])
        wildflower.store(late, { state: { x: 'X' } })
        await settle()
        expect(texts('.r')).toEqual(['A:X', 'B:X'])
        expect(rows()).toEqual(nodes)
        wildflower.getStore(late).x = 'Y'
        await settle()
        expect(texts('.r')).toEqual(['A:Y', 'B:Y'])
    })

    it('a nested list whose rows read the arriving store shows it and follows it, and the outer rows stay', async () => {
        const c = `lekr-${++seq}`; const late = `lekrlate${seq}`
        wildflower.component(c, { state: { groups: [{ id: 1, subs: [{ id: 11, n: 'a' }, { id: 12, n: 'b' }] }, { id: 2, subs: [{ id: 21, n: 'c' }] }] } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="groups" data-key="id"><template><li class="g"><input class="in">` +
            `<ol data-list="subs" data-key="id"><template><li class="s"><b data-bind="n"></b><em class="r" data-bind="$${late}.x"></em></li></template></ol></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const outer = rows('.g'); const inner = rows('.s')
        outer[0].querySelector('.in').value = 'typed'
        wildflower.store(late, { state: { x: 'X' } })
        await settle()
        expect(texts('.r')).toEqual(['X', 'X', 'X'])
        expect(rows('.g')).toEqual(outer)
        expect(rows('.s')).toEqual(inner)
        expect(rows('.g')[0].querySelector('.in').value).toBe('typed')
        wildflower.getStore(late).x = 'Y'
        await settle()
        expect(texts('.r')).toEqual(['Y', 'Y', 'Y'])
    })

    it('a list over the arriving store beside a mounted list: the first fills, the second keeps its rows', async () => {
        const c = `lekr-${++seq}`; const late = `lekrlate${seq}`
        wildflower.component(c, { state: { items: [{ id: 1, name: 'A' }] } })
        container.innerHTML = `<div data-component="${c}"><ul class="a" data-list="$${late}.rows" data-key="id"><template><li class="x" data-bind="t"></li></template></ul>` +
            `<ul class="b" data-list="items" data-key="id"><template><li class="y"><b data-bind="name"></b><input class="in"></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const nodes = rows('.y')
        nodes[0].querySelector('.in').value = 'typed'
        wildflower.store(late, { state: { rows: [{ id: 1, t: 'one' }, { id: 2, t: 'two' }] } })
        await settle()
        expect(texts('.x')).toEqual(['one', 'two'])
        expect(rows('.y')).toEqual(nodes)
        expect(rows('.y')[0].querySelector('.in').value).toBe('typed')
        wildflower.getStore(late).rows.push({ id: 3, t: 'three' })
        await settle()
        expect(texts('.x')).toEqual(['one', 'two', 'three'])
    })

    it.skipIf(!hasFeature('plugins'))('a row that reads a plugin registered late shows it and follows it', async () => {
        const c = `lekr-${++seq}`; const p = `lekrplug${seq}`
        wildflower.component(c, { state: { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li><b data-bind="name"></b><em class="r" data-bind="$${p}.t"></em></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const nodes = rows()
        wildflower.plugin({ name: p, version: '1.0.0', state: { t: 'P1' }, install() {} })
        await settle()
        expect(texts('.r')).toEqual(['P1', 'P1'])
        expect(rows()).toEqual(nodes)
        wildflower['$' + p].state.t = 'P2'
        await settle()
        expect(texts('.r')).toEqual(['P2', 'P2'])
    })
})
