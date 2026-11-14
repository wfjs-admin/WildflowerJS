/**
 * data-bind-html in a list row reads the list's position names (_index,
 * _length, _first, _last) as data-bind does: data-bind-html="_index" renders
 * the index, on first paint too, as data-bind="_index" and
 * data-bind-html="'' + _index" do.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uname = () => `lbh-pos-${++seq}`

describe.skipIf(!hasFeature('lists'))('data-bind-html with a list position name', () => {
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

    const mount = async (cell, keyed = false) => {
        const c = uname()
        wildflower.component(c, { state: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } })
        container.innerHTML = `<div data-component="${c}">
            <ul data-list="items"${keyed ? ' data-key="id"' : ''}><template><li>${cell}</li></template></ul>
        </div>`
        wildflower.scan(container)
        await settle()
        return wildflower.getComponent(c)
    }
    const cells = (sel) => [...container.querySelectorAll(sel)].map(el => el.innerHTML)

    for (const keyed of [false, true]) {
        const k = keyed ? 'keyed' : 'keyless'

        it(`_index renders on first paint and after a removal (${k})`, async () => {
            const c = await mount('<b class="h" data-bind-html="_index"></b><i class="t" data-bind="_index"></i>', keyed)
            expect(cells('.t')).toEqual(['0', '1', '2'])
            expect(cells('.h')).toEqual(['0', '1', '2'])
            c.items.splice(0, 1)
            await settle()
            expect(cells('.t')).toEqual(['0', '1'])
            expect(cells('.h')).toEqual(['0', '1'])
        })

        it(`_length, _first and _last render (${k})`, async () => {
            const c = await mount('<b class="n" data-bind-html="_length"></b><b class="f" data-bind-html="_first"></b><b class="l" data-bind-html="_last"></b>', keyed)
            expect(cells('.n')).toEqual(['3', '3', '3'])
            expect(cells('.f')).toEqual(['true', 'false', 'false'])
            expect(cells('.l')).toEqual(['false', 'false', 'true'])
            c.items.push({ id: 'd' })
            await settle()
            expect(cells('.n')).toEqual(['4', '4', '4', '4'])
            expect(cells('.l')).toEqual(['false', 'false', 'false', 'true'])
        })
    }

    it('an item field and an expression still render (control)', async () => {
        await mount('<b class="x" data-bind-html="id"></b><b class="e" data-bind-html="\'\' + _index"></b>')
        expect(cells('.x')).toEqual(['a', 'b', 'c'])
        expect(cells('.e')).toEqual(['0', '1', '2'])
    })
})
