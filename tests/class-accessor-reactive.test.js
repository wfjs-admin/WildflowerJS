/**
 * A getter or setter on a class instance held in state is reactive.
 *
 * A getter runs with the reactive view of the instance as `this`, so the
 * fields it reads are tracked: a computed or a binding that reads the getter
 * updates when one of those fields is written. A setter runs the same way, so
 * the fields it writes wake their readers.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-car-${++seq}`
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))

class Cart {
    constructor() { this.qty = 1; this.price = 5 }
    get total() { return this.qty * this.price }
    set doubled(n) { this.qty = n * 2 }
}

class Basket extends Cart {
    get label() { return 'total ' + this.total }
}

describe('accessors on a class instance in state', () => {
    let wildflower
    let container

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
        container.remove()
    })

    const mount = async (cart) => {
        const name = uname('cart')
        let ctx
        wildflower.component(name, {
            state: { cart },
            computed: {
                fieldTotal() { return this.cart.qty * this.cart.price },
                getterTotal() { return this.cart.total },
            },
            init() { ctx = this },
        })
        container.innerHTML = `
            <div data-component="${name}">
                <span class="field" data-bind="fieldTotal"></span>
                <span class="getter" data-bind="getterTotal"></span>
                <span class="direct" data-bind="cart.total"></span>
                <span class="label" data-bind="cart.label"></span>
            </div>
        `
        wildflower.scan(container)
        await settle()
        const text = (cls) => container.querySelector('.' + cls).textContent
        return { ctx, text }
    }

    it('a computed that reads a getter updates when a field the getter reads is written', async () => {
        const { ctx, text } = await mount(new Cart())
        expect([text('field'), text('getter')]).toEqual(['5', '5'])
        ctx.cart.qty = 3
        await settle()
        expect([text('field'), text('getter')]).toEqual(['15', '15'])
    })

    it('a binding that reads a getter by path updates the same way', async () => {
        const { ctx, text } = await mount(new Cart())
        expect(text('direct')).toBe('5')
        ctx.cart.price = 4
        await settle()
        expect(text('direct')).toBe('4')
    })

    it('a getter inherited from a parent class, reading another getter, updates', async () => {
        const { ctx, text } = await mount(new Basket())
        expect(text('label')).toBe('total 5')
        ctx.cart.qty = 2
        await settle()
        expect(text('label')).toBe('total 10')
    })

    it('a setter that writes a field wakes the readers of that field', async () => {
        const { ctx, text } = await mount(new Cart())
        ctx.cart.doubled = 4
        await settle()
        expect(ctx.cart.qty).toBe(8)
        expect([text('field'), text('getter')]).toEqual(['40', '40'])
    })
})
