/**
 * SSR-hydrated list rows must survive the first re-render AS THE SAME DOM
 * NODES — the assertion the rest of the SSR suite never makes.
 *
 * The gap: hydration adopts server-rendered rows as data and displays them,
 * but never registers the elements into the keyed row map. The first list
 * render after hydration (a state mutation on the plain path, the superseding
 * refresh on the query path) therefore treats the list as unrendered and
 * rebuilds every row from the template, discarding the server DOM — focus,
 * selection, transitions, and third-party enhancements on it included.
 *
 * Existing tests ("in-place item mutation re-renders the hydrated row
 * binding", "ssr list handoff: ... refresh patches") assert text content and
 * row counts, which a full rebuild satisfies. These tests pin node identity
 * with isSameNode. Found 2026-08-22 by the ssr1 eval task's provenance-marker
 * check; repros: www/_repro/ssr-plain-list-identity-repro.html and
 * www/_repro/ssr-adopt-identity-repro.html.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfSSR = hasFeature('ssr') ? describe : describe.skip
const describeIfSSRQuery = hasFeature('ssr') && hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-idpin-${++seq}`

async function settle(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

function jsonResponse(data) {
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => data }
}

describeIfSSR('SSR hydrated list — element identity across the first re-render', () => {
    let container
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    it('plain SSR: an in-place item mutation patches hydrated rows, it does not rebuild them', async () => {
        const c = uname('c')
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <ul data-list="rows">
                    <template>
                        <li><span class="nm" data-bind="name"></span>: <span class="qty" data-bind="qty" data-type="number"></span></li>
                    </template>
                    <li><span class="nm" data-bind="name">Alpha</span>: <span class="qty" data-bind="qty" data-type="number">2</span></li>
                    <li><span class="nm" data-bind="name">Beta</span>: <span class="qty" data-bind="qty" data-type="number">3</span></li>
                    <li><span class="nm" data-bind="name">Gamma</span>: <span class="qty" data-bind="qty" data-type="number">1</span></li>
                </ul>
            </div>`
        let ctx
        wildflower.component(c, {
            state: { rows: [] },
            init() { ctx = this }
        })
        wildflower.scan(container)
        await settle()

        const before = [...container.querySelectorAll('li')]
        expect(before.length).toBe(3)
        expect(ctx.rows.length).toBe(3)

        ctx.rows[0].qty = 9
        await settle()

        const after = [...container.querySelectorAll('li')]
        expect(after.length).toBe(3)
        // Content updated…
        expect(after[0].querySelector('.qty').textContent.trim()).toBe('9')
        expect(after[1].querySelector('.qty').textContent.trim()).toBe('3')
        // …and the hydrated elements were patched, not replaced. The untouched
        // rows especially must be the very nodes the server rendered.
        expect(after[0].isSameNode(before[0])).toBe(true)
        expect(after[1].isSameNode(before[1])).toBe(true)
        expect(after[2].isSameNode(before[2])).toBe(true)
    })

    describeIfSSRQuery('query adoption', () => {
        let realFetch
        beforeEach(() => { realFetch = window.fetch })
        afterEach(() => { window.fetch = realFetch })

        it('adopted rows survive the superseding refresh as the same nodes', async () => {
            const q = uname('q'); const c = uname('c')
            let release
            window.fetch = () => new Promise(res => { release = () => res(jsonResponse([
                { id: 1, sku: 'AX-100', stock: 40 },   // changed on the server
                { id: 2, sku: 'BX-200', stock: 12 }
            ])) })
            wildflower.query(q, { from: '/api/inventory.json', key: 'id' })
            container.innerHTML = `
                <div data-component="${c}" data-ssr="true">
                    <table><tbody data-query="${q}">
                        <template>
                            <tr><td class="sku" data-bind="sku"></td><td class="stock" data-bind="stock" data-type="number"></td></tr>
                        </template>
                        <tr data-seed='{"id":1}'><td class="sku" data-bind="sku">AX-100</td><td class="stock" data-bind="stock" data-type="number">45</td></tr>
                        <tr data-seed='{"id":2}'><td class="sku" data-bind="sku">BX-200</td><td class="stock" data-bind="stock" data-type="number">12</td></tr>
                    </tbody></table>
                </div>`
            wildflower.component(c, { state: {} })
            wildflower.scan(container)
            await settle()

            const before = [...container.querySelectorAll('tbody tr')]
            expect(before.length).toBe(2)

            release()
            await settle()

            const after = [...container.querySelectorAll('tbody tr')]
            expect(after.length).toBe(2)
            // Content patched…
            expect(after[0].querySelector('.stock').textContent.trim()).toBe('40')
            expect(after[1].querySelector('.stock').textContent.trim()).toBe('12')
            // …in the elements the server rendered. The unchanged row (id 2)
            // especially has no reason to be a different node.
            expect(after[0].isSameNode(before[0])).toBe(true)
            expect(after[1].isSameNode(before[1])).toBe(true)
        })
    })
})
