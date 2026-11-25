/**
 * An attribute bound to an item field in a list row is written the same way
 * on a later write as on the first render.
 *
 * `false` on an attribute that is not a boolean attribute is the text
 * "false" (aria-pressed="false"), and `false` on a boolean attribute removes
 * it, whether the value arrives with the row or in a write to the item.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfLists = hasFeature('lists') ? describe : describe.skip
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIfLists('a bound attribute in a list row, on later writes', () => {
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

    it('false stays "false" on aria-pressed and removes disabled', async () => {
        const name = `lral-${++seq}`
        let ctx
        wildflower.component(name, { state: { rows: [{ id: 1, label: 'a', on: false, off: false }] }, init() { ctx = this } })
        container.innerHTML = `<div data-component="${name}"><ul data-list="rows" data-key="id"><template><li>
            <button class="b" data-bind-attr="{ 'aria-pressed': on }" data-bind="label"></button>
            <button class="d" data-bind-attr="{ disabled: off }" data-bind="label"></button>
        </li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const pressed = () => container.querySelector('.b').getAttribute('aria-pressed')
        const disabled = () => container.querySelector('.d').hasAttribute('disabled')
        expect([pressed(), disabled()]).toEqual(['false', false])
        ctx.rows[0].on = true
        ctx.rows[0].off = true
        await settle()
        expect([pressed(), disabled()]).toEqual(['true', true])
        ctx.rows[0].on = false
        ctx.rows[0].off = false
        await settle()
        expect([pressed(), disabled()]).toEqual(['false', false])
    })
})
