/**
 * WF-518: a component element cannot also be a list or pool container.
 *
 * An element that carries data-component is only a component. With data-list
 * (or data-pool) on the same element the component never renders its own
 * data: inside a parent component the list shows the parent's array, and at
 * the top level, or in a row of a parent's list, it shows nothing. The
 * supported shape puts the list one level inside the component:
 * <div data-component="kid"><ul data-list="tags">...</ul></div>.
 *
 * Development builds warn once per component name and attribute, from the one
 * place every component init path goes through (_createComponentCore). The
 * behaviour itself is unchanged.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const CODE = 'WF-518'
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

// The first line of each WF-518 warning. A development build prints
// "[WF-518] ..." and then indented suggestion and docs-link lines, which
// are not counted. A production build would print "[WF-518] <url>".
const coded = (lines) => isMinifiedBuild()
    ? lines.filter((line) => line.includes(CODE))
    : lines.filter((line) => line.startsWith('[' + CODE + '] '))

const texts = (els) => [...els].map((el) => el.textContent)

describe('WF-518: a component element that is also a list or pool container', () => {
    let host, wildflower, warned, origWarn

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        warned = []
        origWarn = console.warn
        console.warn = (...a) => { warned.push(a.map(String).join(' ')) }
        host = document.createElement('div')
        document.body.appendChild(host)
    })
    afterEach(() => { console.warn = origWarn; host.remove() })

    it('data-list on a component element warns once for two instances, and the parent\'s rows still render', async () => {
        wildflower.component('cel-list-parent', { state: { tags: [{ id: 1, name: 'parent-a' }, { id: 2, name: 'parent-b' }] } })
        wildflower.component('cel-list-kid', { state: { tags: [{ id: 9, name: 'own' }] } })
        const kid = (cls) => `<ul class="${cls}" data-component="cel-list-kid" data-list="tags" data-key="id"><template><li data-bind="name"></li></template></ul>`
        host.innerHTML = `<div data-component="cel-list-parent">${kid('k1')}${kid('k2')}</div>`
        wildflower.scan()
        await settle()

        const lines = coded(warned)
        if (isMinifiedBuild()) {
            expect(lines).toEqual([])
        } else {
            expect(lines.length).toBe(1)
            expect(lines[0]).toContain("'cel-list-kid'")
            expect(lines[0]).toContain('data-list="tags"')
        }
        if (hasFeature('lists')) {
            // Unchanged: each list shows the parent's array, never the component's own.
            expect(texts(host.querySelectorAll('.k1 li'))).toEqual(['parent-a', 'parent-b'])
            expect(texts(host.querySelectorAll('.k2 li'))).toEqual(['parent-a', 'parent-b'])
        }
    })

    it.skipIf(!hasFeature('lists'))('a component created inside a list row is checked too', async () => {
        wildflower.component('cel-row-kid', { state: {} })
        wildflower.component('cel-row-parent', { state: { rows: [{ id: 1, tags: [{ id: 1, name: 't' }] }, { id: 2, tags: [] }] } })
        host.innerHTML = `<div data-component="cel-row-parent"><div data-list="rows" data-key="id"><template><section><ul data-component="cel-row-kid" data-list="tags" data-key="id"><template><li data-bind="name"></li></template></ul></section></template></div></div>`
        wildflower.scan()
        await settle()

        expect(host.querySelectorAll('section').length).toBe(2)
        const lines = coded(warned)
        if (isMinifiedBuild()) {
            expect(lines).toEqual([])
        } else {
            expect(lines.length).toBe(1)
            expect(lines[0]).toContain("'cel-row-kid'")
            expect(lines[0]).toContain('data-list="tags"')
        }
    })

    it('a component registered after its elements are in the page is checked too', async () => {
        host.innerHTML = '<ul data-component="cel-late" data-list="tags"><template><li></li></template></ul>'
        wildflower.scan()
        await settle()
        expect(coded(warned)).toEqual([])               // no definition yet, so nothing initialized

        wildflower.component('cel-late', { state: {} })
        await settle()
        const lines = coded(warned)
        if (isMinifiedBuild()) {
            expect(lines).toEqual([])
        } else {
            expect(lines.length).toBe(1)
            expect(lines[0]).toContain("'cel-late'")
        }
    })

    it('data-pool on a component element warns once for two instances', async () => {
        const pools = hasFeature('pools')
        wildflower.component('cel-pool-parent', pools
            ? { state: {}, pools: { dots: {} }, init() { this.getPool('dots').add({ id: 1, label: 'parent-dot' }) } }
            : { state: {} })
        wildflower.component('cel-pool-kid', { state: {} })
        const kid = (cls) => `<div class="${cls}" data-component="cel-pool-kid" data-pool="dots"><template><i data-bind="label"></i></template></div>`
        host.innerHTML = `<div data-component="cel-pool-parent">${kid('p1')}${kid('p2')}</div>`
        wildflower.scan()
        await settle()

        const lines = coded(warned)
        if (isMinifiedBuild()) {
            expect(lines).toEqual([])
        } else {
            expect(lines.length).toBe(1)
            expect(lines[0]).toContain("'cel-pool-kid'")
            expect(lines[0]).toContain('data-pool="dots"')
        }
        if (pools) {
            // Unchanged: the parent's pool renders into a component element, once,
            // and the component never renders a pool of its own.
            expect(texts(host.querySelectorAll('[data-component="cel-pool-kid"] i'))).toEqual(['parent-dot'])
        }
    })

    // Two tests rather than one: the nano lane skips any test that inserts a
    // list element, and the pool half should still run there.
    it('the data-wf-list form warns too', async () => {
        wildflower.component('cel-wf-list', { state: {} })
        host.innerHTML = '<ul data-wf-component="cel-wf-list" data-wf-list="tags"><template><li></li></template></ul>'
        wildflower.scan()
        await settle()

        const lines = coded(warned)
        if (isMinifiedBuild()) {
            expect(lines).toEqual([])
        } else {
            expect(lines.length).toBe(1)
            expect(lines[0]).toContain("'cel-wf-list'")
            expect(lines[0]).toContain('data-wf-list="tags"')
        }
    })

    it('the data-wf-pool form warns too', async () => {
        wildflower.component('cel-wf-pool', { state: {} })
        host.innerHTML = '<div data-wf-component="cel-wf-pool" data-wf-pool="dots"><template><i></i></template></div>'
        wildflower.scan()
        await settle()

        const lines = coded(warned)
        if (isMinifiedBuild()) {
            expect(lines).toEqual([])
        } else {
            expect(lines.length).toBe(1)
            expect(lines[0]).toContain("'cel-wf-pool'")
            expect(lines[0]).toContain('data-wf-pool="dots"')
        }
    })

    it('a list or pool one level inside the component, and a plain component, do not warn', async () => {
        const pools = hasFeature('pools')
        wildflower.component('cel-ok-list', { state: { tags: [{ id: 1, name: 'own-a' }, { id: 2, name: 'own-b' }] } })
        wildflower.component('cel-ok-pool', pools
            ? { state: {}, pools: { dots: {} }, init() { this.getPool('dots').add({ id: 1, label: 'own-dot' }) } }
            : { state: {} })
        wildflower.component('cel-plain', { state: { title: 'plain' } })
        host.innerHTML = `
            <div data-component="cel-ok-list"><ul data-list="tags" data-key="id"><template><li data-bind="name"></li></template></ul></div>
            <div data-component="cel-ok-pool"><div data-pool="dots"><template><i data-bind="label"></i></template></div></div>
            <div data-component="cel-plain"><span data-bind="title"></span></div>`
        wildflower.scan()
        await settle()

        expect(coded(warned)).toEqual([])
        expect(host.querySelector('[data-component="cel-plain"] span').textContent).toBe('plain')
        if (hasFeature('lists')) expect(texts(host.querySelectorAll('li'))).toEqual(['own-a', 'own-b'])
        if (pools) expect(texts(host.querySelectorAll('i'))).toEqual(['own-dot'])
    })

    // The parent's query transform writes data-list="$name.rows" onto a
    // data-query element with a <template> before the child component is
    // created. That list is the framework's, not the author's.
    it.skipIf(!hasFeature('query'))('a component element that is a data-query container does not warn', async () => {
        const q = 'celQueryKid'
        wildflower.query(q, { from: async () => [{ id: 1, name: 'qa' }, { id: 2, name: 'qb' }] })
        wildflower.component('cel-query-parent', { state: {} })
        wildflower.component('cel-query-kid', { state: {} })
        host.innerHTML = `<div data-component="cel-query-parent"><div class="qk" data-component="cel-query-kid" data-query="${q}"><template><p data-bind="name"></p></template></div></div>`
        wildflower.scan()
        await settle(100)

        expect(host.querySelector('.qk').getAttribute('data-list')).toBe(`$${q}.rows`)
        expect(coded(warned)).toEqual([])
    })

    it.skipIf(!hasFeature('lists'))('a component that is a list row\'s root does not warn: it is a row, not a list container', async () => {
        wildflower.component('cel-card', { props: { item: { type: 'object' } } })
        wildflower.component('cel-board', { state: { cards: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }] } })
        host.innerHTML = '<div data-component="cel-board"><ul data-list="cards" data-key="id"><template><li data-component="cel-card" data-prop-item="."><b data-bind="props.item.name"></b></li></template></ul></div>'
        wildflower.scan()
        await settle(100)

        expect(coded(warned)).toEqual([])
        expect(texts(host.querySelectorAll('li b'))).toEqual(['one', 'two'])
    })
})
