/**
 * data-bind-class string values whose characters are outside printable ASCII.
 *
 * A class value that is one printable-ASCII name is used as it is. Any other
 * value is split on whitespace. These cases cover both sides of that rule: a
 * name in another script, with an accent, or with an emoji is still one
 * class; a tab, a newline, a carriage return, or a form feed separates names
 * as a space does; a control character that is not whitespace stays inside
 * its name. Each value is bound on a component's element and in the rows of
 * a list, then replaced by a plain name and put back, so the classes a value
 * added are the ones taken away.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
let seq = 0

// [label, the bound value, the classes it names]
const VALUES = [
    ['an accented name', 'café', ['café']],
    ['a name in another script', '日本語', ['日本語']],
    ['an emoji', '🔥', ['🔥']],
    ['two accented names', 'café naïve', ['café', 'naïve']],
    ['an accented name beside a plain one', 'on café', ['café', 'on']],
    ['a tab between names', 'a\tb', ['a', 'b']],
    ['a newline between names', 'a\nb', ['a', 'b']],
    ['a carriage return and a form feed between names', 'a\r\fb', ['a', 'b']],
    ['a space before and after one name', ' on ', ['on']],
    ['a control character inside a name', 'a\u0001b', ['a\u0001b']],
    ['a delete character inside a name', 'a\u007fb', ['a\u007fb']],
]

describe('data-bind-class: names outside printable ASCII, and whitespace other than a space', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    // The element's classes apart from the static one and the framework's own.
    const bound = (el) => [...el.classList].filter(c => c !== 'x' && c.indexOf('wf-') !== 0).sort()

    for (const [label, value, names] of VALUES) {
        it(`on a component: ${label}`, async () => {
            const c = `cbn-${++seq}`
            wildflower.component(c, { state: { v: value, t: 'T1' } })
            container.innerHTML = `<div data-component="${c}"><b class="x" data-bind-class="v">c</b><i class="after" data-bind="t"></i></div>`
            wildflower.scan(container)
            await settle()
            const el = container.querySelector('.x')
            expect(bound(el)).toEqual(names)

            const ctx = wildflower.getComponent(c)
            ctx.v = 'plain'; ctx.t = 'T2'
            await settle()
            expect(bound(el), 'every class the value added is gone').toEqual(['plain'])
            expect(container.querySelector('.after').textContent, 'the binding after it still runs').toBe('T2')

            ctx.v = value
            await settle()
            expect(bound(el)).toEqual(names)
        })

        it.skipIf(!hasFeature('lists'))(`in a list row: ${label}`, async () => {
            const c = `cbn-${++seq}`
            const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, v: value }))
            wildflower.component(c, { state: { rows } })
            container.innerHTML = `<div data-component="${c}"><ul data-list="rows" data-key="id"><template>` +
                `<li class="x" data-bind-class="v"><span class="x in" data-bind-class="v" data-bind="id"></span></li>` +
                `</template></ul></div>`
            wildflower.scan(container)
            await settle()
            const lis = () => [...container.querySelectorAll('li')]
            const inner = (li) => bound(li.querySelector('span')).filter(k => k !== 'in')
            expect(lis().length).toBe(12)
            for (const li of lis()) {
                expect(bound(li)).toEqual(names)
                expect(inner(li)).toEqual(names)
            }

            const ctx = wildflower.getComponent(c)
            ctx.rows[3].v = 'plain'
            await settle()
            expect(bound(lis()[3]), 'every class the value added is gone').toEqual(['plain'])
            expect(inner(lis()[3])).toEqual(['plain'])
            expect(bound(lis()[4]), 'the next row keeps its own').toEqual(names)

            ctx.rows[3].v = value
            await settle()
            expect(bound(lis()[3])).toEqual(names)
            expect(inner(lis()[3])).toEqual(names)
        })
    }
})
