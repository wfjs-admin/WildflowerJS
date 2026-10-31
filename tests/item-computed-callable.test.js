/**
 * An item-level computed (declared with an item parameter) is callable from
 * component code as this.name(item): a plain call of the author's function
 * with the component's context, so the CALLER's tracking sees every read.
 * Rows keep their own path.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('item-level computeds are callable from component code', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    const budgetDef = (extra = {}) => Object.assign({
        state: {
            categories: [{ name: 'Travel', budget: 500 }, { name: 'Food', budget: 200 }],
            expenses: [{ id: 1, cat: 'Travel', amount: 320 }, { id: 2, cat: 'Food', amount: 80 }]
        },
        computed: {
            spent(c) { return this.expenses.filter((e) => e.cat === c.name).reduce((s, e) => s + e.amount, 0) },
            remaining(c) { return c.budget - this.spent(c) },
            topCategory() {
                let top = this.categories[0]
                for (const c of this.categories) if (this.spent(c) > this.spent(top)) top = c
                return top.name
            }
        },
        grow(id, amount) { this.expenses.find((e) => e.id === id).amount = amount }
    }, extra)

    const mount = async (name, html) => {
        host.innerHTML = html
        wildflower.scan()
        await settle()
        return wildflower.getComponent(name)
    }

    it('a component-level computed calls it, and updates when state it reads changes', async () => {
        wildflower.component('icc-same', budgetDef())
        const ctx = await mount('icc-same', `
            <div data-component="icc-same">
                <span id="top" data-bind="topCategory"></span>
                <div data-list="categories" data-key="name"><template><i class="sp" data-bind="spent"></i></template></div>
            </div>`)
        expect(host.querySelector('#top').textContent).toBe('Travel')
        ctx.grow(2, 900)                                  // Food now spends more
        await settle()
        expect(host.querySelector('#top').textContent).toBe('Food')
        // Rows unchanged and still correct.
        expect([...host.querySelectorAll('.sp')].map((e) => e.textContent)).toEqual(['320', '900'])
    })

    it('a method and a watcher can call it; this.computed is left alone', async () => {
        let seen = null
        wildflower.component('icc-method', budgetDef({
            report() { return this.categories.map((c) => c.name + ':' + this.spent(c)).join(',') },
            watch: { expenses: { handler() { seen = this.spent(this.categories[1]) }, deep: true } }
        }))
        const ctx = await mount('icc-method', `<div data-component="icc-method"></div>`)
        expect(ctx.report()).toBe('Travel:320,Food:80')
        ctx.grow(2, 150)
        await settle()
        expect(seen).toBe(150)
        expect(typeof ctx.computed.spent).not.toBe('function')
    })

    it('another component calls it through getComponent() and re-runs when the data changes', async () => {
        wildflower.component('icc-owner', budgetDef())
        wildflower.component('icc-reader', {
            computed: {
                foodSpent() {
                    const b = wildflower.getComponent('icc-owner')
                    return b ? b.spent(b.categories[1]) : -1
                }
            }
        })
        host.innerHTML = `
            <div data-component="icc-owner"></div>
            <div data-component="icc-reader"><span id="food" data-bind="foodSpent"></span></div>`
        wildflower.scan()
        await settle()
        expect(host.querySelector('#food').textContent).toBe('80')
        wildflower.getComponent('icc-owner').grow(2, 250)
        await settle(120)
        expect(host.querySelector('#food').textContent).toBe('250')
    })

    // The framework finds methods by `typeof context[name] === 'function'`.
    // Now that an item-level computed reads as a function from component
    // code, none of those lookups may mistake it for a method.
    describe('is never treated as a method', () => {
        let calls
        const counted = () => ({
            state: { rows: [{ id: 1, n: 2 }] },
            computed: {
                spent(c) { calls++; return c && c.n },
                onPing(c) { calls++; return c && c.n },
                onUpdate(c) { calls++; return c && c.n }
            }
        })
        beforeEach(() => { calls = 0 })

        it('data-action on the component does not run it', async () => {
            wildflower.component('icc-act', counted())
            await mount('icc-act', `<div data-component="icc-act"><button id="b" data-action="spent">x</button></div>`)
            host.querySelector('#b').click()
            await settle()
            expect(calls).toBe(0)
        })

        it('data-action in a list row does not run it', async () => {
            wildflower.component('icc-rowact', counted())
            await mount('icc-rowact', `
                <div data-component="icc-rowact">
                    <div data-list="rows" data-key="id"><template><button class="rb" data-action="spent">x</button></template></div>
                </div>`)
            host.querySelector('.rb').click()
            await settle()
            expect(calls).toBe(0)
        })

        it('an emitted event does not reach it as a handler', async () => {
            wildflower.component('icc-parent', counted())
            wildflower.component('icc-child', { state: {}, send() { this.emit('ping', { x: 1 }) } })
            host.innerHTML = `
                <div data-component="icc-parent">
                    <div data-component="icc-child"><button id="send" data-action="send">send</button></div>
                </div>`
            wildflower.scan()
            await settle()
            host.querySelector('#send').click()
            await settle()
            expect(calls).toBe(0)
        })

        it('a form submit action does not run it', async () => {
            wildflower.component('icc-form', counted())
            await mount('icc-form', `
                <div data-component="icc-form">
                    <form id="f" data-action="submit:spent" data-event-prevent><button id="go" type="submit">go</button></form>
                </div>`)
            host.querySelector('#go').click()
            await settle()
            expect(calls).toBe(0)
        })

        it('a reserved lifecycle name is not exposed, so it never runs as the hook', async () => {
            wildflower.component('icc-life', Object.assign(counted(), { bump() { this.rows[0].n++ } }))
            const ctx = await mount('icc-life', `<div data-component="icc-life"><b data-bind="rows.0.n"></b></div>`)
            expect(typeof ctx.onUpdate).not.toBe('function')
            ctx.bump()
            await settle()
            expect(calls).toBe(0)
            expect(typeof ctx.spent).toBe('function')
        })

        it.skipIf(!hasFeature('portals'))('a portaled data-action does not run it', async () => {
            const target = document.createElement('div')
            target.id = 'icc-portal-target'
            document.body.appendChild(target)
            try {
                wildflower.component('icc-portal', counted())
                await mount('icc-portal', `
                    <div data-component="icc-portal">
                        <div data-portal="#icc-portal-target"><button class="pb" data-action="spent">x</button></div>
                    </div>`)
                const btn = target.querySelector('.pb')
                expect(btn).not.toBeNull()
                btn.click()
                await settle()
                expect(calls).toBe(0)
            } finally { target.remove() }
        })

        it.skipIf(!hasFeature('pools'))('a pool data-action and a pool hook name do not run it', async () => {
            wildflower.component('icc-pool', Object.assign(counted(), { pools: { things: { onAdd: 'spent' } } }))
            const ctx = await mount('icc-pool', `
                <div data-component="icc-pool">
                    <div data-pool="things" data-key="id"><template><button class="pa" data-action="onPing">x</button></template></div>
                </div>`)
            ctx.pools.things.add({ id: 1, n: 3 })
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 20))))
            host.querySelector('.pa').click()
            await settle()
            expect(calls).toBe(0)
        })
    })

    it.skipIf(isMinifiedBuild())('dev builds still warn when data-action names an item-level computed', async () => {
        const warns = []
        const orig = console.warn
        console.warn = (...a) => { warns.push(a.join(' ')); }
        try {
            wildflower.component('icc-warn', budgetDef())
            await mount('icc-warn', `<div data-component="icc-warn"><button data-action="spent">x</button></div>`)
        } finally { console.warn = orig }
        expect(warns.some((w) => w.includes('"spent"') || w.includes("'spent'"))).toBe(true)
    })

    it('an item-level computed calling another still works in rows', async () => {
        wildflower.component('icc-rows', budgetDef())
        await mount('icc-rows', `
            <div data-component="icc-rows">
                <div data-list="categories" data-key="name"><template><i class="rem" data-bind="remaining"></i></template></div>
            </div>`)
        expect([...host.querySelectorAll('.rem')].map((e) => e.textContent)).toEqual(['180', '120'])
    })
})
