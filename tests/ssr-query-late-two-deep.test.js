/**
 * A data-query list two lists deep in server-rendered rows (rows of a list,
 * inside rows of another), whose query is declared after the scan, keeps its
 * server rows as the same nodes, and the query adopts them as keyed rows.
 * Before, the declaration emptied the list: the store's arrival rebuilt the
 * middle list, which took the query list with it before the query could
 * adopt its rows. The rows of the list around it stay their own (no query
 * field is parsed into them). Following the fetch at this depth is not
 * pinned here.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('ssr') && hasFeature('lists') && hasFeature('query') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0
const kids = (el) => el ? [...el.children].filter(c => c.tagName !== 'TEMPLATE') : []
const plain = (v) => JSON.parse(JSON.stringify(v))

describeIf('a data-query list two lists deep in server rows, declared late', () => {
    let wildflower
    let container
    let realFetch
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        realFetch = window.fetch
        // The fetch stays pending: what is pinned is the state before it lands.
        window.fetch = () => new Promise(() => {})
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    for (const own of [false, true]) {
        it(`keeps its server rows and adopts them (component ${own ? 'with' : 'without'} a binding of its own)`, async () => {
            const q = `sqltd_${++seq}`; const c = `sqltd-${seq}`
            wildflower.component(c, { state: { label: 'L', groups: [] } })
            const li = (id, sku) => `<li data-seed='{"id":${id}}'><span data-bind="sku">${sku}</span></li>`
            const qlist = (rows) => `<ul class="inner" data-query="${q}"><template><li><span data-bind="sku"></span></li></template>${rows}</ul>`
            const mid = (rows) => `<div class="mid" data-list="subs"><template><article><h4 data-bind="t"></h4>${qlist('')}</article></template>${rows}</div>`
            container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true">${own ? '<p data-bind="label">L</p>' : ''}<div data-list="groups">` +
                `<template><section><h3 data-bind="name"></h3>${mid('')}</section></template>` +
                `<section><h3 data-bind="name">G1</h3>${mid(`<article><h4 data-bind="t">S1</h4>${qlist(li(1, 'A1') + li(2, 'B2'))}</article>`)}</section></div></div>`
            const rows0 = kids(container.querySelector('.inner'))
            wildflower.scan(container)
            await settle()
            wildflower.query(q, { from: `/api/${q}.json`, key: 'id' })
            await settle()
            const inner = container.querySelector('.inner')
            expect(kids(inner).map(r => r.textContent)).toEqual(['A1', 'B2'])
            expect(kids(inner)).toEqual(rows0)
            expect(plain(wildflower.getStore(q).rows)).toEqual([{ id: 1, sku: 'A1' }, { id: 2, sku: 'B2' }])
            expect(plain(wildflower.getComponent(c).groups)).toEqual([{ name: 'G1', subs: [{ t: 'S1' }] }])
        })
    }
})
