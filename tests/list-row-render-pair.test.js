/**
 * A list row with an if/else pair, data-render="x" beside data-render="!x":
 * each element follows its own condition. The row looked its compiled
 * binding up by the path with the "!" stripped, so the negated element took
 * the positive element's binding and lost its negation: after the first
 * toggle both showed or neither did. Holds for a state path and a
 * $store.path, with either element first.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe.skipIf(!hasFeature('lists'))('a data-render pair in a list row', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    const count = () => container.querySelectorAll('.p').length + '/' + container.querySelectorAll('.n').length

    for (const source of ['state', 'store']) {
        for (const negatedFirst of [false, true]) {
            it(`${source} path, ${negatedFirst ? 'negated' : 'positive'} element first`, async () => {
                const c = `lrrp-${++seq}`; const s = `lrrpstore${seq}`
                wildflower.store(s, { state: { on: false } })
                wildflower.component(c, { state: { items: [{ id: 1 }, { id: 2 }], on: false } })
                const path = source === 'state' ? 'on' : `$${s}.on`
                const p = `<b class="p" data-render="${path}">P</b>`
                const n = `<b class="n" data-render="!${path}">N</b>`
                container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li>${negatedFirst ? n + p : p + n}</li></template></ul></div>`
                wildflower.scan(container)
                await settle()
                const set = (v) => { if (source === 'state') wildflower.getComponent(c).on = v; else wildflower.getStore(s).on = v }
                const seen = [count()]
                for (const v of [true, false, true]) {
                    set(v)
                    await settle()
                    seen.push(count())
                }
                expect(seen).toEqual(['0/2', '2/0', '0/2', '2/0'])
            })
        }
    }
})
