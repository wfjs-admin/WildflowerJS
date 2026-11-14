/**
 * A list row whose only read of a store is in a class binding follows the
 * store. Such a template was classed as reading item fields only (a class
 * binding's other reads were taken for component state, which the
 * component's refresh effect follows), so nothing followed the store: in a
 * component with a binding of its own the class never changed after the
 * first render. A component with no other binding repainted its rows on
 * every store write, which hid it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('lists') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIf('a list row class binding that reads a store', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    const on = () => [...container.querySelectorAll('.r')].map(el => el.classList.contains('on'))

    const ROWS = [
        ['on an element in the row', (s) => `<li><b data-bind="name"></b><i class="r" data-bind-class="{ on: $${s}.on }">r</i></li>`],
        ['on the row itself', (s) => `<li class="r" data-bind-class="{ on: $${s}.on }"><b data-bind="name"></b></li>`],
        ['with an item field in the expression', (s) => `<li><b data-bind="name"></b><i class="r" data-bind-class="{ on: $${s}.on && name }">r</i></li>`],
        ['in the long form', (s) => `<li><b data-bind="name"></b><i class="r" data-bind-class="{ on: external('${s}', 'on') }">r</i></li>`],
    ]
    for (const [label, row] of ROWS) {
        for (const own of [true, false]) {
            it(`${label}, in a component with ${own ? 'a binding of its own' : 'only the list'}`, async () => {
                const c = `lrcs-${++seq}`; const s = `lrcsstore${seq}`
                wildflower.store(s, { state: { on: false } })
                wildflower.component(c, { state: { label: 'L', items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } })
                container.innerHTML = `<div data-component="${c}">${own ? '<p data-bind="label"></p>' : ''}<ul data-list="items" data-key="id"><template>${row(s)}</template></ul></div>`
                wildflower.scan(container)
                await settle()
                expect(on()).toEqual([false, false])
                wildflower.getStore(s).on = true
                await settle()
                expect(on()).toEqual([true, true])
                wildflower.getStore(s).on = false
                await settle()
                expect(on()).toEqual([false, false])
                wildflower.getComponent(c).items.push({ id: 3, name: 'C' })
                wildflower.getStore(s).on = true
                await settle()
                expect(on()).toEqual([true, true, true])
            })
        }
    }
})
