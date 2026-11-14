/**
 * A data-list fed a frozen array (Object.freeze([]), a shared empty constant)
 * renders it as it would the same array unfrozen. Found by Kinetic's check():
 * a frozen empty array left the previous rows on the page, where a plain []
 * cleared them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))
const EMPTY = Object.freeze([])

describe.skipIf(!hasFeature('lists'))('data-list over a frozen array', () => {
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

    const rows = () => container.querySelectorAll('li').length

    it('a computed that returns a frozen empty array clears the list', async () => {
        wildflower.component('lf-computed', {
            state: { on: true },
            computed: { items() { return this.on ? [{ k: 1 }, { k: 2 }] : EMPTY } },
        })
        container.innerHTML = `<div data-component="lf-computed">
            <ul data-list="items" data-key="k"><template><li data-bind="k"></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(rows()).toBe(2)
        const c = wildflower.getComponent('lf-computed')
        c.on = false
        await settle()
        expect(rows()).toBe(0)
        c.on = true
        await settle()
        expect(rows()).toBe(2)
        c.on = false
        await settle()
        expect(rows()).toBe(0)
    })

    it('state assigned a frozen empty array clears the list', async () => {
        wildflower.component('lf-state', { state: { items: [{ k: 1 }, { k: 2 }] } })
        container.innerHTML = `<div data-component="lf-state">
            <ul data-list="items" data-key="k"><template><li data-bind="k"></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(rows()).toBe(2)
        wildflower.getComponent('lf-state').items = EMPTY
        await settle()
        expect(rows()).toBe(0)
    })

    it('a computed that returns a frozen array of rows renders them', async () => {
        const ROWS = Object.freeze([Object.freeze({ k: 1 }), Object.freeze({ k: 2 }), Object.freeze({ k: 3 })])
        wildflower.component('lf-rows', {
            state: { on: false },
            computed: { items() { return this.on ? ROWS : [] } },
        })
        container.innerHTML = `<div data-component="lf-rows">
            <ul data-list="items" data-key="k"><template><li data-bind="k"></li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        expect(rows()).toBe(0)
        wildflower.getComponent('lf-rows').on = true
        await settle()
        expect(rows()).toBe(3)
        expect(container.querySelector('li').textContent).toBe('1')
    })
})
