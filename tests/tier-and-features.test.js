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

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { loadFramework, getDistMode, waitForUpdate, isMinifiedBuild } from './helpers/load-framework.js'

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

// Which internal members each tier's file carries. A tier ships only the code
// it can run: list members stay out of the list-free tiers (nano, mini-pool),
// SSR and plugin members out of the tiers without those features, and the
// dev-only diagnostics out of every production file. Names are mangled in
// minified builds, so these run on the dev and raw lanes only.
describe.skipIf(isMinifiedBuild())(`members the tier carries (${LANE_TIER})`, () => {
    const LIST_ONLY = [
        '_resolveCompiledBinding', '_cleanupContextsInSubtree', '_insideHiddenRender', '_getListItems',
        '_getComponentId', '_applyEventConfiguration', '_findActionElementViaRegistry',
        '_findActionElementViaMetadata', '_hasElementDelegation', '_markElementDelegation', '_rowTemplateBulkServed',
        '_findListItemAncestor',
    ]
    const LISTS_AND_POOLS = ['_findTemplate', '_buildElementsArrayFromMetadata']
    const SSR_ONLY = ['_shouldPreventContentUpdate', '_executeFallbackModel', '_executeFallbackShow']
    const PLUGIN_ONLY = ['_registerPluginDependent', '_externalPluginGet']
    const DEV_ONLY = [
        '_warnRecordFieldMisses', '_devPropPathResolvable', '_devPropPathCandidates',
        '_validateComponentBindings', '_validateBindingPath', '_validateExpressionVariables',
        '_validateObjectFormExpression', '_validateActionMethods', '_checkTypeMatch',
        '_inferTypesFromState', '_inferTypeFromValue', '_levenshteinDistance',
        '_findSimilarPropertyNames', '_parseActionDefsSimple', '_bindingOrphanSweep', '_modifierFalsyValueSweep',
    ]
    const DEV_ONLY_LISTS = ['_assertStandaloneCollectorsAgree', '_escapeHTML']
    const DEV_ONLY_QUERY = ['_parseQueryExpect', '_queryExpectCheck', '_queryWarnRedirect', '_queryHeadersOriginMiss', '_queryOrphanSweep']

    const kinds = (names) => Object.fromEntries(names.map((n) => [n, typeof wf[n]]))
    const all = (names, kind) => Object.fromEntries(names.map((n) => [n, kind]))

    it('list-only members are present exactly when the tier has lists', () => {
        expect(kinds(LIST_ONLY)).toEqual(all(LIST_ONLY, TIERS[LANE_TIER].lists ? 'function' : 'undefined'))
    })

    it('template lookup members are present when the tier has lists or pools', () => {
        const t = TIERS[LANE_TIER]
        expect(kinds(LISTS_AND_POOLS)).toEqual(all(LISTS_AND_POOLS, t.lists || t.pools ? 'function' : 'undefined'))
    })

    it('SSR-only members are present exactly when the tier has ssr', () => {
        expect(kinds(SSR_ONLY)).toEqual(all(SSR_ONLY, TIERS[LANE_TIER].ssr ? 'function' : 'undefined'))
    })

    it('plugin-only members are present exactly when the tier has plugins', () => {
        expect(kinds(PLUGIN_ONLY)).toEqual(all(PLUGIN_ONLY, TIERS[LANE_TIER].plugins ? 'function' : 'undefined'))
    })

    it('development builds keep the dev-only diagnostics', () => {
        const t = TIERS[LANE_TIER]
        const names = [...DEV_ONLY, ...(t.lists ? DEV_ONLY_LISTS : []), ...(t.query ? DEV_ONLY_QUERY : [])]
        expect(kinds(names)).toEqual(all(names, 'function'))
    })
})

// window.WF_ERRORS. Production files carry only the entries production code
// raises (WF_ERRORS_PROD in wfUtils.js): the keys below are every key a
// production bundle of any tier reads, as scripts/check-wf-errors-prod.cjs
// found them. Development and raw files carry the whole table, including the
// entries only dev diagnostics raise.
describe(`window.WF_ERRORS (${LANE_TIER})`, () => {
    const PROD_KEYS = [
        'CIRCULAR_DEPENDENCY', 'DOM_OWNERSHIP', 'EMIT_NO_INSTANCE', 'NAMED_ROUTE_NOT_FOUND', 'QUERY_TO_INVALID',
        'ROUTE_ALIAS_ERROR', 'ROUTE_COMPONENT_ERROR', 'ROUTE_GUARD_ERROR', 'ROUTE_HANDLER_ERROR', 'ROUTE_HOOK_ERROR',
        'ROUTE_NAVIGATION_ERROR', 'ROUTE_SCROLL_ERROR', 'STORE_CREATE_ERROR', 'STORE_DEFAULT_ERROR', 'STORE_DEF_INVALID',
        'STORE_INIT_ERROR', 'STORE_NAME_INVALID',
    ]
    const DEV_ONLY_KEYS = ['ROW_LIST_PATH', 'BINDING_VALIDATION', 'ROUTE_NOT_FOUND']

    it('carries every key production code reads, each with a code', () => {
        expect(typeof window.WF_ERRORS).toBe('object')
        const codes = Object.fromEntries(PROD_KEYS.map((k) => [k, typeof window.WF_ERRORS[k]?.code]))
        expect(codes).toEqual(Object.fromEntries(PROD_KEYS.map((k) => [k, 'string'])))
        for (const k of PROD_KEYS) expect(window.WF_ERRORS[k].code).toMatch(/^WF-/)
    })

    it(isMinifiedBuild() ? 'production files leave out the dev-only entries' : 'development files keep the dev-only entries', () => {
        const present = Object.fromEntries(DEV_ONLY_KEYS.map((k) => [k, k in window.WF_ERRORS]))
        expect(present).toEqual(Object.fromEntries(DEV_ONLY_KEYS.map((k) => [k, !isMinifiedBuild()])))
        if (!isMinifiedBuild()) expect(window.WF_ERRORS.ROW_LIST_PATH.code).toBe('WF-519')
    })

    // Page code that reuses the table with a key a production file left out
    // passes undefined: wfError() logs a line and never throws.
    it('wfError() with a missing entry logs a line and does not throw', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            expect(() => window.wfError(window.WF_ERRORS.NO_SUCH_ENTRY, { context: 'page code' })).not.toThrow()
            expect(() => window.wfError(undefined, { warn: true })).not.toThrow()
            expect(spy.mock.calls.length + spyWarn.mock.calls.length).toBeGreaterThan(0)
        } finally {
            spy.mockRestore()
            spyWarn.mockRestore()
        }
    })
})
