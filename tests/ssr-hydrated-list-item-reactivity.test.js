/**
 * SSR-hydrated list rows must stay REACTIVE to item-data changes after
 * hydration — the coverage gap behind the ssr-computed example bug, where
 * adjusting a quantity recalculated the component-level computeds (subtotal /
 * tax / total) but the per-row quantity binding never re-rendered.
 *
 * The existing SSR suite covers hydration mechanics (detection, protection,
 * phases, state extraction, list structure, initial binding) but never mutates
 * an item property on a hydrated list and asserts the bound row updated. These
 * tests close that gap for both mutation styles: in-place (item.prop++) and
 * immutable (items[i] = { ...items[i] }).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// SSR ships only in feature-complete builds; skip on variants without it.
const describeIfSSR = hasFeature('ssr') ? describe : describe.skip

async function waitForUpdate(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

// Server-rendered markup: a data-ssr list with a <template> AND pre-rendered
// rows carrying initial values, mirroring the ssr-computed example.
function ssrOrderMarkup(componentName) {
    // Server-rendered rows carry ALL bound fields (name/price/quantity), as real
    // SSR output does; the adopted list re-reads item state from the DOM on
    // re-render, so every field the component needs must be present.
    const row = (name, price, qty) => `
      <div class="order-item">
        <span class="nm" data-bind="name">${name}</span>
        <span class="pr" data-bind="price" data-type="number">${price}</span>
        <span class="qty" data-bind="quantity" data-type="number">${qty}</span>
      </div>`
    return `
      <div data-component="${componentName}" data-ssr="true">
        <div data-list="items">
          <template>
            <div class="order-item">
              <span class="nm" data-bind="name"></span>
              <span class="pr" data-bind="price" data-type="number"></span>
              <span class="qty" data-bind="quantity" data-type="number"></span>
            </div>
          </template>
          ${row('A', 10, 2)}
          ${row('B', 5, 3)}
          ${row('C', 20, 1)}
        </div>
        <div class="subtotal" data-bind="subtotal">0</div>
      </div>`
}

const orderDef = {
    state: {
        items: [
            { name: 'A', price: 10, quantity: 2 },
            { name: 'B', price: 5, quantity: 3 },
            { name: 'C', price: 20, quantity: 1 }
        ]
    },
    computed: {
        subtotal() {
            return this.items.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2)
        }
    },
    bump(index) { this.items[index].quantity++ },
    replaceItem(index) { this.items[index] = { ...this.items[index], quantity: this.items[index].quantity + 1 } }
}

describeIfSSR('SSR hydrated list — item reactivity after hydration', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    const qtyTexts = () => [...testContainer.querySelectorAll('.qty')].map(s => s.textContent.trim())

    it('in-place item mutation re-renders the hydrated row binding', async () => {
        wildflower.component('ssr-order-inplace', { ...orderDef })
        testContainer.innerHTML = ssrOrderMarkup('ssr-order-inplace')
        wildflower.scan()
        await waitForUpdate()
        expect(qtyTexts()).toEqual(['2', '3', '1'])

        const inst = wildflower.getComponentsByType('ssr-order-inplace')[0]
        inst.context.bump(0)
        await waitForUpdate()

        // Both the component computed AND the per-row binding must reflect it.
        expect(testContainer.querySelector('.subtotal').textContent).toBe('65.00') // 10*3 + 5*3 + 20*1
        expect(qtyTexts()).toEqual(['3', '3', '1'])
    })

    it('immutable item replacement re-renders the hydrated row binding', async () => {
        wildflower.component('ssr-order-immutable', { ...orderDef })
        testContainer.innerHTML = ssrOrderMarkup('ssr-order-immutable')
        wildflower.scan()
        await waitForUpdate()
        expect(qtyTexts()).toEqual(['2', '3', '1'])

        const inst = wildflower.getComponentsByType('ssr-order-immutable')[0]
        inst.context.replaceItem(1)
        await waitForUpdate()

        expect(testContainer.querySelector('.subtotal').textContent).toBe('60.00') // 10*2 + 5*4 + 20*1
        expect(qtyTexts()).toEqual(['2', '4', '1'])
    })
})
