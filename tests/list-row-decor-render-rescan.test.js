/**
 * A data-render insert anywhere in a component triggers a fresh DOM scan for
 * the component's binding meta (_collectComponentBindingMeta). List rows that
 * exist at that moment must stay OWNED BY THE LIST: collecting a row-interior
 * element as a component-level binding makes the component render effect
 * re-evaluate row expressions in component scope, where item fields are
 * undefined — a fallback ternary then "succeeds" with its default and
 * clobbers the row's correct value.
 *
 * Found on the Conduit profile page (paint-then-revert of an avatar src
 * ~milliseconds after the correct paint, whenever the auth-driven
 * data-render sections toggled after first population): the meta re-scan's
 * list exclusion was scoped to SSR components only. Text bindings survived
 * only because plain undefined values are skipped by the writer; expression
 * bindings with fallbacks produced defined values and wrote.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-rescan-${++seq}`

async function settle(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('list-row decor survives a data-render meta re-scan', () => {
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
    })

    it('row attr/class ternaries keep their item values after a sibling data-render inserts', async () => {
        const c = uname('c')
        let ctx
        container.innerHTML = `
            <div data-component="${c}">
                <p class="banner" data-render="showBanner">Welcome back!</p>
                <ul data-list="rows" data-key="id">
                    <template>
                        <li>
                            <span class="nm" data-bind="username"></span>
                            <img class="av" data-bind-attr="{src: (image ? image : '/default-avatar.svg')}">
                            <em class="tag" data-bind-class="image ? 'has-img' : 'no-img'">t</em>
                        </li>
                    </template>
                </ul>
            </div>`
        wildflower.component(c, {
            state: {
                showBanner: false,
                rows: [
                    { id: 1, username: 'ada', image: '/ada.png' },
                    { id: 2, username: 'bob', image: '' }
                ]
            },
            init() { ctx = this }
        })
        wildflower.scan(container)
        await settle()

        const av = () => [...container.querySelectorAll('.av')].map(el => el.getAttribute('src'))
        const cls = () => [...container.querySelectorAll('.tag')].map(el => el.className.replace('tag', '').trim())
        expect(av()).toEqual(['/ada.png', '/default-avatar.svg'])
        expect(cls()).toEqual(['has-img', 'no-img'])

        // The trigger: a data-render INSERT after rows exist re-scans the
        // component's binding meta. Row interiors must not be captured.
        ctx.showBanner = true
        await settle()
        expect(container.querySelector('.banner')).not.toBeNull()

        // The clobber wrote the ternary's fallback over the real value.
        expect(av()).toEqual(['/ada.png', '/default-avatar.svg'])
        expect(cls()).toEqual(['has-img', 'no-img'])
        // Text stays correct in both worlds; pinned for completeness.
        expect([...container.querySelectorAll('.nm')].map(e => e.textContent)).toEqual(['ada', 'bob'])

        // And the rows must still be LIVE afterwards (list ownership intact,
        // not merely unclobbered): an item change repaints its row.
        ctx.rows[1].image = '/bob.png'
        await settle()
        expect(av()).toEqual(['/ada.png', '/bob.png'])
        expect(cls()).toEqual(['has-img', 'has-img'])
    })
})
