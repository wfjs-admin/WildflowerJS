/**
 * Nested list: reassigning a row's array field must re-render the inner list.
 *
 * Written while investigating a bug reported against the docs "Nested Lists
 * and Complex Data" (project-manager) demo, where a task added via the row's
 * form did not appear while the data landed anyway, surfacing later when a
 * whole-array replacement forced a rebuild.
 *
 * The demo has two ways to add a task:
 *   addTask      — replaces the WHOLE root array (this.projects = [...])
 *   addTaskForm  — reassigns one row's array field (project.tasks = [...])
 *
 * STATUS (2026-07-25): these tests all PASS, and the reported symptom did not
 * reproduce here or against the live page. They are kept as regression cover
 * for the pattern the demo depends on, NOT as a reproduction. Whatever causes
 * the reported behaviour is not the nested reassignment itself.
 *
 * Covered: reassignment on each row index, two consecutive reassignments with
 * no root replacement in between, interaction with a later root replacement,
 * and the demo-faithful handler shape (form + data-model row fields + the
 * three-mutation sequence) with the input focused at submit.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer, triggerAction,
} from '../packages/test-utils/index.js'

describe('Nested list — reassigning a row array field', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    function mount() {
        wildflower.component('project-manager', {
            state: {
                nextTaskId: 100,
                projects: [
                    { id: 1, name: 'Alpha', tasks: [{ id: 1, name: 'a-one' }] },
                    { id: 2, name: 'Bravo', tasks: [{ id: 2, name: 'b-one' }] }
                ]
            },
            // Mirrors the demo's addTaskForm: reassign the row's array field.
            addToFirst() {
                const p = this.projects[0]
                p.tasks = [...p.tasks, { id: this.nextTaskId++, name: 'added-0' }]
            },
            addToSecond() {
                const p = this.projects[1]
                p.tasks = [...p.tasks, { id: this.nextTaskId++, name: 'added-1' }]
            },
            // Mirrors the demo's addTask: replace the whole root array.
            addToFirstViaRoot() {
                const next = [...this.projects]
                next[0] = { ...next[0], tasks: [...next[0].tasks, { id: this.nextTaskId++, name: 'root-0' }] }
                this.projects = next
            }
        })

        testContainer.innerHTML = `
            <div data-component="project-manager">
                <button class="act-first" data-action="addToFirst"></button>
                <button class="act-second" data-action="addToSecond"></button>
                <button class="act-root" data-action="addToFirstViaRoot"></button>
                <div data-list="projects" data-key="id">
                    <template>
                        <div class="project">
                            <span class="pname" data-bind="name"></span>
                            <div data-list="tasks" data-key="id">
                                <template>
                                    <span class="task" data-bind="name"></span>
                                </template>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `
    }

    function tasksIn(projectIndex) {
        const projects = testContainer.querySelectorAll('.project')
        return Array.from(projects[projectIndex].querySelectorAll('.task')).map(el => el.textContent)
    }

    it('renders the seeded nested tasks', async () => {
        mount()
        await waitForCompleteRender()

        expect(tasksIn(0)).toEqual(['a-one'])
        expect(tasksIn(1)).toEqual(['b-one'])
    })

    it('re-renders the inner list when row 0 tasks is reassigned', async () => {
        mount()
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.act-first'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(0)).toEqual(['a-one', 'added-0'])
    })

    it('re-renders the inner list when row 1 tasks is reassigned', async () => {
        mount()
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.act-second'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(1)).toEqual(['b-one', 'added-1'])
    })

    it('does not silently queue reassignments until a root replacement flushes them', async () => {
        mount()
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.act-first'), 'click')
        await triggerAction(testContainer.querySelector('.act-first'), 'click')
        await waitForCompleteRender()

        // Both adds must already be visible, BEFORE any root replacement.
        expect(tasksIn(0)).toEqual(['a-one', 'added-0', 'added-0'])

        await triggerAction(testContainer.querySelector('.act-root'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(0)).toEqual(['a-one', 'added-0', 'added-0', 'root-0'])
    })

    it('keeps row 1 reactive after row 0 has been through a root replacement', async () => {
        mount()
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.act-root'), 'click')
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.act-second'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(1)).toEqual(['b-one', 'added-1'])
    })
})

/**
 * The reported bug, reproduced from a live capture (2026-07-25).
 *
 * Earlier suites here missed it because of two wrong assumptions:
 *   1. They used data-key="id". BOTH demo lists are UNKEYED.
 *   2. They replaced row 0's identity and then mutated row 1. The failing
 *      sequence replaces a row's identity and then mutates THAT SAME row.
 *
 * The demo's header "Add Task" does an immutable whole-array replacement, so
 * projects[i] gets a NEW object identity. Afterwards, the form handler mutates
 * `this.projects[i].tasks` directly on that new object. Live capture at the
 * moment of failure:
 *
 *   row 0: domTaskRows 4, dataTaskCount 6, inputValue "tsafsafasd" (never cleared)
 *   row 1: domTaskRows 5, dataTaskCount 5
 *   totalTasks binding: 11   <-- component-level computed CORRECT
 *   element connected, single instance, DOM bound to the live instance
 *
 * So the component stays reactive while ONE ROW's per-item bindings go stale:
 * both the nested list and the row's data-model input stop updating.
 */
describe('Nested list — mutate a row AFTER its identity was replaced (unkeyed)', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    function mountUnkeyed() {
        wildflower.component('pm-unkeyed', {
            state: {
                nextId: 100,
                projects: [
                    { id: 1, name: 'Alpha', newTaskName: '', tasks: [{ id: 1, name: 'a-one' }] },
                    { id: 2, name: 'Bravo', newTaskName: '', tasks: [{ id: 2, name: 'b-one' }] }
                ]
            },
            computed: {
                totalTasks() { return this.projects.reduce((n, p) => n + p.tasks.length, 0) }
            },
            // Header "Add Task": immutable whole-array replacement -> NEW identity at idx.
            replaceRow(event, element, details) {
                const idx = Number(element.dataset.idx)
                const next = [...this.projects]
                next[idx] = { ...next[idx], tasks: [...next[idx].tasks, { id: this.nextId++, name: 'root-' + idx }] }
                this.projects = next
            },
            // Row form: direct mutation of the (new) row object.
            mutateRow(event, element, details) {
                const idx = Number(element.dataset.idx)
                const p = this.projects[idx]
                p.tasks = [...p.tasks, { id: this.nextId++, name: 'form-' + idx }]
                p.newTaskName = ''
            }
        })

        // NOTE: no data-key on either list — matches the demo.
        testContainer.innerHTML = `
            <div data-component="pm-unkeyed">
                <span class="total" data-bind="totalTasks"></span>
                <button class="root0" data-action="replaceRow" data-idx="0"></button>
                <button class="root1" data-action="replaceRow" data-idx="1"></button>
                <button class="form0" data-action="mutateRow" data-idx="0"></button>
                <button class="form1" data-action="mutateRow" data-idx="1"></button>
                <div data-list="projects">
                    <template>
                        <div class="project">
                            <input class="nt" data-model="newTaskName">
                            <div data-list="tasks">
                                <template>
                                    <span class="task" data-bind="name"></span>
                                </template>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `
    }

    const tasksIn = (i) => {
        const p = testContainer.querySelectorAll('.project')[i]
        return Array.from(p.querySelectorAll('.task')).map(el => el.textContent)
    }
    const total = () => testContainer.querySelector('.total').textContent

    it('re-renders row 0 when mutated AFTER row 0 was identity-replaced', async () => {
        mountUnkeyed()
        await waitForCompleteRender()

        // Replace row 0's identity (header path).
        await triggerAction(testContainer.querySelector('.root0'), 'click')
        await waitForCompleteRender()
        expect(tasksIn(0)).toEqual(['a-one', 'root-0'])

        // Now mutate that SAME row directly (form path). This is the failing case.
        await triggerAction(testContainer.querySelector('.form0'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(0)).toEqual(['a-one', 'root-0', 'form-0'])
    })

    it('clears the row data-model input after the same sequence', async () => {
        mountUnkeyed()
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.root0'), 'click')
        await waitForCompleteRender()

        const input = testContainer.querySelectorAll('.project')[0].querySelector('.nt')
        input.value = 'typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.form0'), 'click')
        await waitForCompleteRender()

        expect(testContainer.querySelectorAll('.project')[0].querySelector('.nt').value).toBe('')
    })

    it('keeps the component-level computed correct even when the row is stale', async () => {
        mountUnkeyed()
        await waitForCompleteRender()
        expect(total()).toBe('2')

        await triggerAction(testContainer.querySelector('.root0'), 'click')
        await waitForCompleteRender()
        await triggerAction(testContainer.querySelector('.form0'), 'click')
        await waitForCompleteRender()

        // The live capture showed the computed staying CORRECT while the row
        // went stale, so this must hold in both the broken and fixed states.
        expect(total()).toBe('4')
    })

    it('survives repeated replace-then-mutate cycles on the same row', async () => {
        mountUnkeyed()
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.root0'), 'click')
        await waitForCompleteRender()
        await triggerAction(testContainer.querySelector('.form0'), 'click')
        await waitForCompleteRender()
        await triggerAction(testContainer.querySelector('.form0'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(0)).toEqual(['a-one', 'root-0', 'form-0', 'form-0'])
    })

    it('re-renders row 1 when mutated after row 1 was identity-replaced', async () => {
        mountUnkeyed()
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.root1'), 'click')
        await waitForCompleteRender()
        await triggerAction(testContainer.querySelector('.form1'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(1)).toEqual(['b-one', 'root-1', 'form-1'])
    })

    // Scoping probe: is this specific to UNKEYED lists? If the keyed variant
    // passes, data-key is both the diagnosis pointer (identity tracking) and an
    // immediate app-side workaround.
    it('KEYED variant: re-renders row 0 when mutated after identity replacement', async () => {
        wildflower.component('pm-keyed', {
            state: {
                nextId: 100,
                projects: [
                    { id: 1, name: 'Alpha', tasks: [{ id: 1, name: 'a-one' }] },
                    { id: 2, name: 'Bravo', tasks: [{ id: 2, name: 'b-one' }] }
                ]
            },
            replaceRow() {
                const next = [...this.projects]
                next[0] = { ...next[0], tasks: [...next[0].tasks, { id: this.nextId++, name: 'root-0' }] }
                this.projects = next
            },
            mutateRow() {
                const p = this.projects[0]
                p.tasks = [...p.tasks, { id: this.nextId++, name: 'form-0' }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="pm-keyed">
                <button class="k-root" data-action="replaceRow"></button>
                <button class="k-form" data-action="mutateRow"></button>
                <div data-list="projects" data-key="id">
                    <template>
                        <div class="project">
                            <div data-list="tasks" data-key="id">
                                <template>
                                    <span class="task" data-bind="name"></span>
                                </template>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForCompleteRender()

        await triggerAction(testContainer.querySelector('.k-root'), 'click')
        await waitForCompleteRender()
        await triggerAction(testContainer.querySelector('.k-form'), 'click')
        await waitForCompleteRender()

        expect(tasksIn(0)).toEqual(['a-one', 'root-0', 'form-0'])
    })
})

/**
 * Faithful reproduction of the docs demo's addTaskForm handler.
 *
 * The simplified case above passes, so the trigger is something the demo does
 * and the simple case does not. The demo's handler makes THREE mutations in a
 * row, the last two against row fields that a data-model input inside the same
 * row is bound to, while that input holds focus at submit time.
 */
describe('Nested list — demo-faithful addTaskForm shape', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    function mountDemo() {
        wildflower.component('pm-demo', {
            state: {
                nextTaskId: 100,
                projects: [
                    { id: 1, name: 'Alpha', collapsed: false, newTaskName: '', newTaskPriority: 'Medium', tasks: [{ id: 1, name: 'a-one', priority: 'High' }] },
                    { id: 2, name: 'Bravo', collapsed: false, newTaskName: '', newTaskPriority: 'Medium', tasks: [{ id: 2, name: 'b-one', priority: 'High' }] }
                ]
            },
            computed: {
                totalTasks() { return this.projects.reduce((n, p) => n + p.tasks.length, 0) }
            },
            // Byte-for-byte the demo's sequence.
            addTaskForm(event, element, details) {
                event.preventDefault()
                const projectIndex = details.index
                const project = this.projects[projectIndex]
                const taskName = project.newTaskName?.trim() || ''
                if (taskName) {
                    const newTask = { id: this.nextTaskId++, name: taskName, priority: project.newTaskPriority }
                    const targetProject = this.projects[projectIndex]
                    targetProject.tasks = [...targetProject.tasks, newTask]
                    targetProject.newTaskName = ''
                    targetProject.newTaskPriority = 'Medium'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="pm-demo">
                <span class="total" data-bind="totalTasks"></span>
                <div data-list="projects" data-key="id">
                    <template>
                        <div class="project">
                            <span class="pname" data-bind="name"></span>
                            <div class="body" data-bind-class="collapsed ? 'd-none' : ''">
                                <form data-action="addTaskForm">
                                    <input type="text" data-model="newTaskName" class="tname">
                                    <select data-model="newTaskPriority" class="tprio">
                                        <option value="Medium">Medium</option>
                                        <option value="High">High</option>
                                    </select>
                                    <button type="submit" class="tsubmit"></button>
                                </form>
                                <div data-list="tasks" data-key="id">
                                    <template>
                                        <span class="task" data-bind="name"></span>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        `
    }

    function tasksIn(projectIndex) {
        const projects = testContainer.querySelectorAll('.project')
        return Array.from(projects[projectIndex].querySelectorAll('.task')).map(el => el.textContent)
    }

    // Types into the row's input the way a user does, leaving it FOCUSED,
    // then submits the form.
    async function typeAndSubmit(projectIndex, text) {
        const project = testContainer.querySelectorAll('.project')[projectIndex]
        const input = project.querySelector('.tname')
        input.focus()
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await waitForCompleteRender()
        project.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await waitForCompleteRender()
    }

    it('shows the task after submitting the row form in project 0', async () => {
        mountDemo()
        await waitForCompleteRender()

        await typeAndSubmit(0, 'typed-one')

        expect(tasksIn(0)).toEqual(['a-one', 'typed-one'])
    })

    it('shows both tasks after two consecutive submits in project 0', async () => {
        mountDemo()
        await waitForCompleteRender()

        await typeAndSubmit(0, 'typed-one')
        await typeAndSubmit(0, 'typed-two')

        expect(tasksIn(0)).toEqual(['a-one', 'typed-one', 'typed-two'])
    })

    it('shows the task after submitting the row form in project 1', async () => {
        mountDemo()
        await waitForCompleteRender()

        await typeAndSubmit(1, 'typed-b')

        expect(tasksIn(1)).toEqual(['b-one', 'typed-b'])
    })
})
