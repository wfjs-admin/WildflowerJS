/**
 * A binding value is an expression whenever it is more than a property path.
 *
 * These forms hold no arithmetic, comparison or logical operator and no
 * parenthesis, and are expressions all the same: a bracket with anything but
 * a number in it, nullish coalescing, optional chaining, and the keyword
 * operators typeof and in. Each is evaluated bare, as it is in parentheses,
 * in a component binding and in a list row, and follows the state it reads.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-bef-${++seq}`
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))

const FORMS = [
    ['arr[idx]', 'b'],
    ["obj['x']", 'X'],
    ["obj['deep'].y", 'Y'],
    ["nul ?? 'd'", 'd'],
    ['user?.name', 'U'],
    ['missing?.name ?? "none"', 'none'],
    ['typeof n', 'number'],
    ["'x' in obj", 'true'],
    ['arr[0]', 'a'],
]

describe('binding values that are expressions without an operator character', () => {
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

    const state = () => ({
        arr: ['a', 'b', 'c'], idx: 1, nul: null, n: 5, user: { name: 'U' }, missing: null,
        obj: { x: 'X', deep: { y: 'Y' } }, flags: [false, true], rows: [{ id: 1, tags: ['p', 'q'], pick: 1, extra: null }],
    })

    const mount = async (inner) => {
        const name = uname('c')
        let ctx
        wildflower.component(name, { state: state(), init() { ctx = this } })
        container.innerHTML = `<div data-component="${name}">${inner}</div>`
        wildflower.scan(container)
        await settle()
        return ctx
    }

    it.each(FORMS)('data-bind="%s" renders as it does in parentheses', async (expr, expected) => {
        const attr = expr.includes('"') ? `'${expr}'` : `"${expr}"`
        const wrapped = expr.includes('"') ? `'(${expr})'` : `"(${expr})"`
        await mount(`<span class="bare" data-bind=${attr}></span><span class="wrapped" data-bind=${wrapped}></span>`)
        expect(container.querySelector('.wrapped').textContent).toBe(expected)
        expect(container.querySelector('.bare').textContent).toBe(expected)
    })

    it('a bracket with a state name in it follows that state', async () => {
        const ctx = await mount('<span class="pick" data-bind="arr[idx]"></span><i class="flag" data-show="flags[idx]">on</i>')
        const flag = container.querySelector('.flag')
        expect(container.querySelector('.pick').textContent).toBe('b')
        expect(getComputedStyle(flag).display).not.toBe('none')
        ctx.idx = 0
        await settle()
        expect(container.querySelector('.pick').textContent).toBe('a')
        expect(getComputedStyle(flag).display).toBe('none')
    })

    const itIfLists = hasFeature('lists') ? it : it.skip

    itIfLists('the same forms work in a list row', async () => {
        const ctx = await mount(`<ul data-list="rows" data-key="id"><template><li>
            <b class="tag" data-bind="tags[pick]"></b><b class="extra" data-bind="extra ?? 'none'"></b>
        </li></template></ul>`)
        expect(container.querySelector('.tag').textContent).toBe('q')
        expect(container.querySelector('.extra').textContent).toBe('none')
        ctx.rows[0].pick = 0
        await settle()
        expect(container.querySelector('.tag').textContent).toBe('p')
    })
})
