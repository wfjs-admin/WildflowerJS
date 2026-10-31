/**
 * A list row's direct writer and the entity that OWNS the item.
 *
 * A text binding on a child of a row (`<li><span data-bind="title">`) can be
 * served by a direct writer: a write to item.title updates that one text node
 * and skips everything else, including the owning entity's change dispatch.
 * That is only sound when the owner has nothing riding the dispatch. The
 * check used to look at the RENDERING component only, so a store listed by a
 * plain component never saved (autoSave), never ran its watchers, and never
 * told its subscribers about an item edit; the row on screen still updated.
 * Shipped in 1.5.3 and 1.5.4.
 *
 * Oracle: the same scenario with the binding on the row root, which takes no
 * direct writer. Both row shapes must report the same notifications, on every
 * write (the first write and later ones take different paths).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const describeIfLists = hasFeature('lists') ? describe : describe.skip

const ROWS = {
    span: '<li><span class="t" data-bind="title"></span></li>',   // direct-writer eligible
    root: '<li class="t" data-bind="title"></li>'                 // reference: no direct writer
}
const WRITES = ['W1', 'W2', 'W3']

describeIfLists('direct writers and the owning entity\'s notifications', () => {
    let host, wildflower, n = 0
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())
    const text = () => host.querySelector('.t').textContent

    // A store with autoSave, a deep watcher and an imperative subscriber,
    // listed by a component that has none of those.
    const storeScenario = async (row) => {
        const name = 'dwo-s' + (++n), KEY = 'dwo-key-' + n
        localStorage.removeItem(KEY)
        const seen = { watch: 0, sub: 0, update: 0 }
        wildflower.store(name, {
            storageKey: KEY, autoSave: true,
            state: { items: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] },
            watch: { items: { handler() { seen.watch++ }, deep: true } },
            rename(v) { this.items[0].title = v }
        })
        wildflower.getStore(name).subscribe('', () => { seen.sub++ })
        wildflower.component(name + '-view', { state: {} })
        wildflower.component(name + '-other', {
            subscribe: { [name]: ['items'] },
            onStoreUpdate() { seen.update++ }
        })
        host.innerHTML = `
            <div data-component="${name}-view"><ul data-list="$${name}.items" data-key="id"><template>${row}</template></ul></div>
            <div data-component="${name}-other"></div>`
        wildflower.scan()
        await settle()
        const out = []
        for (const v of WRITES) {
            const before = { ...seen }
            wildflower.getStore(name).rename(v)
            await settle(250)
            let saved
            try { saved = JSON.parse(localStorage.getItem(KEY)).items[0].title } catch (e) { saved = null }
            out.push({ dom: text(), saved, watch: seen.watch - before.watch, sub: seen.sub - before.sub, update: seen.update - before.update })
        }
        localStorage.removeItem(KEY)
        return out
    }

    it('D01 a store listed with child text bindings still saves, watches and notifies on every item edit', async () => {
        const reference = await storeScenario(ROWS.root)
        host.innerHTML = ''
        resetFramework()
        const span = await storeScenario(ROWS.span)
        WRITES.forEach((v, i) => {
            expect(span[i].dom).toBe(v)
            expect(span[i].saved, 'autoSave after ' + v).toBe(v)
            expect(span[i].watch, 'store watcher after ' + v).toBeGreaterThan(0)
            expect(span[i].sub, 'store.subscribe after ' + v).toBeGreaterThan(0)
        })
        // And exactly what the reference row shape reports, the declared
        // subscriber in another component included.
        expect(span).toEqual(reference)
    })

    // A component whose own list takes direct writers, then gains a
    // subscriber AFTER the list mounted.
    it('D02 a subscription added after the list mounted still hears item edits', async () => {
        const name = 'dwo-late' + (++n)
        wildflower.component(name, {
            state: { items: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] },
            rename(v) { this.items[0].title = v }
        })
        host.innerHTML = `<div data-component="${name}"><ul data-list="items" data-key="id"><template>${ROWS.span}</template></ul></div>`
        wildflower.scan()
        await settle()
        const ctx = wildflower.getComponent(name)
        ctx.rename('W0')                  // the leaf is a direct writer from here on
        await settle()
        let heard = 0
        ctx.subscribe('', () => { heard++ })
        ctx.rename('W1')
        await settle()
        ctx.rename('W2')
        await settle()
        expect(text()).toBe('W2')
        expect(heard).toBeGreaterThanOrEqual(2)
    })

    // Two instances of one component type. The first has nothing listening and
    // takes the fast path; the second persists itself (data-storage-key and
    // data-auto-save on ITS element only). The verdict used to be cached per
    // type, so the second inherited "nothing is listening" and never saved.
    it('D03 a second instance that saves itself is not treated like the first, which does not', async () => {
        const name = 'dwo-two' + (++n), KEY = 'dwo-two-key-' + n
        localStorage.removeItem(KEY)
        wildflower.component(name, {
            state: { items: [{ id: 1, title: 'A' }] },
            rename(v) { this.items[0].title = v }
        })
        const list = `<ul data-list="items" data-key="id"><template>${ROWS.span}</template></ul>`
        host.innerHTML = `<div data-component="${name}">${list}</div>`
        wildflower.scan()
        await settle()
        const first = wildflower.componentInstances.get(host.querySelector(`[data-component="${name}"]`).dataset.componentId).context
        first.rename('F1')
        await settle()
        first.rename('F2')
        await settle()
        host.insertAdjacentHTML('beforeend', `<div data-component="${name}" data-storage-key="${KEY}" data-auto-save>${list}</div>`)
        wildflower.scan()
        await settle()
        const secondEl = host.querySelectorAll(`[data-component="${name}"]`)[1]
        const second = wildflower.componentInstances.get(secondEl.dataset.componentId).context
        for (const v of ['S1', 'S2']) {
            second.rename(v)
            await settle(250)
            expect(secondEl.querySelector('.t').textContent).toBe(v)
            let saved = null
            try { saved = JSON.parse(localStorage.getItem(KEY)).items[0].title } catch (e) { /* not saved */ }
            expect(saved, 'second instance saved after ' + v).toBe(v)
        }
        localStorage.removeItem(KEY)
    })

    // Everything else a component's change dispatch drives. Each runs with
    // the direct-writer row shape and the reference shape; they must agree.
    const both = async (run) => {
        const reference = await run(ROWS.root)
        host.innerHTML = ''
        resetFramework()
        const span = await run(ROWS.span)
        return { reference, span }
    }
    const listOf = (name, row, extra = '') =>
        `<div data-component="${name}"><ul data-list="items" data-key="id"><template>${row}</template></ul>${extra}</div>`
    const oneItem = () => ({ items: [{ id: 1, title: 'A' }] })

    it('D05 onUpdate and beforeUpdate run for an item edit', async () => {
        const { reference, span } = await both(async (row) => {
            const name = 'dwo-upd' + (++n)
            let ups = 0, befores = 0
            wildflower.component(name, { state: oneItem(), onUpdate() { ups++ }, beforeUpdate() { befores++ }, rename(v) { this.items[0].title = v } })
            host.innerHTML = listOf(name, row)
            wildflower.scan()
            await settle()
            const out = []
            for (const v of WRITES) {
                const b = [ups, befores]
                wildflower.getComponent(name).rename(v)
                await settle()
                out.push({ dom: text(), up: ups - b[0], before: befores - b[1] })
            }
            return out
        })
        expect(reference.every((r) => r.up > 0 && r.before > 0)).toBe(true)
        expect(span).toEqual(reference)
    })

    it('D06 a component:afterUpdate hook registered after the list mounted hears item edits', async () => {
        const { reference, span } = await both(async (row) => {
            const name = 'dwo-hook' + (++n)
            let after = 0
            wildflower.component(name, { state: oneItem(), rename(v) { this.items[0].title = v } })
            host.innerHTML = listOf(name, row)
            wildflower.scan()
            await settle()
            wildflower.getComponent(name).rename('W0')
            await settle()
            // Hooks are global and outlive a test reset: take it off again.
            const off = wildflower.hook('component:afterUpdate', () => { after++ })
            const out = []
            try {
                for (const v of WRITES) {
                    const b = after
                    wildflower.getComponent(name).rename(v)
                    await settle()
                    out.push({ dom: text(), after: after - b })
                }
            } finally { off() }
            return out
        })
        expect(reference.every((r) => r.after > 0)).toBe(true)
        expect(span).toEqual(reference)
    })

    it('D07 a child component\'s prop taken from an item field follows the edit', async () => {
        const { reference, span } = await both(async (row) => {
            const name = 'dwo-kid' + (++n)
            wildflower.component(name, { state: oneItem(), rename(v) { this.items[0].title = v } })
            wildflower.component(name + '-c', { props: { t: {} }, state: {} })
            host.innerHTML = listOf(name, row, `<div data-component="${name}-c" data-prop-t="items.0.title"><b class="kid" data-bind="props.t"></b></div>`)
            wildflower.scan()
            await settle()
            const out = []
            for (const v of WRITES) {
                wildflower.getComponent(name).rename(v)
                await settle()
                out.push({ dom: text(), kid: host.querySelector('.kid').textContent })
            }
            return out
        })
        expect(reference.map((r) => r.kid)).toEqual(WRITES)
        expect(span).toEqual(reference)
    })

    it('D08 a parent with a watcher, its array listed by a child through props', async () => {
        const { reference, span } = await both(async (row) => {
            const name = 'dwo-par' + (++n)
            let watched = 0
            wildflower.component(name, { state: oneItem(), watch: { items: { handler() { watched++ }, deep: true } }, rename(v) { this.items[0].title = v } })
            wildflower.component(name + '-c', { props: { rows: {} }, state: {} })
            host.innerHTML = `<div data-component="${name}"><div data-component="${name}-c" data-prop-rows="items"><ul data-list="props.rows" data-key="id"><template>${row}</template></ul></div></div>`
            wildflower.scan()
            await settle()
            const out = []
            for (const v of WRITES) {
                const b = watched
                wildflower.getComponent(name).rename(v)
                await settle()
                out.push({ dom: text(), watched: watched - b })
            }
            return out
        })
        expect(reference.every((r, i) => r.dom === WRITES[i] && r.watched > 0)).toBe(true)
        expect(span).toEqual(reference)
    })

    // The fast path this protects: a component with nothing listening still
    // skips its dispatch. White-box (reads the state manager), so dev/raw only.
    it.skipIf(isMinifiedBuild())('D04 a component with nothing listening still skips the dispatch for a direct-writer leaf', async () => {
        const name = 'dwo-quiet' + (++n)
        wildflower.component(name, {
            state: { items: [{ id: 1, title: 'A' }] },
            rename(v) { this.items[0].title = v }
        })
        host.innerHTML = `<div data-component="${name}"><ul data-list="items" data-key="id"><template>${ROWS.span}</template></ul></div>`
        wildflower.scan()
        await settle()
        const el = host.querySelector(`[data-component="${name}"]`)
        const inst = wildflower.componentInstances.get(el.dataset.componentId)
        inst.context.rename('W1')
        await settle()
        const epoch = inst.stateManager._globalEpoch
        inst.context.rename('W2')
        inst.context.rename('W3')
        await settle()
        expect(text()).toBe('W3')
        // The dispatch bumps _globalEpoch; a skipped dispatch leaves it alone.
        expect(inst.stateManager._globalEpoch).toBe(epoch)
    })
})
