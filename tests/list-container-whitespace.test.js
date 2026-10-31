/**
 * A list's container holds its rows and nothing else, whichever render put
 * them there. The whitespace around a <template> (the indentation of the
 * markup) stayed in the container when the first render had rows, and was
 * gone after any empty render, which empties the container: so the same
 * rows sat in a container with or without that text depending on whether
 * the list had once been empty. In an inline container the text is a space
 * before the first row, so the row moved; a video render's check() saw the
 * container's text differ between two seeks of the same frame.
 *
 * Each case reads the container's own text (its direct text nodes) on the
 * first render with rows, after the list empties, and after it fills again.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const ownText = (el) => { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t }
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('a list container holds the same nodes on every render', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    let n = 0
    const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context

    // Mounts `markup` (the container, with whitespace around its template)
    // inside a component whose `items` starts as `first`, and returns the
    // container, a setter for the items and the component's context.
    async function mount(container, first, extra = {}) {
        const c = 'ws' + (++n)
        wildflower.component(c, { state: { items: first, ...extra } })
        host.innerHTML = `<div data-component="${c}">${container}</div>`
        wildflower.scan()
        await settle(110)
        const ctx = ctxOf(c)
        return { ctx, set: async (rows) => { ctx.items = rows; await settle() } }
    }

    const KEYED = `<ul class="L" data-list="items" data-key="id">
            <template><li data-bind="id"></li></template>
        </ul>`
    const UNKEYED = `<ul class="L" data-list="items">
            <template><li data-bind="id"></li></template>
        </ul>`
    const rows = (...ids) => ids.map((id) => ({ id }))

    for (const [label, markup] of [['keyed', KEYED], ['unkeyed', UNKEYED]]) {
        it(`${label}: no whitespace on the first render with rows, after emptying, or after filling again`, async () => {
            const { set } = await mount(markup, rows('a', 'b'))
            const L = host.querySelector('.L')
            const seen = [ownText(L), L.children.length]
            await set([])
            seen.push(ownText(L), L.children.length)
            await set(rows('a', 'b'))
            seen.push(ownText(L), L.children.length)
            expect(seen).toEqual(['', 2, '', 0, '', 2])
        })

        it(`${label}: no whitespace when the list starts empty and then fills`, async () => {
            const { set } = await mount(markup, [])
            const L = host.querySelector('.L')
            const seen = [ownText(L)]
            await set(rows('a'))
            seen.push(ownText(L), L.children.length)
            expect(seen).toEqual(['', '', 1])
        })
    }

    it('a polymorphic list (data-template-key) holds no whitespace on its first render', async () => {
        const { set } = await mount(`<div class="L" data-list="items" data-key="id" data-template-key="kind">
                <template data-type="a"><p data-bind="id"></p></template>
                <template data-type="b"><h4 data-bind="id"></h4></template>
            </div>`, [{ id: 1, kind: 'a' }, { id: 2, kind: 'b' }])
        const L = host.querySelector('.L')
        const seen = [ownText(L), L.children.length]
        await set([])
        await set([{ id: 3, kind: 'b' }])
        seen.push(ownText(L), L.children.length)
        expect(seen).toEqual(['', 2, '', 1])
    })

    it('a nested list holds no whitespace in any row, first render or later', async () => {
        const { ctx } = await mount(`<div data-list="items" data-key="id">
                <template><section><ol class="N" data-list="tags">
                    <template><li data-bind="t"></li></template>
                </ol></section></template>
            </div>`, [{ id: 1, tags: [{ t: 'x' }, { t: 'y' }] }, { id: 2, tags: [{ t: 'z' }] }])
        const texts = () => Array.from(host.querySelectorAll('.N'), ownText)
        const first = texts()
        ctx.items[0].tags = []
        await settle()
        ctx.items[0].tags = [{ t: 'w' }]
        await settle()
        expect([first, texts()]).toEqual([['', ''], ['', '']])
    })

    it("a store's list holds no whitespace on its first render", async () => {
        const c = 'ws' + (++n)
        wildflower.store(c + 's', { state: { items: rows('a', 'b') } })
        wildflower.component(c, { state: {} })
        host.innerHTML = `<div data-component="${c}"><ul class="L" data-list="$${c}s.items" data-key="id">
                <template><li data-bind="id"></li></template>
            </ul></div>`
        wildflower.scan()
        await settle(110)
        const L = host.querySelector('.L')
        expect([ownText(L), L.children.length]).toEqual(['', 2])
    })

    it('in an inline container the first row sits in the same place on the first render and after the list empties and fills', async () => {
        const { set } = await mount(`<p style="font: 16px monospace; margin: 0">x<span class="L" data-list="items" data-key="id">
                <template><b data-bind="id"></b></template>
            </span></p>`, rows('a'))
        const L = host.querySelector('.L')
        const left = () => Math.round(L.querySelector('b').getBoundingClientRect().left - L.parentElement.getBoundingClientRect().left)
        const first = left()
        await set([])
        await set(rows('a'))
        expect(left()).toBe(first)
    })
})
