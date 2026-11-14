/**
 * Components placed in a data-list row (packages/kinetic/test/coverage-arrivals.test.js
 * found the first two with scenes).
 *
 * 1. Row removal destroys the row's components: one nested inside the row and
 *    one on the row's own element, on single-row removal and on bulk removal
 *    (a full clear, a keyed replace of ten or more rows). Before 1.5.6 the row
 *    element's own component was skipped, and bulk removal destroyed none.
 * 2. A binding inside a component nested below a row's element reads the
 *    nested component's own computed. Before 1.5.6 it read a same-named
 *    computed of the list host (state names were already the component's).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!hasFeature('lists'))('components in list rows (findings)', () => {
    let wildflower
    let container

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('a component nested inside a row is destroyed when the list removes the row', async () => {
        const log = []
        wildflower.component('lr-nested', { destroy() { log.push('destroyed') } })
        wildflower.component('lr-host-a', { state: { items: [{ id: 1 }, { id: 2 }] }, drop() { this.items = this.items.slice(0, 1) } })
        container.innerHTML = `<div data-component="lr-host-a">
            <ul data-list="items" data-key="id"><template><li><span data-component="lr-nested"></span></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelectorAll('li').length).toBe(2)
        wildflower.getComponent('lr-host-a').drop()
        await settle(300)
        expect(container.querySelectorAll('li').length).toBe(1)
        expect(log).toEqual(['destroyed'])
    })

    it('a component on the row\'s own element is destroyed when the list removes the row', async () => {
        const log = []
        wildflower.component('lr-row', { destroy() { log.push('destroyed') } })
        wildflower.component('lr-host-b', { state: { items: [{ id: 1 }, { id: 2 }] }, drop() { this.items = this.items.slice(0, 1) } })
        container.innerHTML = `<div data-component="lr-host-b">
            <ul data-list="items" data-key="id"><template><li data-component="lr-row"></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelectorAll('li').length).toBe(2)
        wildflower.getComponent('lr-host-b').drop()
        await settle(300)
        expect(container.querySelectorAll('li').length).toBe(1)
        expect(log).toEqual(['destroyed'])
    })

    // Bulk removal (a full clear, or a keyed replace of ten or more rows with
    // new keys) takes a separate path from single-row removal.
    const bulkCases = [
        ['nested in the row', '<li><span data-component="NAME"></span></li>'],
        ['on the row element', '<li data-component="NAME"></li>'],
    ]
    for (const [where, row] of bulkCases) {
        it(`a component ${where} is destroyed when the list is cleared`, async () => {
            const log = []
            const name = `lr-clear-${where.length}`
            wildflower.component(name, { destroy() { log.push('destroyed') } })
            wildflower.component(`${name}-host`, { state: { items: [{ id: 1 }, { id: 2 }] }, clear() { this.items = [] } })
            container.innerHTML = `<div data-component="${name}-host">
                <ul data-list="items" data-key="id"><template>${row.replace('NAME', name)}</template></ul>
            </div>`
            wildflower.scan(container)
            await settle()
            expect(container.querySelectorAll('li').length).toBe(2)
            wildflower.getComponent(`${name}-host`).clear()
            await settle(300)
            expect(container.querySelectorAll('li').length).toBe(0)
            expect(log).toEqual(['destroyed', 'destroyed'])
        })

        it(`a component ${where} is destroyed when ten rows are replaced by new keys`, async () => {
            const log = []
            const name = `lr-replace-${where.length}`
            const rows = (from) => Array.from({ length: 10 }, (_, i) => ({ id: from + i }))
            wildflower.component(name, { destroy() { log.push('destroyed') } })
            wildflower.component(`${name}-host`, { state: { items: rows(1) }, replace() { this.items = rows(100) } })
            container.innerHTML = `<div data-component="${name}-host">
                <ul data-list="items" data-key="id"><template>${row.replace('NAME', name)}</template></ul>
            </div>`
            wildflower.scan(container)
            await settle()
            expect(container.querySelectorAll('li').length).toBe(10)
            wildflower.getComponent(`${name}-host`).replace()
            await settle(300)
            expect(container.querySelectorAll('li').length).toBe(10)
            expect(log.length).toBe(10)
        })
    }

    it('a state binding inside a component nested in a row reads that component, not a same-named field of the host', async () => {
        wildflower.component('lr-child', { state: { label: 'CHILD' } })
        wildflower.component('lr-host-c', { state: { label: 'HOST', items: [{ id: 1 }] } })
        container.innerHTML = `<div data-component="lr-host-c">
            <ul data-list="items" data-key="id"><template><li><span data-component="lr-child"><b class="v" data-bind="label"></b></span></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.v').textContent).toBe('CHILD')
    })

    it('a computed binding inside a component nested in a row reads that component, not a same-named computed of the host', async () => {
        wildflower.component('lr-child-c', { computed: { label() { return 'CHILD' } } })
        wildflower.component('lr-host-d', { state: { items: [{ id: 1 }] }, computed: { label() { return 'HOST' } } })
        container.innerHTML = `<div data-component="lr-host-d">
            <ul data-list="items" data-key="id"><template><li><div data-component="lr-child-c"><b class="v" data-bind="label"></b></div></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.v').textContent).toBe('CHILD')
    })

    // The pass-through the boundary filter keeps: a name the nested component
    // does not own is read from the row item.
    it('a binding inside a component nested in a row reads the row item when the component does not own the name', async () => {
        wildflower.component('lr-child-p', { computed: { other() { return 'X' } } })
        wildflower.component('lr-host-p', { state: { items: [{ id: 1, title: 'ROW' }] } })
        container.innerHTML = `<div data-component="lr-host-p">
            <ul data-list="items" data-key="id"><template><li><div data-component="lr-child-p"><b class="v" data-bind="title"></b></div></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.v').textContent).toBe('ROW')
    })
})
