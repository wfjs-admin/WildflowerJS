/**
 * Names that every plain object inherits (`constructor`, `toString`,
 * `valueOf`, `__proto__`) reaching a `{}` used as a lookup table.
 *
 * A `{}` "has" every Object.prototype member, so `name in table` and
 * `table[name]` find them for names nobody declared:
 *
 *   - The router parsed `?toString=a` as a SECOND occurrence of a key it had
 *     already seen, producing `[Object.prototype.toString, 'a']`, then wrote
 *     the function's source back into the URL; `?__proto__=p` replaced the
 *     query object's prototype. The URL is the most external input there is.
 *   - The graph's computed map was a `{}`, so a list item or query row field
 *     named `constructor` was read as a computed by `data-show` and stayed
 *     hidden while `data-bind` on the same field rendered it.
 *
 * Part of the rotation's L2 sweep (docs/reviews/).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-opn-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

describe('names Object.prototype also has', () => {
    let wildflower
    let container
    let realFetch

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
    })

    afterEach(() => {
        window.fetch = realFetch
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it.runIf(hasFeature('router'))('router: query keys named like Object.prototype members parse as plain keys', async () => {
        const router = new RouteManager({ mode: 'hash', routes: [{ path: '/search', content: 'S' }], outlet: container })
        try {
            await router.navigate('/search?toString=a&constructor=c&__proto__=p&q=1')
            await settle()
            const q = router.getCurrentRoute().query

            expect(q.toString).toBe('a')
            expect(q.constructor).toBe('c')
            expect(q.q).toBe('1')
            expect(Object.getPrototypeOf(q)).toBe(Object.prototype)
            expect(Object.keys(q)).toEqual(['toString', 'constructor', '__proto__', 'q'])
            expect(window.location.hash).not.toContain('native')
        } finally {
            if (router.destroy) router.destroy()
        }
    })

    it.runIf(hasFeature('lists'))('data-list: data-show on an item field named constructor reads the field', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { items: [{ id: 1, constructor: 'C1' }, { id: 2, constructor: '' }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="items" data-key="id">
                    <template><li class="row"><b class="c" data-bind="constructor"></b><i class="s" data-show="constructor">S</i></li></template>
                </ul>
            </div>
        `
        wildflower.scan(container)
        await settle()

        const [a, b] = container.querySelectorAll('.row')
        expect(a.querySelector('.c').textContent).toBe('C1')
        expect(a.querySelector('.s').style.display).not.toBe('none')
        expect(b.querySelector('.s').style.display).toBe('none')
    })

    // The CSP-safe parser checked `identifier in literals` against a `{}` of
    // keywords (true, false, null, undefined), so `constructor` or `valueOf`
    // parsed as a literal holding the inherited function:
    // `constructor + '!'` rendered "function Object() { [native code] }!".
    it('CSP-safe mode: identifiers named like Object.prototype members read state', async () => {
        wildflower.config({ forceCSPMode: true })
        try {
            const c = uname('c')
            wildflower.component(c, { state: { toString: '', constructor: 'C', n: 1 } })
            container.innerHTML = `
                <div data-component="${c}">
                    <b class="b" data-bind="constructor + '!'"></b>
                    <i class="s" data-show="n > 0 && toString">S</i>
                    <i class="k" data-bind-class="toString ? 'yes' : 'no'"></i>
                </div>
            `
            wildflower.scan(container)
            await settle()

            expect(container.querySelector('.b').textContent).toBe('C!')
            expect(container.querySelector('.s').style.display).toBe('none')
            expect(container.querySelector('.k').classList.contains('no')).toBe(true)
        } finally {
            wildflower.config({ forceCSPMode: false })
            if (wildflower._useCSPSafeEvaluation) wildflower._useCSPSafeEvaluation = false
        }
    })

    it.runIf(hasFeature('query'))('data-query: data-show on a row field named constructor reads the field', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Response('[{"id":1,"constructor":"C1"}]', { status: 200 })
        wildflower.query(q, { from: '/api/x', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row"><i class="s" data-show="constructor">S</i></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(container.querySelector('.s').style.display).not.toBe('none')
    })
})
