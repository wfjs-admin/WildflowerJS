/**
 * Server-rendered list rows whose bindings read a store follow the store:
 * text, HTML, an attribute, a class, a style, data-show and data-render.
 * Adopted rows are bound once at activation and have no effect of their own,
 * so in a component with a binding of its own nothing in them followed a
 * store change, and in a component with only the list data-show and
 * data-render did not, until some write to the list re-rendered it. A list
 * whose rows read a shared source is now taken over at activation, keeping
 * the server rows as the same nodes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('ssr') && hasFeature('lists') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIf('SSR list rows over a store', () => {
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

    // One row's cells; `server` is what the server rendered ({ v, on, color }), or null for the template.
    const cells = (s, server) => `<b class="n" data-bind="name">${server ? server.name : ''}</b>` +
        `<span class="t" data-bind="$${s}.v">${server ? server.v : ''}</span>` +
        `<span class="h" data-bind-html="$${s}.v">${server ? server.v : ''}</span>` +
        `<a class="a" ${server ? `title="${server.v}"` : ''} data-bind-attr="{ title: $${s}.v }">a</a>` +
        `<i class="c${server && server.on ? ' on' : ''}" data-bind-class="{ on: $${s}.on }">c</i>` +
        `<u class="s" ${server ? `style="color: ${server.color};"` : ''} data-bind-style="{ color: $${s}.color }">s</u>` +
        `<em class="sh" data-show="$${s}.on"${!server || server.on ? '' : ' style="display: none;"'}>e</em>` +
        (!server || server.on ? `<strong class="r" data-render="$${s}.on">r</strong>` : '')
    const markup = (c, s, server, own) => `<div class="host" data-component="${c}" data-ssr="true">${own ? '<p class="own" data-bind="label">L</p>' : ''}` +
        `<ul data-list="items" data-key="id"><template><li>${cells(s, null)}</li></template>` +
        `<li data-seed='{"id":1}'>${cells(s, { name: 'A', ...server })}</li><li data-seed='{"id":2}'>${cells(s, { name: 'B', ...server })}</li></ul></div>`
    const view = () => [...container.querySelectorAll('li')].map(li => ({
        n: li.querySelector('.n').textContent,
        text: li.querySelector('.t').textContent,
        html: li.querySelector('.h').innerHTML,
        title: li.querySelector('.a').getAttribute('title'),
        on: li.querySelector('.c').classList.contains('on'),
        color: li.querySelector('.s').style.color,
        shown: li.querySelector('.sh').style.display !== 'none',
        rendered: !!li.querySelector('.r'),
    }))
    const rows = (v, on, color) => ['A', 'B'].map(n => ({ n, text: v, html: v, title: v, on, color, shown: on, rendered: on }))

    for (const own of [true, false]) {
        it(`rows follow the store, in a component ${own ? 'with a binding of its own' : 'with only the list'}`, async () => {
            const c = `srsb-${++seq}`; const s = `srsbstore${seq}`
            wildflower.store(s, { state: { v: 'S1', on: true, color: 'red' } })
            wildflower.component(c, { state: { label: 'L', items: [] } })
            container.innerHTML = markup(c, s, { v: 'S1', on: true, color: 'red' }, own)
            const nodes = [...container.querySelectorAll('li')]
            wildflower.scan(container)
            await settle()
            expect(view()).toEqual(rows('S1', true, 'red'))
            expect([...container.querySelectorAll('li')].map(li => nodes.indexOf(li))).toEqual([0, 1])
            const store = wildflower.getStore(s)
            store.v = 'S2'; store.on = false; store.color = 'blue'
            await settle()
            expect(view()).toEqual(rows('S2', false, 'blue'))
            store.v = 'S3'; store.on = true; store.color = 'green'
            await settle()
            expect(view()).toEqual(rows('S3', true, 'green'))
            expect([...container.querySelectorAll('li')].map(li => nodes.indexOf(li))).toEqual([0, 1])
        })
    }

    it('rows show the store at activation when it disagrees with the server markup', async () => {
        const c = `srsb-${++seq}`; const s = `srsbstore${seq}`
        wildflower.store(s, { state: { v: 'S2', on: false, color: 'blue' } })
        wildflower.component(c, { state: { label: 'L', items: [] } })
        container.innerHTML = markup(c, s, { v: 'S1', on: true, color: 'red' }, true)
        wildflower.scan(container)
        await settle()
        expect(view()).toEqual(rows('S2', false, 'blue'))
    })

    it('a row field still updates its own row (control)', async () => {
        const c = `srsb-${++seq}`; const s = `srsbstore${seq}`
        wildflower.store(s, { state: { v: 'S1', on: true, color: 'red' } })
        wildflower.component(c, { state: { label: 'L', items: [] } })
        container.innerHTML = markup(c, s, { v: 'S1', on: true, color: 'red' }, true)
        wildflower.scan(container)
        await settle()
        wildflower.getComponent(c).items[1].name = 'B2'
        await settle()
        expect(view().map(r => r.n)).toEqual(['A', 'B2'])
        expect(view().map(r => r.text)).toEqual(['S1', 'S1'])
    })

    it('a server list whose rows read no store is left adopted (control)', async () => {
        const c = `srsb-${++seq}`
        wildflower.component(c, { state: { items: [] } })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><ul data-list="items" data-key="id">` +
            `<template><li><b class="n" data-bind="name"></b><i data-bind="'$' + price"></i></li></template>` +
            `<li data-seed='{"id":1,"price":5}'><b class="n" data-bind="name">A</b><i data-bind="'$' + price">$5</i></li></ul></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('li i').textContent).toBe('$5')
        expect(!!container.querySelector('ul')._mapArrayInitialized).toBe(false)
    })
})
