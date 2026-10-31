/**
 * WF-521: a binding on a nested component's root element reads the component
 * around it, and names a value only the nested component has.
 *
 * Bindings written on a component's tag belong to whoever wrote the tag: for a
 * nested component, the component around it (its owner). A binding there that
 * names the nested component's own state, computed, prop or method reads the
 * owner instead, finds nothing and shows nothing, with no error. Development
 * builds warn once per component name and attribute when a name read by the
 * tag is the nested component's and not the owner's, and point to the root:
 * block, which declares the component's own side of its root. A name both
 * have, or neither has, is left alone (the second is WF-509's to report).
 * Production builds carry none of it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
let n = 0
const uniq = (base) => base + '-' + (++n)

describe('WF-521: a nested component\'s root binding reads a name only the child has', () => {
    let host, warned, origWarn

    beforeAll(async () => { await loadFramework() })
    beforeEach(() => {
        resetFramework()
        warned = []
        origWarn = console.warn
        console.warn = (...a) => { warned.push(a.map(String).join(' ')) }
        host = document.createElement('div')
        document.body.appendChild(host)
    })
    afterEach(() => { console.warn = origWarn; host.remove() })

    const wf521 = () => warned.filter((l) => l.includes('WF-521') && !l.includes('Docs:'))

    async function mount(ownerDef, kidDef, kidAttrs, { prefix = 'data-' } = {}) {
        const owner = uniq('crs-owner'), kid = uniq('crs-kid')
        wildflower.component(owner, ownerDef)
        wildflower.component(kid, kidDef)
        host.innerHTML = '<div ' + prefix + 'component="' + owner + '"><div ' + prefix + 'component="' + kid + '" ' + kidAttrs + '></div></div>'
        wildflower.scan()
        await settle()
        return { owner, kid }
    }

    it('the child has the name and the owner lacks it: one warning per component and attribute', async () => {
        const owner = uniq('crs-owner'), kid = uniq('crs-kid')
        wildflower.component(owner, { state: { other: 1 } })
        wildflower.component(kid, { state: { bg: 'red' } })
        const tag = '<div data-component="' + kid + '" data-bind-style="{ background: bg }"></div>'
        host.innerHTML = '<div data-component="' + owner + '">' + tag + tag + '</div>'
        wildflower.scan()
        await settle()
        const lines = wf521()
        if (isMinifiedBuild()) {
            expect(lines).toEqual([])
            return
        }
        expect(lines.length).toBe(1)
        expect(lines[0].startsWith('[WF-521] ')).toBe(true)
        expect(lines[0]).toContain("'" + kid + "'")
        expect(lines[0]).toContain("'" + owner + "'")
        expect(lines[0]).toContain('data-bind-style')
        expect(lines[0]).toContain("'bg'")
    })

    it('the suggestion points to the root: block', async () => {
        await mount({ state: {} }, { state: { on: true } }, 'data-show="on"')
        if (isMinifiedBuild()) { expect(wf521()).toEqual([]); return }
        const entry = wildflower.diagnostics.filter((d) => d.code === 'WF-521').pop()
        expect(entry).toBeDefined()
        expect(entry.severity).toBe('warning')
        expect(entry.suggestion).toContain('root:')
    })

    it('both have the name: silent', async () => {
        await mount({ state: { bg: 'blue' } }, { state: { bg: 'red' } }, 'data-bind-style="{ background: bg }"')
        expect(wf521()).toEqual([])
    })

    it('neither has the name: no WF-521', async () => {
        await mount({ state: {} }, { state: {} }, 'data-bind="missing"')
        expect(wf521()).toEqual([])
    })

    it('a top-level component reads its own scope: silent', async () => {
        const kid = uniq('crs-top')
        wildflower.component(kid, { state: { bg: 'red' } })
        host.innerHTML = '<div data-component="' + kid + '" data-bind-style="{ background: bg }"></div>'
        wildflower.scan()
        await settle()
        expect(wf521()).toEqual([])
    })

    it('object-form keys, strings, members and store paths are not reads', async () => {
        await mount(
            { state: { color: 'blue', cfg: { bg: 1 } } },
            { state: { background: 'x', active: true, bg: 1, label: 'k' } },
            'data-bind-style="{ background: color }" data-bind-class="{ active: color }" data-bind="cfg.bg + \'bg\' + $other.label"'
        )
        expect(wf521()).toEqual([])
    })

    it('a computed counts as the child\'s name', async () => {
        await mount({ state: {} }, { state: {}, computed: { shade() { return 'red' } } }, 'data-bind-class="shade"')
        if (isMinifiedBuild()) { expect(wf521()).toEqual([]); return }
        expect(wf521().length).toBe(1)
        expect(wf521()[0]).toContain("'shade'")
    })

    it('the data-wf-* prefix is covered', async () => {
        await mount({ state: {} }, { state: { on: true } }, 'data-wf-show="on"', { prefix: 'data-wf-' })
        if (isMinifiedBuild()) { expect(wf521()).toEqual([]); return }
        expect(wf521().length).toBe(1)
        expect(wf521()[0]).toContain('data-wf-show')
    })

    it('a child that initialized before its owner registered is checked when the owner arrives', async () => {
        const owner = uniq('crs-late-owner'), kid = uniq('crs-early-kid')
        host.innerHTML = '<div data-component="' + owner + '"><div data-component="' + kid + '" data-bind-style="{ background: bg }"></div></div>'
        wildflower.component(kid, { state: { bg: 'red' } })
        wildflower.scan()
        await settle()
        expect(wf521()).toEqual([])
        wildflower.component(owner, { state: {} })
        wildflower.scan()
        await settle()
        if (isMinifiedBuild()) { expect(wf521()).toEqual([]); return }
        expect(wf521().length).toBe(1)
        expect(wf521()[0]).toContain("'" + kid + "'")
    })
})
