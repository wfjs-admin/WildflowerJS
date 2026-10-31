/**
 * A server-rendered list whose data-list element has no <template> child.
 *
 * Hydration adopts the server rows: the component's array is parsed from
 * them, each row is bound to its item (this is one of the paths that reaches
 * ssr-list's _bindWithFallback, since there is no compiled template to bind
 * from), and an action in a row is told its row. What the list cannot do
 * without a template is stamp a row on the client, so a later render leaves
 * the server rows as they are and development builds report WF-401 with the
 * fix. Development lanes only: the WF-401 report is a dev diagnostic.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const describeIf = hasFeature('ssr') && !isMinifiedBuild() ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-notpl-${++seq}`
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim()

describeIf('SSR list without a <template>', () => {
    let container, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); container = document.createElement('div'); document.body.appendChild(container) })
    afterEach(() => { container.remove() })

    it('adopts the server rows, tells a row action its item, and reports WF-401 when the list renders', async () => {
        const c = uname('c')
        const warn = console.warn, info = console.info
        console.warn = () => {}
        console.info = () => {}
        try {
            container.innerHTML = `
                <div data-component="${c}" data-ssr="true">
                    <ul data-list="rows">
                        <li><span class="nm" data-bind="name">Alpha</span> <span class="qty" data-bind="qty" data-type="number">2</span> <button class="b" data-action="pick">x</button></li>
                        <li><span class="nm" data-bind="name">Beta</span> <span class="qty" data-bind="qty" data-type="number">3</span> <button class="b" data-action="pick">x</button></li>
                    </ul>
                </div>`
            let ctx
            const picks = []
            wildflower.component(c, {
                state: { rows: [] },
                init() { ctx = this },
                pick(e, el, d) { picks.push(d && d.item ? d.item.name : null) }
            })
            wildflower.diagnostics.length = 0
            wildflower.scan(container)
            await settle()

            // Adopted: the server rows stay, and the array is parsed from them.
            const rows = [...container.querySelectorAll('li')]
            expect(rows.map(text)).toEqual(['Alpha 2 x', 'Beta 3 x'])
            expect(JSON.parse(JSON.stringify(ctx.rows))).toEqual([{ name: 'Alpha', qty: 2 }, { name: 'Beta', qty: 3 }])

            // A row action is told its row.
            rows[1].querySelector('.b').click()
            await settle()
            expect(picks).toEqual(['Beta'])

            // A render that would stamp a row has no template to stamp from:
            // the server rows stay, and the dev build says why.
            ctx.rows.push({ name: 'Gamma', qty: 1 })
            await settle()
            const after = [...container.querySelectorAll('li')]
            expect(after.length).toBe(2)
            expect(after.every((li, i) => li === rows[i])).toBe(true)
            const reported = wildflower.diagnostics.filter(d => d.code === 'WF-401')
            expect(reported.length).toBe(1)
            expect(reported[0].context).toContain('rows must be wrapped in a <template> child')
        } finally {
            console.warn = warn
            console.info = info
        }
    })
})
