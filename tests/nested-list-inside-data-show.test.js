/**
 * Bug repro for WIL-27 (PM tracker, internal demo).
 *
 * Pattern: a NESTED data-list (group → rows) lives inside a `data-show` section
 * that is FALSE at first scan. When the section flips visible later, the outer
 * list stamps but the inner data-list never binds — silent failure, no warning.
 *
 * The `list-inside-data-show.test.js` suite covers single-level lists in this
 * scenario and they pass. This test isolates the nested case.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Nested data-list inside data-show', () => {
    let testContainer
    let wildflower

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }
        if (wildflower._listRelationships) wildflower._listRelationships.clear()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('renders nested rows when section becomes visible after init', async () => {
        // Mirrors the PM tracker shape: section starts hidden, contains a
        // group list whose template has its own row data-list inside.
        wildflower.component('nested-show', {
            state: {
                visible: false,
                groups: [
                    { id: 'g1', name: 'Group 1', rows: [{ id: 'r1', label: 'A' }, { id: 'r2', label: 'B' }] },
                    { id: 'g2', name: 'Group 2', rows: [{ id: 'r3', label: 'C' }] }
                ]
            },
            show() { this.state.visible = true }
        })

        testContainer.innerHTML = `
            <div data-component="nested-show">
                <section data-show="visible" class="outer-section">
                    <div class="outer" data-list="groups" data-key="id">
                        <template>
                            <div class="group">
                                <span class="group-name" data-bind="name"></span>
                                <div class="inner" data-list="rows" data-key="id">
                                    <template>
                                        <div class="row">
                                            <span data-bind="label"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </section>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const componentEl = testContainer.querySelector('[data-component="nested-show"]')
        const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
        expect(component).toBeTruthy()

        // Section starts hidden
        const section = testContainer.querySelector('.outer-section')
        expect(section.style.display).toBe('none')

        // Flip visible
        component.show()
        await waitForUpdate(100)

        expect(section.style.display).not.toBe('none')

        // Outer list should have stamped 2 groups
        const groups = testContainer.querySelectorAll('.group')
        expect(groups.length).toBe(2)

        // Inner lists should have stamped rows: 2 + 1 = 3
        const rows = testContainer.querySelectorAll('.row')
        expect(rows.length).toBe(3)
    })

    it('renders nested rows when section is visible from the start (sanity)', async () => {
        wildflower.component('nested-visible', {
            state: {
                visible: true,
                groups: [
                    { id: 'g1', name: 'Group 1', rows: [{ id: 'r1', label: 'A' }, { id: 'r2', label: 'B' }] }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="nested-visible">
                <section data-show="visible" class="outer-section">
                    <div class="outer" data-list="groups" data-key="id">
                        <template>
                            <div class="group">
                                <span class="group-name" data-bind="name"></span>
                                <div class="inner" data-list="rows" data-key="id">
                                    <template>
                                        <div class="row">
                                            <span data-bind="label"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </section>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        expect(testContainer.querySelectorAll('.group').length).toBe(1)
        expect(testContainer.querySelectorAll('.row').length).toBe(2)
    })

    // The PM demo's actual shape: pm-app owns the data-show, but pm-cycle-view
    // (a child component) owns the data-list. This reproducer crosses
    // component boundaries the same way.
    it('renders nested rows when parent data-show wraps a CHILD component data-list (cycle-view shape)', async () => {
        wildflower.component('cycle-host', {
            state: { route: 'home' }
        })
        wildflower.component('cycle-body', {
            state: {
                groups: [
                    { id: 'g1', name: 'Group 1', rows: [{ id: 'r1', label: 'A' }, { id: 'r2', label: 'B' }] },
                    { id: 'g2', name: 'Group 2', rows: [{ id: 'r3', label: 'C' }] }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="cycle-host">
                <section data-show="route === 'cycle'" class="cycle-section">
                    <div data-component="cycle-body">
                        <div class="outer" data-list="groups" data-key="id">
                            <template>
                                <div class="group">
                                    <span class="group-name" data-bind="name"></span>
                                    <div class="inner" data-list="rows" data-key="id">
                                        <template>
                                            <div class="row">
                                                <span data-bind="label"></span>
                                            </div>
                                        </template>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </section>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const hostEl = testContainer.querySelector('[data-component="cycle-host"]')
        const host = wildflower.componentInstances.get(hostEl.dataset.componentId)

        // Section starts hidden because route !== 'cycle'.
        expect(testContainer.querySelector('.cycle-section').style.display).toBe('none')

        // Flip the parent state — section becomes visible. The CHILD's data-list
        // should now stamp its groups, and each group's nested data-list should
        // stamp its rows.
        host.state.route = 'cycle'
        await waitForUpdate(150)

        expect(testContainer.querySelector('.cycle-section').style.display).not.toBe('none')

        const groups = testContainer.querySelectorAll('.group')
        const rows = testContainer.querySelectorAll('.row')
        expect(groups.length).toBe(2)
        expect(rows.length).toBe(3)
    })

    // Closer to the demo: outer list source is a COMPUTED that pulls from a
    // store, and the store data populates after init (mimics async hydration).
    // Section is initially hidden, becomes visible later.
    it('renders nested rows when source is a store-backed computed and section flips visible (demo shape)', async () => {
        wildflower.store('cyclesStore', {
            state: {
                groups: []
            },
            populate() {
                this.groups = [
                    { id: 'g1', name: 'Group 1', rows: [{ id: 'r1', label: 'A' }, { id: 'r2', label: 'B' }] },
                    { id: 'g2', name: 'Group 2', rows: [{ id: 'r3', label: 'C' }] }
                ]
            }
        })
        wildflower.component('store-host', {
            subscribe: { cyclesStore: ['groups'] },
            state: { route: 'home' }
        })
        wildflower.component('store-cycle-view', {
            subscribe: { cyclesStore: ['groups'] },
            computed: {
                groupRows() {
                    var s = wildflower.getStore('cyclesStore')
                    return (s.groups || []).slice()
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="store-host">
                <section data-show="route === 'cycle'" class="cycle-section">
                    <div data-component="store-cycle-view">
                        <div class="outer" data-list="groupRows" data-key="id">
                            <template>
                                <div class="group">
                                    <span class="group-name" data-bind="name"></span>
                                    <div class="inner" data-list="rows" data-key="id">
                                        <template>
                                            <div class="row">
                                                <span data-bind="label"></span>
                                            </div>
                                        </template>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </section>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const hostEl = testContainer.querySelector('[data-component="store-host"]')
        const host = wildflower.componentInstances.get(hostEl.dataset.componentId)
        const store = wildflower.getStore('cyclesStore')

        // Section starts hidden, store empty.
        expect(testContainer.querySelector('.cycle-section').style.display).toBe('none')

        // Flip the parent state — section visible — but store still empty, so
        // computed returns []. No rows yet.
        host.state.route = 'cycle'
        await waitForUpdate(100)
        expect(testContainer.querySelectorAll('.group').length).toBe(0)

        // Now populate the store. The computed should re-run, the outer
        // data-list should stamp groups, and each nested data-list should
        // stamp its rows. This is the reactivity chain that the demo relies on.
        store.populate()
        await waitForUpdate(150)

        const groups = testContainer.querySelectorAll('.group')
        const rows = testContainer.querySelectorAll('.row')
        expect(groups.length).toBe(2)
        expect(rows.length).toBe(3)
    })

    // The team-view scenario: data-show condition AND the data-list source
    // both depend on a store-backed chained computed (an "exists" check that
    // resolves only after pm has hydrated). The earlier work had to remove a
    // data-show wrapper for the list to render — confirm whether that was
    // a real framework gap or a misdiagnosis.
    it('renders list when both data-show and data-list source depend on a chained store computed', async () => {
        wildflower.store('hostStore', {
            state: { teamId: null, teams: [] },
            setTeam(id) { this.teamId = id },
            populate(rows) { this.teams = rows }
        })
        wildflower.component('chained-host', {
            subscribe: { hostStore: ['teamId', 'teams'] },
            computed: {
                _team() {
                    var s = wildflower.getStore('hostStore')
                    var id = s.teamId
                    if (!id) return null
                    return s.teams.find(function (t) { return t.id === id }) || null
                },
                exists() { return !!this.computed._team },
                memberRows() {
                    var t = this.computed._team
                    return t ? (t.members || []) : []
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="chained-host">
                <div class="wrapper" data-show="exists">
                    <div class="members" data-list="memberRows" data-key="id">
                        <template>
                            <div class="member">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const store = wildflower.getStore('hostStore')

        // Initial: nothing — store is empty, exists is false, wrapper hidden
        expect(testContainer.querySelector('.wrapper').style.display).toBe('none')
        expect(testContainer.querySelectorAll('.member').length).toBe(0)

        // First populate teams, then point at one — both updates trigger the
        // chained computed.
        store.populate([
            { id: 't1', members: [{ id: 'm1', name: 'Alice' }, { id: 'm2', name: 'Bob' }] }
        ])
        await waitForUpdate(50)

        store.setTeam('t1')
        await waitForUpdate(150)

        expect(testContainer.querySelector('.wrapper').style.display).not.toBe('none')
        expect(testContainer.querySelectorAll('.member').length).toBe(2)
    })

    it('renders nested rows when section is visible at init but data populates later', async () => {
        // Section visible from start, but groups starts empty and gets
        // populated after init — same shape as a computed that resolves
        // asynchronously (e.g. waiting on store hydration).
        wildflower.component('nested-late-data', {
            state: {
                visible: true,
                groups: []
            },
            populate() {
                this.state.groups = [
                    { id: 'g1', name: 'Group 1', rows: [{ id: 'r1', label: 'A' }, { id: 'r2', label: 'B' }] },
                    { id: 'g2', name: 'Group 2', rows: [{ id: 'r3', label: 'C' }] }
                ]
            }
        })

        testContainer.innerHTML = `
            <div data-component="nested-late-data">
                <section data-show="visible" class="outer-section">
                    <div class="outer" data-list="groups" data-key="id">
                        <template>
                            <div class="group">
                                <span class="group-name" data-bind="name"></span>
                                <div class="inner" data-list="rows" data-key="id">
                                    <template>
                                        <div class="row">
                                            <span data-bind="label"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </section>
            </div>
        `

        wildflower._scanForComponents()
        await waitForUpdate(100)

        const componentEl = testContainer.querySelector('[data-component="nested-late-data"]')
        const component = wildflower.componentInstances.get(componentEl.dataset.componentId)

        component.populate()
        await waitForUpdate(100)

        expect(testContainer.querySelectorAll('.group').length).toBe(2)
        expect(testContainer.querySelectorAll('.row').length).toBe(3)
    })
})
