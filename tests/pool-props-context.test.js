/**
 * A pool with `props` evaluates each entity's bindings against one reused
 * context buffer (entity fields plus `props`). The buffer used to be filled
 * with Object.assign(buffer, entity) and never cleared, so:
 *   - an entity missing a field rendered the PREVIOUS entity's value for it
 *     (text, show, class, style, attr alike);
 *   - an entity from JSON carrying an own `__proto__` key replaced the
 *     buffer's prototype, and every entity rendered after it read the
 *     payload's fields.
 * The buffer is now pre-shaped with exactly the names the template reads, and
 * every name is refilled from the entity on every apply (undefined when the
 * entity lacks it). Pools without props bind straight to the entity and were
 * never affected.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('pools') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-ppc-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('pool props: the per-entity binding context', () => {
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
        delete Object.prototype.isAdmin
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    async function mountPool(template, def) {
        const c = uname('c')
        let pool
        wildflower.component(c, {
            state: {},
            pools: { items: def },
            init() { pool = this.getPool('items') }
        })
        container.innerHTML = `
            <div data-component="${c}">
                <div data-pool="items" data-key="id"><template>${template}</template></div>
            </div>
        `
        wildflower.scan(container)
        await settle()
        return pool
    }

    const rows = () => [...container.querySelectorAll('.row')]

    it('an entity missing a field does not render the previous entity\'s value', async () => {
        const pool = await mountPool(`
            <div class="row" data-bind-class="badge ? 'has-badge' : 'none'" data-bind-attr="{ title: badge }">
                <b class="bd" data-bind="badge"></b>
                <i class="sh" data-show="badge">B</i>
                <u class="st" data-bind-style="{ color: badge ? 'red' : '' }"></u>
                <span class="px" data-bind="props.caption"></span>
            </div>`, { props: { caption: 'cap' }, entity: {} })

        pool.push({ id: 1, badge: 'GOLD' })
        pool.push({ id: 2 })
        await settle()

        const [a, b] = rows()
        expect(a.querySelector('.bd').textContent).toBe('GOLD')
        expect(b.querySelector('.bd').textContent).toBe('')
        expect(b.querySelector('.sh').style.display).toBe('none')
        expect(b.classList.contains('none')).toBe(true)
        expect(b.classList.contains('has-badge')).toBe(false)
        expect(b.hasAttribute('title')).toBe(false)
        expect(b.querySelector('.st').style.color).toBe('')
        expect(b.querySelector('.px').textContent).toBe('cap')
    })

    it('an entity carrying an own __proto__ key does not leak into other entities', async () => {
        const pool = await mountPool(`
            <div class="row">
                <b class="nm" data-bind="name"></b>
                <i class="adm" data-show="isAdmin">ADMIN</i>
                <u class="cls" data-bind-class="isAdmin ? 'adm' : 'no'"></u>
            </div>`, { props: { x: 1 }, entity: {} })

        pool.push(JSON.parse('{"id":1,"name":"evil","__proto__":{"isAdmin":true}}'))
        pool.push({ id: 2, name: 'clean' })
        await settle()

        for (const r of rows()) {
            expect(r.querySelector('.adm').style.display).toBe('none')
            expect(r.querySelector('.cls').classList.contains('no')).toBe(true)
        }
        expect(rows()[1].querySelector('.nm').textContent).toBe('clean')
        expect(({}).isAdmin).toBeUndefined()
    })

    it('entity.computed and props both still reach the bindings', async () => {
        const pool = await mountPool(`
            <div class="row">
                <b class="lbl" data-bind="label"></b>
                <i class="sel" data-bind-class="id === props.selectedId ? 'on' : 'off'"></i>
            </div>`, {
            props: { selectedId: 2 },
            entity: { computed: { label() { return 'n' + this.n } } }
        })

        pool.push({ id: 1, n: 1 })
        pool.push({ id: 2, n: 2 })
        await settle()

        const [a, b] = rows()
        expect(a.querySelector('.lbl').textContent).toBe('n1')
        expect(b.querySelector('.lbl').textContent).toBe('n2')
        const on = (r) => r.querySelector('.sel').classList.contains('on')
        expect(on(a)).toBe(false)
        expect(on(b)).toBe(true)

        pool.props.selectedId = 1
        await settle()
        expect(on(a)).toBe(true)
        expect(on(b)).toBe(false)
    })
})
