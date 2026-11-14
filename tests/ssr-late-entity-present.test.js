/**
 * The late-entity rule for server-rendered markup (a binding over an entity
 * not registered yet keeps its server state) applies only while the entity
 * is absent:
 *  - a plugin is an entity: a $plugin binding in server-rendered markup
 *    follows the plugin (it was looked up as a store or component only, read
 *    as missing on every run, and never painted);
 *  - once the entity has arrived the rule is over: a store unregistered
 *    later no longer freezes the bindings that read it;
 *  - the check costs nothing outside server-rendered markup, and nothing
 *    once the entity is there (it scanned every component instance per
 *    binding per run).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('ssr') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIf('SSR bindings over an entity that is present', () => {
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

    it('a $plugin binding in server-rendered markup follows the plugin', async () => {
        const c = `slep-${++seq}`; const p = `slepplug${seq}`
        wildflower.plugin({ name: p, version: '1.0.0', state: { t: 'P1', on: true }, install() {} })
        const plugin = wildflower['$' + p].state
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}" data-ssr="true">` +
            `<span class="t" data-bind="$${p}.t">Server</span><div class="s" data-show="$${p}.on">x</div></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.t').textContent).toBe('P1')
        expect(container.querySelector('.s').style.display).not.toBe('none')
        plugin.t = 'P2'
        plugin.on = false
        await settle()
        expect(container.querySelector('.t').textContent).toBe('P2')
        expect(container.querySelector('.s').style.display).toBe('none')
    })

    it('a data-render over a false $plugin value in server-rendered markup is removed', async () => {
        const c = `slep-${++seq}`; const p = `slepplug${seq}`
        wildflower.plugin({ name: p, version: '1.0.0', state: { on: false }, install() {} })
        const plugin = wildflower['$' + p].state
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}" data-ssr="true"><div class="w"><div class="x" data-render="$${p}.on">secret</div></div></div>`
        wildflower.scan(container)
        await settle()
        expect(!!container.querySelector('.x')).toBe(false)
        plugin.on = true
        await settle()
        expect(!!container.querySelector('.x')).toBe(true)
        plugin.on = false
        await settle()
        expect(!!container.querySelector('.x')).toBe(false)
    })

    it('a store unregistered after it arrived does not freeze the bindings that read it', async () => {
        const c = `slep-${++seq}`; const s = `slepstore${seq}`
        wildflower.store(s, { state: { t: 'S1' } })
        wildflower.component(c, { state: { local: 'L1' } })
        container.innerHTML = `<div data-component="${c}" data-ssr="true"><span class="m" data-bind="local + '|' + $${s}.t">Server</span></div>`
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('.m').textContent).toBe('L1|S1')
        wildflower.unregister(s)
        await settle()
        const inst = wildflower.componentInstances.get(container.querySelector('[data-component]').dataset.componentId)
        inst.context.local = 'L2'
        await settle()
        expect(container.querySelector('.m').textContent.startsWith('L2|')).toBe(true)
    })

    // One instance scan per $store binding per run is what the read itself
    // costs; the late-entity check must add none.
    for (const ssr of [false, true]) {
        it(`a store write scans the instances once per binding (${ssr ? 'server-rendered markup' : 'no SSR on the page'})`, async () => {
            const N = 20
            const c = `slep-${++seq}`; const s = `slepctr${seq}`
            wildflower.store(s, { state: { n: 0 } })
            wildflower.component(c, { state: {} })
            container.innerHTML = Array.from({ length: N }, () =>
                `<div data-component="${c}"${ssr ? ' data-ssr="true"' : ''}><span data-bind="$${s}.n">0</span><i data-bind-attr="{ title: $${s}.n }"></i></div>`).join('')
            wildflower.scan(container)
            await settle()
            const store = wildflower.getStore(s)
            store.n = 1
            await settle()
            let calls = 0
            const orig = wildflower.getComponentsByType
            wildflower.getComponentsByType = function (...a) { calls++; return orig.apply(this, a) }
            try {
                store.n = 2
                await settle()
            } finally {
                wildflower.getComponentsByType = orig
            }
            expect(container.querySelector('span').textContent).toBe('2')
            expect(calls).toBeLessThanOrEqual(N * 2)
        })
    }
})
