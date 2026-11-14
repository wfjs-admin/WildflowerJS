/**
 * $el().html() on a list row's position-bound data-bind-html cell, then a
 * push. The position sweep repaints a cell only when its value moved from
 * the one the last writer recorded; .html() recorded nothing, so a row whose
 * position value stayed the same kept the hand-written html, and a row whose
 * value moved got the binding back.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uname = () => `lbh-manual-${++seq}`

describe.skipIf(!hasFeature('lists'))('$el().html() on a position-bound data-bind-html cell', () => {
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

    const cells = (sel) => [...container.querySelectorAll(sel)].map(el => el.innerHTML)

    for (const keyed of [false, true]) {
        const k = keyed ? 'keyed' : 'keyless'

        it(`every row shows the binding after the next push (${k})`, async () => {
            const c = uname()
            wildflower.component(c, {
                state: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
                poke() { this.$el('.l').html('X') }
            })
            container.innerHTML = `<div data-component="${c}">
                <ul data-list="items"${keyed ? ' data-key="id"' : ''}><template><li><b class="l" data-bind-html="_last"></b></li></template></ul>
            </div>`
            wildflower.scan(container)
            await settle()
            const comp = wildflower.getComponent(c)
            expect(cells('.l')).toEqual(['false', 'false', 'true'])
            comp.poke()
            expect(cells('.l')).toEqual(['X', 'X', 'X'])
            comp.items.push({ id: 'd' })
            await settle()
            expect(cells('.l')).toEqual(['false', 'false', 'false', 'true'])
        })
    }
})
