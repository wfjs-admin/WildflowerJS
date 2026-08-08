/**
 * WF-963 — orphan [data-query] diagnostic (V1_4_ROADMAP §7).
 *
 * A [data-query] element with no component ancestor is a silent no-op:
 * the query transform runs during component binding, so nothing ever
 * processes the element. Dev builds now warn from a post-scan sweep (no
 * standing observer). The predicate is structural — presence of a
 * component ATTRIBUTE on an ancestor — so a component whose async init
 * has not finished never false-positives. Warned once per element;
 * production builds are silent and unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const devIt = isMinifiedBuild() ? it.skip : it
const minIt = isMinifiedBuild() ? it : it.skip

let seq = 0
const uname = (p) => `${p}-orph-${++seq}`

function jsonResponse(data) {
    return new Response(JSON.stringify(data), { status: 200 })
}

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('orphan data-query diagnostic (WF-963)', () => {
    let container
    let wildflower
    let realFetch
    let warnings
    let realWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')); }
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const wf963 = () => warnings.filter(w => w.includes('[WF WF-963]'))

    devIt('an orphan data-query element warns once, naming the query', async () => {
        const q = uname('q')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
        `
        wildflower.scan(container)
        await settle(40)

        expect(wf963().length).toBe(1)
        expect(wf963()[0]).toContain(q)

        wildflower.scan(container)
        await settle(40)
        expect(wf963().length, 'rescan must not re-warn the same element').toBe(1)
    })

    devIt('a data-query inside a component never draws the orphan warn', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li class="row" data-bind="name"></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()

        expect(wf963().length).toBe(0)
        expect(container.querySelector('.row').textContent).toBe('a')
    })

    devIt('an orphan warns even when the query name is unregistered', async () => {
        container.innerHTML = `
            <ul data-query="never-registered-${seq}"><template><li data-bind="name"></li></template></ul>
        `
        wildflower.scan(container)
        await settle(40)

        expect(wf963().length).toBe(1)
    })

    minIt('production builds stay silent and unbroken', async () => {
        const q = uname('q')
        window.fetch = async () => jsonResponse([{ id: 1, name: 'a' }])
        wildflower.query(q, { from: '/api/x.json', key: 'id' })
        container.innerHTML = `
            <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
        `
        wildflower.scan(container)
        await settle(40)

        expect(wf963().length).toBe(0)
    })
})
