/**
 * WF-803: a binding in server-rendered markup keeps its server content while
 * the entity it reads ($store, $plugin, a query) is not registered. An entity
 * that never registers (a misspelled name, a script that did not load) left
 * the page looking right and never updating, with nothing said. Development
 * builds say so once per name, after a settle window; an entity that
 * registers inside the window says nothing.
 *
 * The window is a timer, so each case that expects silence carries a control:
 * a second name, noted after the one under test, that never registers. Its
 * warning arriving shows the window has passed for the name before it, so
 * the silence is not a wait that ended too soon.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe.skipIf(isMinifiedBuild() || !hasFeature('ssr'))('WF-803: an entity a server-rendered binding waits for never registers', () => {
    let wildflower, container, lines, origWarn
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        wildflower._devSsrLateMs = 60
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
        lines = []
        origWarn = console.warn
        console.warn = (...a) => { lines.push(a.map(String).join(' ')) }
    })
    afterEach(() => {
        console.warn = origWarn
        delete wildflower._devSsrLateMs
        container.remove()
    })

    // The main line only (the "↳ Docs" follow-up carries the code too).
    const hits = (name) => lines.filter(l => l.includes('WF-803') && !l.includes('Docs:') && l.includes(`reads $${name},`))
    const warned = (name) => vi.waitFor(() => expect(hits(name).length).toBe(1), { timeout: 5000, interval: 20 })

    it('warns once for a name that never registers, naming it and a binding that reads it', async () => {
        const c = `slew-${++seq}`; const s = `slewtypo${seq}`; const control = `slewcontrol${seq}`
        wildflower.component(c, { state: { local: 'L1' } })
        container.innerHTML = `<div data-component="${c}" data-ssr="true">` +
            `<span class="a" data-bind="$${s}.t">Server</span><span class="b" data-bind="local + '|' + $${s}.t">Server</span>` +
            `<div class="w"><div class="r" data-render="$${s}.on">kept</div></div>` +
            `<span class="c" data-bind="$${control}.t">Server</span></div>`
        wildflower.scan(container)
        await warned(control)
        // Three bindings wait on the name: one warning, quoting the first to wait (the data-render).
        expect(hits(s).length).toBe(1)
        expect(hits(s)[0]).toContain(`"$${s}.on" reads $${s}`)
        // The server content is kept, as before.
        expect(container.querySelector('.a').textContent).toBe('Server')
        expect(!!container.querySelector('.r')).toBe(true)
    })

    it('says nothing for a store that registers inside the window', async () => {
        // A wider window, so the store below registers well inside it.
        wildflower._devSsrLateMs = 400
        const c = `slew-${++seq}`; const s = `slewstore${seq}`; const control = `slewcontrol${seq}`
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}" data-ssr="true"><span class="a" data-bind="$${s}.t">Server</span>` +
            `<span class="c" data-bind="$${control}.t">Server</span></div>`
        wildflower.scan(container)
        await settle(20)
        expect(container.querySelector('.a').textContent).toBe('Server')
        wildflower.store(s, { state: { t: 'Store' } })
        await warned(control)
        expect(container.querySelector('.a').textContent).toBe('Store')
        expect(hits(s)).toEqual([])
    })

    it('says nothing outside server-rendered markup', async () => {
        const c = `slew-${++seq}`; const s = `slewtypo${seq}`; const control = `slewcontrol${seq}`
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}"><span class="a" data-bind="$${s}.t">Server</span></div>` +
            `<div data-component="${c}" data-ssr="true"><span class="c" data-bind="$${control}.t">Server</span></div>`
        wildflower.scan(container)
        await warned(control)
        expect(hits(s)).toEqual([])
    })
})
