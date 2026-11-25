/**
 * Four markup mistakes that render wrong and are named by a development build.
 *
 *   - $name.path where nothing called `name` exists once the page has settled
 *     (a misspelled store name): the binding stays empty.
 *   - {{ name }} in text: shown as written.
 *   - data-bind="{name}": shows [object Object].
 *   - data-list on a <table> that has a <thead>: the rows replace the head.
 *
 * Each is checked down both mount paths, with the correct form beside it to
 * hold that nothing is reported for markup that works.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'
import { INIT_PATHS } from './helpers/init-paths.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
const itIfLists = hasFeature('lists') ? it : it.skip
let seq = 0

describe.skipIf(isMinifiedBuild())('markup mistakes a development build names', () => {
    let wildflower
    let container
    let debugWas
    let settleWas

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        debugWas = wildflower.debug
        wildflower.debug = true
        settleWas = wildflower._devPropsSettleMs
        wildflower._devPropsSettleMs = 60
        if (wildflower.diagnostics) wildflower.diagnostics.length = 0
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        wildflower.debug = debugWas
        wildflower._devPropsSettleMs = settleWas
        container.remove()
    })

    const found = (text) => (wildflower.diagnostics || []).filter(d => d.code === 'WF-509' && (d.context || '').includes(text))

    describe.each(Object.entries(INIT_PATHS))('via %s path', (pathName, run) => {
        const mount = async (definition, inner) => {
            const name = `mm-${++seq}`
            wildflower.component(name, definition)
            container.innerHTML = `<div data-component="${name}">${inner}</div>`
            run(wildflower)
            await settle(250)
            return name
        }

        it('$name.path with no such entity: named after the page settles, with the nearest store', async () => {
            wildflower.store('inventory', { state: { total: 5 } })
            await mount({ state: { n: 1 } }, `
                <span id="wrong" data-bind="$inventroy.total"></span>
                <span id="wrong-expr" data-show="$inventroy.total > 3"></span>
                <span id="right" data-bind="$inventory.total"></span>`)
            expect(container.querySelector('#right').textContent).toBe('5')
            const hits = found('$inventroy')
            expect(hits.length).toBe(1)
            expect(hits[0].context).toContain('data-bind="$inventroy.total"')
            expect(hits[0].suggestion).toContain('$inventory')
            expect(found('$inventory.')).toEqual([])
        })

        it('$name.path whose store is registered after the component mounts: not reported', async () => {
            wildflower._devPropsSettleMs = 300
            const name = `mm-${++seq}`
            wildflower.component(name, { state: { n: 1 } })
            container.innerHTML = `<div data-component="${name}"><span id="late" data-bind="$latecomer.total"></span></div>`
            run(wildflower)
            await settle(60)
            wildflower.store('latecomer', { state: { total: 9 } })
            await settle(500)
            expect(container.querySelector('#late').textContent).toBe('9')
            expect(found('$latecomer')).toEqual([])
        })

        it('$name.path naming another component: not reported', async () => {
            wildflower.component('mm-source', { state: { label: 'from-component' } })
            await mount({ state: { n: 1 } }, `
                <div data-component="mm-source"></div>
                <span id="other" data-bind="$mm-source.label"></span>`)
            expect(container.querySelector('#other').textContent).toBe('from-component')
            expect(found('$mm-source')).toEqual([])
        })

        it('{{ name }} in text: named, with the binding to use', async () => {
            await mount({ state: { selectedCount: 3 } }, `
                <span id="mustache">{{ selectedCount }}</span>
                <span id="bound" data-bind="selectedCount"></span>`)
            expect(container.querySelector('#mustache').textContent).toBe('{{ selectedCount }}')
            const hits = found('{{ selectedCount }}')
            expect(hits.length).toBe(1)
            expect(hits[0].suggestion).toContain('data-bind="selectedCount"')
        })

        it('{{ }} inside code samples and child components: not reported here', async () => {
            wildflower.component('mm-child', { state: { x: 1 } })
            await mount({ state: { selectedCount: 3 } }, `
                <pre>{{ selectedCount }}</pre>
                <code>{{ selectedCount }}</code>
                <p>Braces that hold no name: {{ }} and { selectedCount }</p>
                <div data-component="mm-child"><span>{{ x }}</span></div>`)
            expect(found('{{ selectedCount }}')).toEqual([])
            // The child's own text is the child's to report.
            expect(found('{{ x }}').every(d => d.context.includes('mm-child'))).toBe(true)
        })

        it('data-bind="{name}": named, with the form without braces', async () => {
            await mount({ state: { selectedCount: 3 } }, `
                <span id="braces" data-bind="{selectedCount}"></span>
                <span id="double" data-bind="{{selectedCount}}"></span>
                <span id="attr" data-bind-attr="{ title: selectedCount }"></span>`)
            const hits = found('{selectedCount}')
            expect(hits.some(d => d.context.includes('data-bind="{selectedCount}"'))).toBe(true)
            expect(hits.some(d => d.context.includes('data-bind="{{selectedCount}}"'))).toBe(true)
            expect(hits[0].suggestion).toContain('data-bind="selectedCount"')
            expect(found('title')).toEqual([])
        })

        itIfLists('data-list on a <table> with a <thead>: named, with <tbody> as the place for it', async () => {
            await mount({ state: { rows: [{ id: 1, n: 'a' }] } }, `
                <table id="wrong" data-list="rows" data-key="id">
                    <thead><tr><th>h</th></tr></thead>
                    <template><tr><td data-bind="n"></td></tr></template>
                </table>`)
            const hits = found('<table>')
            expect(hits.length).toBe(1)
            expect(hits[0].context).toContain('data-list="rows"')
            expect(hits[0].suggestion).toContain('<tbody')
        })

        itIfLists('data-list on a <tbody>, and on a <table> that holds only its template: not reported', async () => {
            await mount({ state: { rows: [{ id: 1, n: 'a' }] } }, `
                <table id="ok"><thead><tr><th>h</th></tr></thead>
                    <tbody data-list="rows" data-key="id"><template><tr><td data-bind="n"></td></tr></template></tbody>
                </table>
                <table id="bare" data-list="rows" data-key="id"><template><tr><td data-bind="n"></td></tr></template></table>`)
            expect(container.querySelector('#ok thead')).not.toBe(null)
            expect(found('<table>')).toEqual([])
        })
    })
})
