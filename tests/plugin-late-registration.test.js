/**
 * A plugin registered after the markup that reads it was scanned wakes the
 * bindings that read it, as a store registered late does: data-bind and
 * data-show follow it from then on, and a data-render section over it is
 * removed if the plugin arrives false. Before, nothing woke them: outside
 * server-rendered markup they stayed empty, and in it they kept the server's
 * content (a section stayed on the page, with the component inside it
 * running) whatever the plugin held.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIf = hasFeature('plugins') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIf('a plugin registered after the scan', () => {
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

    const ssrModes = hasFeature('ssr') ? [false, true] : [false]
    for (const ssr of ssrModes) {
        it(`data-bind and data-show follow it once it registers${ssr ? ' (server-rendered markup)' : ''}`, async () => {
            const c = `plr-${++seq}`; const p = `plrplug${seq}`
            wildflower.component(c, { state: {} })
            container.innerHTML = `<div data-component="${c}"${ssr ? ' data-ssr="true"' : ''}><span class="t" data-bind="$${p}.t">Server</span><div class="s" data-show="$${p}.on">x</div></div>`
            wildflower.scan(container)
            await settle()
            wildflower.plugin({ name: p, version: '1.0.0', state: { t: 'P1', on: false }, install() {} })
            await settle()
            expect(container.querySelector('.t').textContent).toBe('P1')
            expect(container.querySelector('.s').style.display).toBe('none')
            const plugin = wildflower['$' + p].state
            plugin.t = 'P2'
            plugin.on = true
            await settle()
            expect(container.querySelector('.t').textContent).toBe('P2')
            expect(container.querySelector('.s').style.display).not.toBe('none')
        })
    }

    if (hasFeature('ssr')) {
        it('a server-rendered data-render section over it is removed when it arrives false, and its component destroyed', async () => {
            const c = `plr-${++seq}`; const inner = `plrinner${seq}`; const p = `plrplug${seq}`
            let inits = 0; let destroys = 0
            wildflower.component(c, { state: {} })
            wildflower.component(inner, { state: {}, init() { inits++ }, destroy() { destroys++ } })
            container.innerHTML = `<div data-component="${c}" data-ssr="true"><div class="w"><div class="x" data-render="$${p}.on"><div data-component="${inner}">i</div></div></div></div>`
            wildflower.scan(container)
            await settle()
            expect(inits).toBe(1)
            expect(!!container.querySelector('.x')).toBe(true)
            wildflower.plugin({ name: p, version: '1.0.0', state: { on: false }, install() {} })
            await settle()
            expect(!!container.querySelector('.x')).toBe(false)
            expect(destroys).toBe(1)
        })
    }
})
