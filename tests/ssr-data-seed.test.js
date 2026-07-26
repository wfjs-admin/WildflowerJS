/**
 * data-seed on SSR components: a JSON attribute carrying fields the server
 * rendered into the page's data but not into its visible text. The SSR DOM
 * parse can only recover displayed values; data-seed fills the gap on the
 * component root (state fields) and on list item roots (item fields, most
 * often the row identity). Machine truth wins overlaps with display text.
 *
 * The data-query adoption path shares the same attribute and semantics;
 * its coverage lives in data-query.test.js.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfSSR = hasFeature('ssr') ? describe : describe.skip

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

describeIfSSR('SSR data-seed: hidden fields for DOM-parsed state', () => {
    let container
    let wildflower

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
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('list item data-seed carries unrendered item fields into parsed state', async () => {
        wildflower.component('seeded-list', {
            state: { items: [] },
            removeById(id) {
                this.items = this.items.filter(i => i.id !== id)
            }
        })
        container.innerHTML = `
            <div data-component="seeded-list" data-ssr="true">
                <div data-list="items">
                    <template><div class="row"><span data-bind="name"></span></div></template>
                    <div class="row" data-seed='{"id":11}'><span data-bind="name">Alpha</span></div>
                    <div class="row" data-seed='{"id":12}'><span data-bind="name">Beta</span></div>
                </div>
            </div>
        `
        wildflower.scan(container)
        await settle()

        const inst = wildflower.getComponentsByType('seeded-list')[0]
        expect(inst.state.items).toEqual([
            { id: 11, name: 'Alpha' },
            { id: 12, name: 'Beta' }
        ])

        // The hidden field is real, working state: remove by id.
        inst.context.removeById(11)
        await settle()
        const names = [...container.querySelectorAll('.row span')].map(e => e.textContent)
        expect(names).toEqual(['Beta'])
    })

    it('component root data-seed carries unrendered state fields', async () => {
        wildflower.component('seeded-profile', {
            state: { name: '', userId: null },
            computed: {
                apiPath() { return '/api/users/' + this.userId }
            }
        })
        container.innerHTML = `
            <div data-component="seeded-profile" data-ssr="true" data-seed='{"userId":42}'>
                <h2 data-bind="name">Ada Lovelace</h2>
                <p class="path" data-bind="apiPath"></p>
            </div>
        `
        wildflower.scan(container)
        await settle()

        const inst = wildflower.getComponentsByType('seeded-profile')[0]
        expect(inst.state.userId).toBe(42)
        expect(inst.state.name).toBe('Ada Lovelace')
        expect(container.querySelector('.path').textContent).toBe('/api/users/42')
    })

    it('nested list item data-seed survives the recursive parse', async () => {
        wildflower.component('seeded-nested', { state: { categories: [] } })
        container.innerHTML = `
            <div data-component="seeded-nested" data-ssr="true">
                <div data-list="categories">
                    <template><div class="cat"><span data-bind="title"></span><div data-list="items"><template><span data-bind="label"></span></template></div></div></template>
                    <div class="cat" data-seed='{"catId":5}'>
                        <span data-bind="title">Tools</span>
                        <div data-list="items">
                            <template><span data-bind="label"></span></template>
                            <span data-seed='{"itemId":51}' data-bind="label">Hammer</span>
                            <span data-seed='{"itemId":52}' data-bind="label">Wrench</span>
                        </div>
                    </div>
                </div>
            </div>
        `
        wildflower.scan(container)
        await settle()

        const inst = wildflower.getComponentsByType('seeded-nested')[0]
        expect(inst.state.categories[0].catId).toBe(5)
        expect(inst.state.categories[0].title).toBe('Tools')
        expect(inst.state.categories[0].items).toEqual([
            { itemId: 51, label: 'Hammer' },
            { itemId: 52, label: 'Wrench' }
        ])
    })

    it('data-wf-seed alias works', async () => {
        wildflower.component('seeded-alias', { state: { name: '', ref: null } })
        container.innerHTML = `
            <div data-component="seeded-alias" data-ssr="true" data-wf-seed='{"ref":7}'>
                <span data-bind="name">Alpha</span>
            </div>
        `
        wildflower.scan(container)
        await settle()
        expect(wildflower.getComponentsByType('seeded-alias')[0].state.ref).toBe(7)
    })

    it('malformed and non-object seeds are ignored without crashing', async () => {
        wildflower.component('seeded-bad', { state: { name: '' } })
        container.innerHTML = `
            <div data-component="seeded-bad" data-ssr="true" data-seed='{not json'>
                <span class="nm" data-bind="name">Works</span>
                <div data-list="junk" style="display:none">
                    <template><span data-bind="x"></span></template>
                    <span data-seed='[1,2,3]' data-bind="x">y</span>
                </div>
            </div>
        `
        wildflower.scan(container)
        await settle()

        // Page still hydrates; bad seeds contributed nothing.
        const inst = wildflower.getComponentsByType('seeded-bad')[0]
        expect(inst.state.name).toBe('Works')
        expect(container.querySelector('.nm').textContent).toBe('Works')
    })

    it('data-seed wins overlaps with parsed display text', async () => {
        wildflower.component('seeded-overlap', {
            state: { count: 0 }
        })
        container.innerHTML = `
            <div data-component="seeded-overlap" data-ssr="true" data-seed='{"count":250}'>
                <span data-bind="count">250+</span>
            </div>
        `
        wildflower.scan(container)
        await settle()

        // Display said "250+"; the seed carries the machine value.
        const inst = wildflower.getComponentsByType('seeded-overlap')[0]
        expect(inst.state.count).toBe(250)
    })
})
