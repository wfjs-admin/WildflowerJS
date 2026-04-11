/**
 * Computed List Radio Button Tests
 *
 * Tests that radio buttons work correctly within computed lists,
 * including proper isolation between list items.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Computed List Radio Button Binding', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

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

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    it('should bind radio button group within computed list item', async () => {
        wildflower.component('computed-radio-binding', {
            state: {
                questions: [
                    { id: 1, text: 'Question 1', answer: 'b', visible: true },
                    { id: 2, text: 'Question 2', answer: 'a', visible: true },
                    { id: 3, text: 'Question 3', answer: 'c', visible: false }
                ]
            },
            computed: {
                visibleQuestions() {
                    return this.state.questions.filter(q => q.visible)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="computed-radio-binding">
                <div data-list="computed:visibleQuestions">
                    <template>
                        <div class="question">
                            <p data-bind="text"></p>
                            <label>
                                <input type="radio" data-model="answer" value="a" class="radio-a">
                                Option A
                            </label>
                            <label>
                                <input type="radio" data-model="answer" value="b" class="radio-b">
                                Option B
                            </label>
                            <label>
                                <input type="radio" data-model="answer" value="c" class="radio-c">
                                Option C
                            </label>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const component = testContainer.querySelector('[data-component="computed-radio-binding"]')
        const instance = wildflower.componentInstances.get(component.dataset.componentId)

        const questions = testContainer.querySelectorAll('.question')
        expect(questions.length).toBe(2) // Only visible questions

        // Question 1: answer is 'b'
        const q1Radios = questions[0].querySelectorAll('input[type="radio"]')
        expect(q1Radios[0].checked).toBe(false) // a
        expect(q1Radios[1].checked).toBe(true)  // b
        expect(q1Radios[2].checked).toBe(false) // c

        // Question 2: answer is 'a'
        const q2Radios = questions[1].querySelectorAll('input[type="radio"]')
        expect(q2Radios[0].checked).toBe(true)  // a
        expect(q2Radios[1].checked).toBe(false) // b
        expect(q2Radios[2].checked).toBe(false) // c

        // Change Question 1 to 'c'
        q1Radios[2].checked = true
        q1Radios[2].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        expect(instance.state.questions[0].answer).toBe('c')

        // Question 2 should be unchanged
        expect(instance.state.questions[1].answer).toBe('a')
    })

    it('should isolate radio groups between computed list items', async () => {
        wildflower.component('computed-radio-isolation', {
            state: {
                items: [
                    { id: 1, priority: 'low', active: true },
                    { id: 2, priority: 'high', active: true },
                    { id: 3, priority: 'medium', active: false }
                ]
            },
            computed: {
                activeItems() {
                    return this.state.items.filter(i => i.active)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="computed-radio-isolation">
                <div data-list="computed:activeItems">
                    <template>
                        <div class="item">
                            <span class="item-id" data-bind="id"></span>
                            <label>
                                <input type="radio" data-model="priority" value="low" class="radio-low">
                                Low
                            </label>
                            <label>
                                <input type="radio" data-model="priority" value="medium" class="radio-med">
                                Medium
                            </label>
                            <label>
                                <input type="radio" data-model="priority" value="high" class="radio-high">
                                High
                            </label>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const component = testContainer.querySelector('[data-component="computed-radio-isolation"]')
        const instance = wildflower.componentInstances.get(component.dataset.componentId)

        const items = testContainer.querySelectorAll('.item')
        expect(items.length).toBe(2) // Only active items

        // Item 1: priority is 'low'
        const item1Radios = items[0].querySelectorAll('input[type="radio"]')
        expect(item1Radios[0].checked).toBe(true)  // low
        expect(item1Radios[1].checked).toBe(false) // medium
        expect(item1Radios[2].checked).toBe(false) // high

        // Item 2: priority is 'high'
        const item2Radios = items[1].querySelectorAll('input[type="radio"]')
        expect(item2Radios[0].checked).toBe(false) // low
        expect(item2Radios[1].checked).toBe(false) // medium
        expect(item2Radios[2].checked).toBe(true)  // high

        // Change Item 1 to 'medium' - should not affect Item 2
        item1Radios[1].checked = true
        item1Radios[1].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        expect(instance.state.items[0].priority).toBe('medium')
        expect(instance.state.items[1].priority).toBe('high')

        // Verify Item 2 radios are unchanged in DOM
        expect(item2Radios[0].checked).toBe(false) // low
        expect(item2Radios[1].checked).toBe(false) // medium
        expect(item2Radios[2].checked).toBe(true)  // high
    })

    it('should update radio selection when filter changes', async () => {
        wildflower.component('computed-radio-filter-change', {
            state: {
                showAll: false,
                options: [
                    { id: 1, choice: 'yes', featured: true },
                    { id: 2, choice: 'no', featured: false },
                    { id: 3, choice: 'maybe', featured: true }
                ]
            },
            computed: {
                filteredOptions() {
                    if (this.state.showAll) {
                        return this.state.options
                    }
                    return this.state.options.filter(o => o.featured)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="computed-radio-filter-change">
                <button class="toggle-btn" data-action="toggleShowAll">Toggle All</button>
                <div data-list="computed:filteredOptions">
                    <template>
                        <div class="option">
                            <span class="opt-id" data-bind="id"></span>
                            <label>
                                <input type="radio" data-model="choice" value="yes" class="radio-yes">
                                Yes
                            </label>
                            <label>
                                <input type="radio" data-model="choice" value="no" class="radio-no">
                                No
                            </label>
                            <label>
                                <input type="radio" data-model="choice" value="maybe" class="radio-maybe">
                                Maybe
                            </label>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.componentDefinitions.get('computed-radio-filter-change').toggleShowAll = function() {
            this.state.showAll = !this.state.showAll
        }

        wildflower.scan()
        await waitForCompleteRender()

        // Initial: only featured (2 items)
        let options = testContainer.querySelectorAll('.option')
        expect(options.length).toBe(2)

        // Verify initial state
        let opt1Radios = options[0].querySelectorAll('input[type="radio"]')
        expect(opt1Radios[0].checked).toBe(true) // yes

        let opt3Radios = options[1].querySelectorAll('input[type="radio"]')
        expect(opt3Radios[2].checked).toBe(true) // maybe

        // Toggle to show all
        testContainer.querySelector('.toggle-btn').click()
        await waitForCompleteRender()

        // Now should have 3 items
        options = testContainer.querySelectorAll('.option')
        expect(options.length).toBe(3)

        // Check radio states after filter change
        opt1Radios = options[0].querySelectorAll('input[type="radio"]')
        expect(opt1Radios[0].checked).toBe(true) // yes

        const opt2Radios = options[1].querySelectorAll('input[type="radio"]')
        expect(opt2Radios[1].checked).toBe(true) // no

        opt3Radios = options[2].querySelectorAll('input[type="radio"]')
        expect(opt3Radios[2].checked).toBe(true) // maybe
    })

    it('should handle radio button with nested property path', async () => {
        wildflower.component('computed-radio-nested', {
            state: {
                surveys: [
                    { id: 1, response: { rating: 'good' }, complete: true },
                    { id: 2, response: { rating: 'poor' }, complete: true }
                ]
            },
            computed: {
                completeSurveys() {
                    return this.state.surveys.filter(s => s.complete)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="computed-radio-nested">
                <div data-list="computed:completeSurveys">
                    <template>
                        <div class="survey">
                            <span class="survey-id" data-bind="id"></span>
                            <label>
                                <input type="radio" data-model="response.rating" value="poor" class="radio-poor">
                                Poor
                            </label>
                            <label>
                                <input type="radio" data-model="response.rating" value="fair" class="radio-fair">
                                Fair
                            </label>
                            <label>
                                <input type="radio" data-model="response.rating" value="good" class="radio-good">
                                Good
                            </label>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const component = testContainer.querySelector('[data-component="computed-radio-nested"]')
        const instance = wildflower.componentInstances.get(component.dataset.componentId)

        const surveys = testContainer.querySelectorAll('.survey')
        expect(surveys.length).toBe(2)

        // Survey 1: rating is 'good'
        const s1Radios = surveys[0].querySelectorAll('input[type="radio"]')
        expect(s1Radios[0].checked).toBe(false) // poor
        expect(s1Radios[1].checked).toBe(false) // fair
        expect(s1Radios[2].checked).toBe(true)  // good

        // Survey 2: rating is 'poor'
        const s2Radios = surveys[1].querySelectorAll('input[type="radio"]')
        expect(s2Radios[0].checked).toBe(true)  // poor
        expect(s2Radios[1].checked).toBe(false) // fair
        expect(s2Radios[2].checked).toBe(false) // good

        // Change Survey 1 to 'fair'
        s1Radios[1].checked = true
        s1Radios[1].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        expect(instance.state.surveys[0].response.rating).toBe('fair')
        expect(instance.state.surveys[1].response.rating).toBe('poor')
    })
})
