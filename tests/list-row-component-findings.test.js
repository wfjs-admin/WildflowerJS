/**
 * Two framework findings, pinned as expected failures until they are fixed
 * (packages/kinetic/test/coverage-arrivals.test.js found them with scenes).
 * Both are about a component placed in a data-list row.
 *
 * 1. A component whose element is the row's own root element is never
 *    destroyed when the list removes the row. A component nested inside the
 *    row is destroyed.
 * 2. A binding inside a component nested below a row's element reads the
 *    list host's value when the host has a field of the same name, instead
 *    of the nested component's own.
 *
 * Remove `.fails` from a case once the behaviour is fixed.
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

    it.fails('a component on the row\'s own element is destroyed when the list removes the row', async () => {
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
        expect(log).toEqual(['destroyed'])   // receives []
    })

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

    it.fails('a computed binding inside a component nested in a row reads that component, not a same-named computed of the host', async () => {
        wildflower.component('lr-child-c', { computed: { label() { return 'CHILD' } } })
        wildflower.component('lr-host-d', { state: { items: [{ id: 1 }] }, computed: { label() { return 'HOST' } } })
        container.innerHTML = `<div data-component="lr-host-d">
            <ul data-list="items" data-key="id"><template><li><div data-component="lr-child-c"><b class="v" data-bind="label"></b></div></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.v').textContent).toBe('CHILD')   // receives 'HOST'
    })
})
