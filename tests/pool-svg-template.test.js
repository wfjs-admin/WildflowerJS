/**
 * Pool templates inside <svg>.
 *
 * The HTML parser turns a <template> in foreign content into an inert
 * SVG-namespaced element with no .content fragment, but its children are
 * parsed as real SVG elements. A pool container inside an <svg> should be
 * able to use that element as its template, so entities can be circles,
 * paths, and text in one shared coordinate space.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('pools') ? describe : describe.skip
const SVG_NS = 'http://www.w3.org/2000/svg'

let seq = 0
const uname = (p) => `${p}-svgpool-${++seq}`

async function settle(ms = 120) {
    await new Promise(r => setTimeout(r, ms))
}

suite('pool templates inside <svg>', () => {
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

    function mount(c) {
        container.innerHTML = `
            <div data-component="${c}">
                <svg width="200" height="100">
                    <g class="dots" data-pool="dots" data-key="id">
                        <template>
                            <circle class="dot" r="6" fill="#39c98c"
                                    data-bind-attr="{ cx: x, cy: y }"
                                    data-bind-class="cls"
                                    data-bind-style="{ transform: tf }">
                                <title data-bind="label"></title>
                            </circle>
                        </template>
                    </g>
                </svg>
            </div>
        `
        wildflower.component(c, { state: {}, pools: { dots: {} } })
        wildflower.scan(container)
    }

    it('creates the pool and renders entities as real SVG elements', async () => {
        const c = uname('render')
        mount(c)
        await settle()

        const pool = getInstance(c).context.getPool('dots')
        expect(pool, 'pool handle exists for a container inside <svg>').toBeTruthy()

        pool.push([
            { id: 1, x: 20, y: 50, cls: 'hot', tf: '', label: 'one' },
            { id: 2, x: 60, y: 50, cls: '', tf: '', label: 'two' },
            { id: 3, x: 100, y: 50, cls: '', tf: '', label: 'three' }
        ])
        await settle()

        const g = container.querySelector('g.dots')
        const circles = g.querySelectorAll('circle')
        expect(circles.length, 'one circle per entity').toBe(3)
        expect(circles[0].namespaceURI, 'entities live in the SVG namespace').toBe(SVG_NS)
        expect(circles[0] instanceof SVGCircleElement, 'typed as SVGCircleElement').toBe(true)
        expect(g.querySelector('template'), 'the inert template element is removed').toBeNull()

        expect(circles[0].getAttribute('cx'), 'attr binding writes geometry').toBe('20')
        expect(circles[2].getAttribute('cx')).toBe('100')
        expect(circles[0].classList.contains('hot'), 'class binding via classList').toBe(true)
        expect(circles[0].classList.contains('dot'), 'static class kept').toBe(true)
        expect(circles[1].classList.contains('hot')).toBe(false)
        expect(circles[0].querySelector('title').textContent, 'text binding inside the entity').toBe('one')
        expect(circles[0].hasAttribute('data-bind-class'), 'compiled binding attributes stripped from entities').toBe(false)
    })

    it('delivers pool data-action clicks on SVG entities to the component', async () => {
        const c = uname('action')
        container.innerHTML = `
            <div data-component="${c}">
                <svg width="200" height="100">
                    <g class="dots" data-pool="dots" data-key="id">
                        <template>
                            <circle class="dot" r="10" data-bind-attr="{ cx: x, cy: y }" data-action="pick"></circle>
                        </template>
                    </g>
                </svg>
            </div>
        `
        const picked = []
        wildflower.component(c, {
            state: {},
            pools: { dots: {} },
            pick(item, event) { picked.push([item.id, event.type]) }
        })
        wildflower.scan(container)
        await settle()
        const pool = getInstance(c).context.getPool('dots')
        pool.push([{ id: 7, x: 40, y: 40 }, { id: 8, x: 120, y: 40 }])
        await settle()

        const circles = container.querySelectorAll('g.dots circle')
        circles[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await settle(30)
        expect(picked, 'handler receives the entity for the clicked SVG element').toEqual([[8, 'click']])
    })

    it('flushes per-frame updates onto the SVG entities', async () => {
        const c = uname('update')
        mount(c)
        await settle()
        const pool = getInstance(c).context.getPool('dots')
        const dot = { id: 1, x: 10, y: 10, cls: '', tf: '', label: 'a' }
        pool.push([dot])
        await settle()

        dot.x = 150
        dot.tf = 'translate(5px, 0px)'
        dot.cls = 'hot'
        await settle()

        const circle = container.querySelector('g.dots circle')
        expect(circle.getAttribute('cx'), 'attribute follows the entity').toBe('150')
        expect(circle.style.transform, 'style binding writes to SVG element style').toBe('translate(5px, 0px)')
        expect(circle.classList.contains('hot')).toBe(true)
    })

    it('recycles SVG entities through remove and re-add without throwing', async () => {
        const c = uname('recycle')
        mount(c)
        await settle()
        const pool = getInstance(c).context.getPool('dots')
        pool.push([{ id: 1, x: 10, y: 10, cls: 'hot', tf: 'translate(1px, 1px)', label: 'a' }])
        await settle()

        expect(pool.remove(1), 'remove returns true').toBe(true)
        await settle()
        expect(container.querySelectorAll('g.dots circle').length).toBe(0)

        // Re-add: the recycled element must come back with the template's
        // static class and none of the previous entity's dynamic state.
        pool.push([{ id: 2, x: 30, y: 30, cls: '', tf: '', label: 'b' }])
        await settle()
        const circle = container.querySelector('g.dots circle')
        expect(circle, 'recycled entity rendered').toBeTruthy()
        expect(circle.getAttribute('cx')).toBe('30')
        expect(circle.classList.contains('dot'), 'template class restored on recycle').toBe(true)
        expect(circle.classList.contains('hot'), 'previous dynamic class cleared').toBe(false)
        expect(circle.querySelector('title').textContent).toBe('b')
    })
})
