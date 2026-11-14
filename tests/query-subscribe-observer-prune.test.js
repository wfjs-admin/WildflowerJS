/**
 * A component's subscribe: declaration does not keep destroyed components
 * reachable through the query's observer set.
 *
 * subscribe: { name: [...] } on a query counts the component's root element
 * as an observer. The element was added to the observer set directly, past
 * the prune-on-add every bound [data-query] element goes through, and the
 * only other prune runs when a refresh rung fires. A query with the default
 * refresh ('once') has no rung, so every mount of such a component left its
 * root element, and the subtree under it, in the set for the life of the
 * page: one hundred mounts and unmounts held one hundred detached roots.
 *
 * Pinned: the set holds at most the one element the documented
 * prune-on-add window allows, however many components came and went.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-subprune-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

suite('subscribe: observers are pruned', () => {
    let container
    let wildflower
    let realFetch
    let realWarn

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        realWarn = console.warn
        console.warn = () => {}
    })

    afterEach(() => {
        window.fetch = realFetch
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    it('mounting and destroying a subscribing component 50 times leaves no pile of detached roots', async () => {
        const q = uname('q'); const c = uname('c')
        window.fetch = async () => new Response('[{"id":1}]', { status: 200 })
        wildflower.query(q, { from: `/api/${q}` })
        wildflower.component(c, { subscribe: { [q]: ['rows'] }, state: {} })

        for (let i = 0; i < 50; i++) {
            container.innerHTML = `<div data-component="${c}"></div>`
            wildflower.scan(container)
            await settle(5)
            container.innerHTML = ''
            await settle(1)
        }
        await settle(50)

        const observers = [...wildflower._queryControllers.get(q).elements]
        expect(observers.filter(el => !el.isConnected).length).toBeLessThanOrEqual(1)
    })
})
