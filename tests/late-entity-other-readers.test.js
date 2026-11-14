/**
 * Three more readers of an entity that is not there when they first run.
 *
 * 1. data-cloak with data-show over a store that registers late, in
 *    server-rendered markup: the strip of data-cloak took its own verdict,
 *    without the rule that keeps server content until the entity arrives, and
 *    hid the element. Every reader of a condition's verdict now applies that
 *    rule.
 * 2. A store unregistered and registered again under the same name: bindings
 *    and lists that read the first instance stayed on it. They now read the
 *    name again.
 * 3. data-model="store.field" (the store named without a $) over a store
 *    registered after the component scanned: the first run recorded that the
 *    name was no store, and never looked again.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
let seq = 0

describe('other readers of a late or replaced entity', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    it.skipIf(!hasFeature('ssr'))('a cloaked data-show over a late store in server markup stays as the server left it, then follows the store', async () => {
        const c = `leor-${++seq}`; const s = `leorstore${seq}`
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}" data-ssr="true"><div class="x" data-cloak data-show="$${s}.v">shown</div></div>`
        wildflower.scan(container)
        await settle()
        await frames()
        const x = container.querySelector('.x')
        expect(x.hasAttribute('data-cloak')).toBe(false)
        expect(x.style.display).toBe('')
        wildflower.store(s, { state: { v: false } })
        await settle()
        expect(x.style.display).toBe('none')
        wildflower.getStore(s).v = true
        await settle()
        expect(x.style.display).toBe('')
    })

    for (const gap of [false, true]) {
        it(`a store unregistered and registered again ${gap ? 'later' : 'at once'}: a binding, a computed and a list row read the new one`, async () => {
            const c = `leor-${++seq}`; const s = `leorstore${seq}`
            wildflower.store(s, { state: { v: 'A', rows: [{ id: 1, t: 'a1' }] } })
            wildflower.component(c, {
                state: { items: [{ id: 1, name: 'x' }] },
                computed: { loud() { const st = wildflower.getStore(s); return st ? String(st.v).toLowerCase() : '-' } },
            })
            const lists = hasFeature('lists')
                ? `<ul data-list="items" data-key="id"><template><li><b data-bind="name"></b><em class="r" data-bind="$${s}.v"></em></li></template></ul>` +
                  `<ol data-list="$${s}.rows" data-key="id"><template><li class="o" data-bind="t"></li></template></ol>`
                : ''
            container.innerHTML = `<div data-component="${c}"><span class="t" data-bind="$${s}.v"></span><span class="k" data-bind="loud"></span>${lists}</div>`
            wildflower.scan(container)
            await settle()
            const read = () => [container.querySelector('.t').textContent, container.querySelector('.k').textContent]
                .concat(lists ? [[...container.querySelectorAll('.r')].map(e => e.textContent).join(), [...container.querySelectorAll('.o')].map(e => e.textContent).join()] : [])
                .join('|')
            expect(read()).toBe(lists ? 'A|a|A|a1' : 'A|a')
            wildflower.unregister(s)
            if (gap) await settle()
            wildflower.store(s, { state: { v: 'B', rows: [{ id: 1, t: 'b1' }, { id: 2, t: 'b2' }] } })
            await settle()
            expect(read()).toBe(lists ? 'B|b|B|b1,b2' : 'B|b')
            wildflower.getStore(s).v = 'C'
            if (lists) wildflower.getStore(s).rows.push({ id: 3, t: 'b3' })
            await settle()
            expect(read()).toBe(lists ? 'C|c|C|b1,b2,b3' : 'C|c')
        })
    }

    // Outside server-rendered markup only. In it, activation reads the
    // input's server value into the component's state under that path, so
    // the component owns the name from then on and a store registered later
    // is not involved (the component-first rule, as in the control below).
    it('data-model="store.field" over a store registered after the scan', async () => {
        const c = `leor-${++seq}`; const s = `leorstore${seq}`
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}"><input class="i" data-model="${s}.name" value="Server"></div>`
        wildflower.scan(container)
        await settle()
        const input = container.querySelector('.i')
        wildflower.store(s, { state: { name: 'Store' } })
        await settle()
        expect(input.value).toBe('Store')
        wildflower.getStore(s).name = 'Store2'
        await settle()
        expect(input.value).toBe('Store2')
        input.value = 'Typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(wildflower.getStore(s).name).toBe('Typed')
    })

    it('data-model on a path the component owns is not taken for a store that registers later under that name (control)', async () => {
        const c = `leor-${++seq}`; const s = `leorform${seq}`
        wildflower.component(c, { state: { [s]: { name: 'Mine' } } })
        container.innerHTML = `<div data-component="${c}"><input class="i" data-model="${s}.name"></div>`
        wildflower.scan(container)
        await settle()
        const input = container.querySelector('.i')
        expect(input.value).toBe('Mine')
        const warn = console.warn
        console.warn = () => {}
        try {
            wildflower.store(s, { state: { name: 'Store' } })
            await settle()
            wildflower.getComponent(c)[s].name = 'Mine2'
            await settle()
        } finally { console.warn = warn }
        expect(input.value).toBe('Mine2')
    })
})
