/**
 * A child's prop that reads the parent's computed has the computed's value
 * when the page first renders, on both mount paths.
 *
 * The page-load path creates every component before it sets up any
 * computed, so a child's first look at the parent finds no computed there.
 * The prop is resolved again once the parent's computeds exist, whether the
 * prop declares a default or not, and with or without the computed: prefix.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'
import { INIT_PATHS } from './helpers/init-paths.js'

let seq = 0
const uname = (p) => `${p}-pfpc-${++seq}`
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))

describe.each(Object.entries(INIT_PATHS))('a prop from a parent computed, via the %s path', (pathName, run) => {
    let wildflower
    let container

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
        container.remove()
    })

    const mount = async (propDef) => {
        const parent = uname('parent')
        const kid = uname('kid')
        let ctx
        wildflower.component(parent, {
            state: { count: 2, late: undefined },
            computed: { doubled() { return this.count * 2 } },
            init() { ctx = this },
        })
        wildflower.component(kid, { props: { n: propDef } })
        container.innerHTML = `
            <div data-component="${parent}">
                <div data-component="${kid}" data-prop-n="doubled"><span class="plain" data-bind="props.n"></span></div>
                <div data-component="${kid}" data-prop-n="computed:doubled"><span class="prefixed" data-bind="props.n"></span></div>
                <div data-component="${kid}" data-prop-n="count"><span class="state" data-bind="props.n"></span></div>
                <div data-component="${kid}" data-prop-n="late"><span class="late" data-bind="props.n"></span></div>
            </div>
        `
        run(wildflower)
        await settle()
        const texts = () => ['plain', 'prefixed', 'state', 'late'].map(c => container.querySelector('.' + c).textContent)
        return { ctx, texts }
    }

    it('with a default: the first render shows the computed, and a write updates it', async () => {
        const { ctx, texts } = await mount({ type: Number, default: -1 })
        expect(texts()).toEqual(['4', '4', '2', '-1'])
        ctx.count = 3
        await settle()
        expect(texts()).toEqual(['6', '6', '3', '-1'])
    })

    it('with no default: the same', async () => {
        const { ctx, texts } = await mount({ type: Number })
        expect(texts().slice(0, 3)).toEqual(['4', '4', '2'])
        ctx.count = 3
        await settle()
        expect(texts().slice(0, 3)).toEqual(['6', '6', '3'])
    })

    it('a prop at its default follows the parent once the parent has a value', async () => {
        const { ctx, texts } = await mount({ type: Number, default: -1 })
        expect(texts()[3]).toBe('-1')
        ctx.late = 9
        await settle()
        expect(texts()[3]).toBe('9')
        ctx.late = 10
        await settle()
        expect(texts()[3]).toBe('10')
    })

    it('a child computed that reads the prop sees the parent computed on the first render', async () => {
        const parent = uname('parent')
        const kid = uname('kid')
        wildflower.component(parent, { state: { count: 2 }, computed: { doubled() { return this.count * 2 } } })
        wildflower.component(kid, {
            props: { n: { type: Number, default: -1 } },
            computed: { shown() { return 'n=' + this.props.n } },
        })
        container.innerHTML = `
            <div data-component="${parent}">
                <div data-component="${kid}" data-prop-n="doubled"><span class="shown" data-bind="shown"></span></div>
            </div>
        `
        run(wildflower)
        await settle()
        expect(container.querySelector('.shown').textContent).toBe('n=4')
    })
})
