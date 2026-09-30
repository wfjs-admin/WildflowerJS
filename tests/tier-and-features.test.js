/**
 * wildflower.tier and wildflower.features: which tier file this is, and the
 * eight capabilities that differ between tiers. Extensions read `features`
 * to learn what the build can do (the three.js extension needs `pools`,
 * whose frame loop runs every tick()).
 *
 * Checked two ways in every lane: against the tier the lane loaded, and
 * against what the build actually does (a data-list renders, a store's
 * tick() runs, a portal moves, a transition applies its classes, and the
 * plugin, router, query and SSR APIs exist).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, getDistMode, waitForUpdate } from './helpers/load-framework.js'

const TIERS = {
    nano:        { lists: false, pools: false, plugins: false, portals: false, transitions: false, router: false, query: false, ssr: false },
    mini:        { lists: true,  pools: false, plugins: false, portals: false, transitions: false, router: false, query: false, ssr: false },
    'mini-pool': { lists: false, pools: true,  plugins: false, portals: false, transitions: false, router: false, query: false, ssr: false },
    lite:        { lists: true,  pools: true,  plugins: false, portals: false, transitions: false, router: false, query: false, ssr: false },
    core:        { lists: true,  pools: true,  plugins: true,  portals: true,  transitions: true,  router: false, query: false, ssr: false },
    spa:         { lists: true,  pools: true,  plugins: true,  portals: true,  transitions: true,  router: true,  query: false, ssr: false },
    full:        { lists: true,  pools: true,  plugins: true,  portals: true,  transitions: true,  router: true,  query: true,  ssr: true },
}

// The lane's tier: its dist mode without the build suffix.
const LANE_TIER = getDistMode().replace(/-(dev|min|raw)$/, '')

let wf
let n = 0
const hosts = []
beforeAll(async () => { wf = await loadFramework() })
afterEach(() => { while (hosts.length) hosts.pop().remove() })

function mount(html) {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    hosts.push(host)
    wf.scan(host)
    return host
}

describe(`tier and features (${LANE_TIER})`, () => {
    it('tier is the tier this file was built for; version is unchanged', () => {
        expect(wf.tier).toBe(LANE_TIER)
        expect(typeof wf.version).toBe('string')
        expect(wf.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('features lists exactly the eight capabilities, as booleans, frozen', () => {
        expect(Object.keys(wf.features).sort()).toEqual(Object.keys(TIERS.full).sort())
        for (const v of Object.values(wf.features)) expect(typeof v).toBe('boolean')
        expect(Object.isFrozen(wf.features)).toBe(true)
        expect(wf.features).toEqual(TIERS[LANE_TIER])
    })

    it('plugins, router, query and ssr match the APIs the build has', () => {
        expect(wf.features.plugins).toBe(typeof wf.plugin === 'function')
        expect(wf.features.router).toBe(typeof wf.createRouter === 'function')
        expect(wf.features.query).toBe(typeof wf.query === 'function')
        expect(wf.features.ssr).toBe(typeof wf.SSRManager === 'function')
    })

    it('lists matches whether a data-list renders', async () => {
        const name = 'tf-list-' + (++n)
        wf.component(name, { state: { rows: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] } })
        const host = mount(`<div data-component="${name}"><ul data-list="rows" data-key="id"><template><li data-bind="t"></li></template></ul></div>`)
        await waitForUpdate(100)
        expect(host.querySelectorAll('li').length === 2).toBe(wf.features.lists)
    })

    it('pools matches whether a store tick() runs', async () => {
        const name = 'tfTick' + (++n)
        let ticks = 0
        const warn = console.warn
        console.warn = () => {}   // a build without the frame loop warns that tick() will never run
        try { wf.store(name, { state: {}, tick() { ticks++ } }) } finally { console.warn = warn }
        await new Promise((r) => setTimeout(r, 150))
        wf.unregister(name)
        expect(ticks > 0).toBe(wf.features.pools)
    })

    it('portals matches whether data-portal moves its content', async () => {
        const name = 'tf-portal-' + (++n)
        const target = document.createElement('div')
        target.id = 'tf-portal-target-' + n
        document.body.appendChild(target)
        hosts.push(target)
        wf.component(name, { state: {} })
        mount(`<div data-component="${name}"><div data-portal="#${target.id}"><p class="moved">x</p></div></div>`)
        await waitForUpdate(100)
        expect(!!target.querySelector('.moved')).toBe(wf.features.portals)
    })

    it('transitions matches whether data-transition applies its enter classes', async () => {
        const store = 'tfShow' + (++n), name = 'tf-trans-' + n
        wf.store(store, { state: { on: false } })
        wf.component(name, { subscribe: { [store]: [] } })
        const host = mount(`<style>.tf-enter-active { transition: opacity 0.3s; } .tf-enter { opacity: 0; }</style>
            <div data-component="${name}"><div id="tf-t" data-show="$${store}.on" data-transition="tf">Hi</div></div>`)
        await waitForUpdate(100)
        wf.getStore(store).on = true
        await waitForUpdate(20)
        const el = host.querySelector('#tf-t')
        wf.unregister(store)
        expect(el.classList.contains('tf-enter') || el.classList.contains('tf-enter-active')).toBe(wf.features.transitions)
    })
})
