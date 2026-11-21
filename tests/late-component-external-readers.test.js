/**
 * Readers of another component that mounts after they have run.
 *
 * A binding or a computed can read another component's state by its name:
 * data-bind="$other.v", data-bind="external('other', 'v')", and
 * this.external('other', 'v') in a computed. When the other component is not
 * mounted yet, the reader gets nothing and waits for the name. A component
 * that mounts under that name is an arrival, as a store that registers is:
 * the readers run again, show its value, and follow it from then on.
 *
 * The cases cross the form of the read, whether the other component's
 * definition is registered before the reader scans or after, and plain
 * markup against server-rendered markup, where the server's text stays
 * until the component is there.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe('readers of a component that mounts after them', () => {
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

    const FORMS = [
        ['$other.v', (o) => `$${o}.v`],
        ["external('other', 'v')", (o) => `external('${o}', 'v')`],
    ]
    const DEFINED = ['before the reader scans', 'after the reader scans']
    const MARKUP = hasFeature('ssr') ? ['plain markup', 'server-rendered markup'] : ['plain markup']

    // The reader: one binding in the given form, and a computed that reads
    // the same value through this.external().
    const reader = (r, o) => wildflower.component(r, {
        state: {},
        computed: { viaComputed() { const x = this.external(o, 'v'); return x == null ? '-' : String(x) } },
    })
    // The other component's element goes into the page after the reader ran:
    // found by a scan the page asks for, or by the framework's own watch for
    // added elements.
    const MOUNTED = ['a scan', 'the watch for added elements']
    const mountOther = (o, by = MOUNTED[0]) => {
        // The framework starts this watch when it loads. The call asks for
        // it again where the method can be reached by name, which a
        // production build does not allow.
        if (by === MOUNTED[1] && wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
        const el = document.createElement('div')
        el.setAttribute('data-component', o)
        container.appendChild(el)
        if (by === MOUNTED[0]) wildflower.scan(container)
    }
    const text = (sel) => container.querySelector(sel).textContent

    for (const [form, expr] of FORMS) for (const defined of DEFINED) for (const markup of MARKUP) for (const by of MOUNTED) {
        it(`${form}, the other component defined ${defined}, ${markup}, mounted by ${by}`, async () => {
            const r = `lcreader${++seq}`; const o = `lcother${seq}`
            const defineOther = () => wildflower.component(o, { state: { v: 'V1' } })
            if (defined === DEFINED[0]) defineOther()
            reader(r, o)
            const server = markup === MARKUP[1]
            container.innerHTML = `<div data-component="${r}"${server ? ' data-ssr="true"' : ''}>` +
                `<span class="t" data-bind="${expr(o)}">${server ? 'from the server' : ''}</span>` +
                `<span class="k" data-bind="viaComputed">${server ? '-' : ''}</span></div>`
            wildflower.scan(container)
            await settle()
            expect(text('.t'), 'nothing to read yet').toBe(server ? 'from the server' : '')
            expect(text('.k')).toBe('-')

            if (defined === DEFINED[1]) defineOther()
            mountOther(o, by)
            await settle()
            expect(wildflower.getComponent(o), 'the other component is mounted').toBeTruthy()
            expect(text('.t'), 'the binding shows the component that arrived').toBe('V1')
            expect(text('.k'), 'and so does the computed').toBe('V1')

            wildflower.getComponent(o).v = 'V2'
            await settle()
            expect(text('.t'), 'the binding follows it').toBe('V2')
            expect(text('.k'), 'and so does the computed').toBe('V2')
        })
    }

    it.skipIf(!hasFeature('lists'))('a binding in a list row over a component that mounts later', async () => {
        const r = `lcreader${++seq}`; const o = `lcother${seq}`
        wildflower.component(o, { state: { v: 'V1' } })
        wildflower.component(r, { state: { rows: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }] } })
        container.innerHTML = `<div data-component="${r}"><ul data-list="rows" data-key="id"><template>` +
            `<li><b data-bind="n"></b><em class="r" data-bind="$${o}.v"></em></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const rows = () => [...container.querySelectorAll('.r')].map(e => e.textContent)
        expect(rows()).toEqual(['', ''])

        mountOther(o)
        await settle()
        expect(rows()).toEqual(['V1', 'V1'])

        wildflower.getComponent(o).v = 'V2'
        await settle()
        expect(rows()).toEqual(['V2', 'V2'])
    })

    for (const [form, expr] of FORMS) {
        it(`control, ${form}: the other component is mounted before the reader`, async () => {
            const r = `lcreader${++seq}`; const o = `lcother${seq}`
            wildflower.component(o, { state: { v: 'V1' } })
            reader(r, o)
            container.innerHTML = `<div data-component="${o}"></div><div data-component="${r}">` +
                `<span class="t" data-bind="${expr(o)}"></span><span class="k" data-bind="viaComputed"></span></div>`
            wildflower.scan(container)
            await settle()
            expect([text('.t'), text('.k')]).toEqual(['V1', 'V1'])
            wildflower.getComponent(o).v = 'V2'
            await settle()
            expect([text('.t'), text('.k')]).toEqual(['V2', 'V2'])
        })
    }
})
