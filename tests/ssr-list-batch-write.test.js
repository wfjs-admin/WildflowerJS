/**
 * A batched write to a server-rendered (data-ssr) list that has not been
 * taken over yet repaints the list. Typing into a data-model input in an
 * adopted row writes through a batch, so it showed the gap first: state took
 * the typed value and the row's data-bind kept the server text. The same
 * replacement made outside a batch repainted.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const SSR = hasFeature('ssr') && hasFeature('lists')
const describeIfSSR = SSR ? describe : describe.skip

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uname = () => `slbw-${++seq}`

describeIfSSR('a batched write to an adopted server list', () => {
    let wildflower
    let container

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:-9999px'
        document.body.appendChild(container)
    })
    afterEach(() => {
        if (container && container.parentNode) container.parentNode.removeChild(container)
    })

    const mount = async (keyed) => {
        const c = uname()
        const seed = (id) => keyed ? ` data-seed='{"id":${id}}'` : ''
        const tpl = '<template><li><input class="in" data-model="title"><span class="t" data-bind="title"></span></li></template>'
        const row = (id, t) => `<li${seed(id)}><input class="in" data-model="title" value="${t}"><span class="t" data-bind="title">${t}</span></li>`
        wildflower.component(c, { state: { posts: [] } })
        container.innerHTML = `<div class="host" data-component="${c}" data-ssr="true"><ul class="outer" data-list="posts"${keyed ? ' data-key="id"' : ''}>` +
            `${tpl}${row(1, 'First')}${row(2, 'Second')}</ul></div>`
        wildflower.scan(container)
        await settle(150)
        const host = container.querySelector('.host')
        return { host, ctx: wildflower.getComponentInstance(host.dataset.componentId).context }
    }
    const spans = (host) => [...host.querySelectorAll('.t')].map(s => s.textContent)

    for (const keyed of [false, true]) {
        const k = keyed ? 'keyed' : 'keyless'

        it(`typing into a row's data-model repaints the row's data-bind (${k})`, async () => {
            const { host, ctx } = await mount(keyed)
            expect(spans(host)).toEqual(['First', 'Second'])
            const input = host.querySelector('.in')
            input.value = 'Typed'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await settle()
            expect(ctx.posts.map(p => p.title)).toEqual(['Typed', 'Second'])
            expect(spans(host)).toEqual(['Typed', 'Second'])
        })

        it(`a replacement inside startBatch()/apply() repaints (${k})`, async () => {
            const { host, ctx } = await mount(keyed)
            const b = wildflower.startBatch()
            ctx.posts = [{ ...ctx.posts[0], title: 'Set' }, ctx.posts[1]]
            b.apply()
            await settle()
            expect(spans(host)).toEqual(['Set', 'Second'])
        })
    }

    it('a replacement inside wildflower.batch() repaints', async () => {
        const { host, ctx } = await mount(false)
        wildflower.batch(() => { ctx.posts = [ctx.posts[1], { ...ctx.posts[0], title: 'Moved' }] })
        await settle()
        expect(spans(host)).toEqual(['Second', 'Moved'])
    })

    it('a replacement outside a batch still repaints (control)', async () => {
        const { host, ctx } = await mount(false)
        ctx.posts = [{ ...ctx.posts[0], title: 'Set' }, ctx.posts[1]]
        await settle()
        expect(spans(host)).toEqual(['Set', 'Second'])
    })
})
