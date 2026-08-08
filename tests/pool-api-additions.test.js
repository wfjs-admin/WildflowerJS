/**
 * Pool API additions that came out of clean-room AI app-builds: add()/push()
 * accept varargs like Array.push (models and people both write push(a, b)),
 * and getItemFromEvent resolves pool entities for delegated handlers.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('pools') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-pa-${++seq}`

async function settle(ms = 120) {
    await new Promise(r => setTimeout(r, ms))
}

suite('pool API additions', () => {
    let container
    let wildflower

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const getInstance = (name) =>
        [...wildflower.componentInstances.values()].find(i => i.name === name)

    it('add() and push() accept varargs like Array.push', async () => {
        const c = uname('varargs')
        container.innerHTML = `
            <div data-component="${c}">
                <div data-pool="cards"><template><div class="card" data-bind="title"></div></template></div>
            </div>
        `
        wildflower.component(c, { state: {}, pools: { cards: {} } })
        wildflower.scan(container)
        await settle()
        const cards = getInstance(c).context.getPool('cards')

        cards.add({ id: 1, title: 'Alpha' }, { id: 2, title: 'Bravo' })
        await settle()
        expect(cards.items.length, 'both varargs entities added').toBe(2)
        expect(container.querySelectorAll('.card').length).toBe(2)

        cards.push({ id: 3, title: 'Charlie' }, { id: 4, title: 'Delta' })
        await settle()
        expect(cards.items.length, 'push is variadic too').toBe(4)
    })

    it('getItemFromEvent resolves pool entities for delegated handlers', async () => {
        const c = uname('delegated')
        container.innerHTML = `
            <div data-component="${c}">
                <div class="wrap" data-action="pick" data-pool="cards" data-key="id">
                    <template><div class="card"><span class="label" data-bind="title"></span></div></template>
                </div>
                <span class="picked" data-bind="picked"></span>
            </div>
        `
        wildflower.component(c, {
            state: { picked: '' },
            pools: { cards: {} },
            pick(event) {
                const hit = this.getItemFromEvent(event)
                this.picked = hit && hit.item ? hit.item.title : 'MISS'
            }
        })
        wildflower.scan(container)
        await settle()
        const inst = getInstance(c)
        inst.context.getPool('cards').add([{ id: 1, title: 'Alpha' }, { id: 2, title: 'Bravo' }])
        await settle()

        const labels = container.querySelectorAll('.label')
        labels[1].click()
        await settle()
        expect(container.querySelector('.picked').textContent, 'entity resolved from a click inside it').toBe('Bravo')

        const hit = inst.context.getItemFromEvent({ target: labels[0] })
        expect(hit.item.id, 'descriptor carries the entity').toBe(1)
        expect(hit.element.classList.contains('card'), 'and its root element').toBe(true)
        expect(hit.index, 'no index: pool storage is index-unstable by design').toBeUndefined()
    })
})
