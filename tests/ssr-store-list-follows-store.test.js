/**
 * A server-rendered list over a store ($name.path, or the long form
 * external('name', 'path') at the top level) whose store already holds the
 * rows the server rendered follows the store afterwards: a push adds a row
 * and an item edit repaints it, and the server rows stay as the same nodes.
 * In a component with a binding of its own (so with a render effect) such a
 * list stayed adopted and inert: nothing on the page followed the store. A
 * component with only the list followed it, through the path for components
 * without a render effect. A store row's list over a field of the row (the
 * long form in a row) is a row field and is not covered here.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('ssr') && hasFeature('lists') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0
const kids = (el) => el ? [...el.children].filter(c => c.tagName !== 'TEMPLATE') : []

describeIf('a server list over a store that matches the server rows', () => {
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

    const inner = (path, ts) => `<ul class="tags" data-list="${path}"><template><i data-bind="t"></i></template>` +
        ts.map(t => `<i data-bind="t">${t}</i>`).join('') + '</ul>'
    const view = () => [...container.querySelectorAll('.tags')].map(u => kids(u).map(l => l.textContent).join('|'))
    // [name, the list's path for store s, top-level (true) or in each of two state rows]
    const forms = [
        ['a top-level $store list', (s) => `$${s}.items`, true],
        ['a $store list in every server row', (s) => `$${s}.items`, false],
        ['a top-level list in the long form', (s) => `external('${s}', 'items')`, true],
    ]

    for (const [name, path, top] of forms) {
        for (const own of [true, false]) {
            it(`${name} follows a push and an item edit, in a component ${own ? 'with a binding of its own' : 'with only the list'}`, async () => {
                const c = `sslf-${++seq}`; const s = `sslfstore${seq}`
                wildflower.store(s, { state: { items: [{ t: 'a' }, { t: 'b' }] } })
                wildflower.component(c, { state: { label: 'L', groups: [] } })
                const p = own ? '<p data-bind="label">L</p>' : ''
                container.innerHTML = top
                    ? `<div class="host" data-component="${c}" data-ssr="true">${p}${inner(path(s), ['a', 'b'])}</div>`
                    : `<div class="host" data-component="${c}" data-ssr="true">${p}<ul class="outer" data-list="groups">` +
                      `<template><li><b data-bind="name"></b>${inner(path(s), [])}</li></template>` +
                      ['G0', 'G1'].map(g => `<li><b data-bind="name">${g}</b>${inner(path(s), ['a', 'b'])}</li>`).join('') + '</ul></div>'
                const n = top ? 1 : 2
                const nodes = [...container.querySelectorAll('.tags i')]
                wildflower.scan(container)
                await settle()
                expect(view()).toEqual(Array(n).fill('a|b'))
                wildflower.getStore(s).items.push({ t: 'c' })
                await settle()
                expect(view()).toEqual(Array(n).fill('a|b|c'))
                wildflower.getStore(s).items[0].t = 'A'
                await settle()
                expect(view()).toEqual(Array(n).fill('A|b|c'))
                // The server rows are still the nodes the server rendered.
                const now = [...container.querySelectorAll('.tags i')].map(i => nodes.indexOf(i)).filter(i => i !== -1)
                expect(now).toEqual(nodes.map((_, i) => i))
            })
        }
    }
})
