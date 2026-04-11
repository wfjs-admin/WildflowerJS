/**
 * @vitest-environment browser
 * 
 * Test for implicit computed in LIST context for each binding type
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Implicit Computed in List Context', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    it('data-bind-class - implicit computed in list INITIAL value', async () => {
        wildflower.component('list-class-test', {
            state: { 
                theme: 'dark',
                items: [{ name: 'A' }, { name: 'B' }]
            },
            computed: {
                itemClass() {
                    // Component-level computed, not item-level
                    return this.state.theme === 'dark' ? 'dark-item' : 'light-item'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-class-test">
                <div data-list="items">
                    <template>
                        <div class="item" data-bind-class="itemClass">
                            <span data-bind="name"></span>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForUpdate()

        const items = testContainer.querySelectorAll('.item')
        console.log('[LIST-CLASS] Item 0 classes:', items[0]?.className)
        console.log('[LIST-CLASS] Item 1 classes:', items[1]?.className)
        
        expect(items.length).toBe(2)
        expect(items[0].classList.contains('dark-item')).toBe(true)
        expect(items[1].classList.contains('dark-item')).toBe(true)
    })

    it('data-bind-style - implicit computed in list INITIAL value', async () => {
        wildflower.component('list-style-test', {
            state: { 
                theme: 'dark',
                items: [{ name: 'A' }, { name: 'B' }]
            },
            computed: {
                itemStyle() {
                    return { backgroundColor: this.state.theme === 'dark' ? 'black' : 'white' }
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-style-test">
                <div data-list="items">
                    <template>
                        <div class="item" data-bind-style="itemStyle">
                            <span data-bind="name"></span>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForUpdate()

        const items = testContainer.querySelectorAll('.item')
        console.log('[LIST-STYLE] Item 0 backgroundColor:', items[0]?.style.backgroundColor)
        
        expect(items.length).toBe(2)
        expect(items[0].style.backgroundColor).toBe('black')
        expect(items[1].style.backgroundColor).toBe('black')
    })

    it('data-bind-html - implicit computed in list INITIAL value', async () => {
        wildflower.component('list-html-test', {
            state: { 
                format: 'bold',
                items: [{ name: 'A' }, { name: 'B' }]
            },
            computed: {
                itemHtml() {
                    return this.state.format === 'bold' ? '<b>Bold</b>' : 'Plain'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-html-test">
                <div data-list="items">
                    <template>
                        <div class="item">
                            <span class="content" data-bind-html="itemHtml"></span>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForUpdate()

        const contents = testContainer.querySelectorAll('.content')
        console.log('[LIST-HTML] Content 0 innerHTML:', contents[0]?.innerHTML)
        
        expect(contents.length).toBe(2)
        expect(contents[0].innerHTML).toBe('<b>Bold</b>')
        expect(contents[1].innerHTML).toBe('<b>Bold</b>')
    })

    it('data-bind (text) - implicit computed in list INITIAL value', async () => {
        wildflower.component('list-text-test', {
            state: { 
                prefix: 'Hello',
                items: [{ name: 'A' }, { name: 'B' }]
            },
            computed: {
                greeting() {
                    return this.state.prefix + ' World'
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="list-text-test">
                <div data-list="items">
                    <template>
                        <div class="item">
                            <span class="greeting" data-bind="greeting"></span>
                        </div>
                    </template>
                </div>
            </div>
        `
        await waitForUpdate()

        const greetings = testContainer.querySelectorAll('.greeting')
        console.log('[LIST-TEXT] Greeting 0 textContent:', greetings[0]?.textContent)
        
        expect(greetings.length).toBe(2)
        expect(greetings[0].textContent).toBe('Hello World')
        expect(greetings[1].textContent).toBe('Hello World')
    })
})
