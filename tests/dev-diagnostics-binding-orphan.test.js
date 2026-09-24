/**
 * v1.5.3 candidate #5: data-bind / data-show / data-model / data-action
 * outside every component never initialize and never warn (bindings only
 * process inside a component). data-query already warns for this shape
 * (WF-963, QUERY_ORPHAN); this extends the same sweep to the other four.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const suite = isMinifiedBuild() ? describe.skip : describe

let seq = 0
const uname = (p) => `${p}-orphan-${++seq}`

async function settle(ms = 30) {
    await new Promise(r => setTimeout(r, ms))
}

suite('dev diagnostics: binding attribute outside any component', () => {
    let container
    let wildflower
    let warnings
    const realWarn = console.warn

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        warnings = []
        console.warn = (...args) => { warnings.push(args.join(' ')) }
    })

    afterEach(() => {
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it.each(['bind', 'show', 'model', 'action'])('warns once for a bare data-%s with no component ancestor', async (attr) => {
        container.innerHTML = `<span id="orphan" data-${attr}="x"></span>`
        wildflower.scan(container)
        await settle()

        const hit = warnings.some(w => w.includes(`data-${attr}`))
        expect(hit).toBe(true)
    })

    it('does not warn when the same attribute IS inside a component', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { x: 'ok' } })
        container.innerHTML = `<div data-component="${c}"><span data-bind="x"></span></div>`
        wildflower.scan(container)
        await settle()

        const hit = warnings.some(w => w.includes('data-bind'))
        expect(hit).toBe(false)
    })

    it('warns only once per element across repeated scans', async () => {
        container.innerHTML = `<span data-bind="x"></span>`
        wildflower.scan(container)
        await settle()
        wildflower.scan(container)
        await settle()

        const hits = warnings.filter(w => w.includes('data-bind'))
        expect(hits.length).toBe(1)
    })

    // A portal moves bound markup out of its component, which keeps driving
    // it. After the move there's no component ancestor, so a later full scan
    // must still not call it an orphan.
    it.skipIf(!hasFeature('portals'))('does not warn for portalled bindings after a full scan', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { msg: 'hello' }, poke() { this.msg = 'poked' } })
        container.innerHTML = `<div id="${c}-target"></div>
            <div data-component="${c}">
              <div data-portal="#${c}-target"><span class="out" data-bind="msg"></span><button data-action="poke">x</button></div>
            </div>`
        wildflower.scan(container)
        await settle(60)
        const out = container.querySelector(`#${c}-target .out`)
        expect(out, 'portal did not move its content; the case under test did not arise').toBeTruthy()
        expect(out.closest('[data-component]')).toBeNull()

        wildflower.scan()
        await settle(60)

        expect(warnings.filter(w => w.includes('WF-513'))).toEqual([])
        // And the bindings really are live, which is what the warning denied.
        container.querySelector(`#${c}-target button`).click()
        await settle(60)
        expect(out.textContent).toBe('poked')
    })
})
