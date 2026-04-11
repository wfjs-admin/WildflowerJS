/**
 * Input Type Coverage Tests for data-model
 *
 * Tests that data-model binding works correctly for all HTML input types
 * that are not already covered by other test files.
 *
 * Already tested elsewhere: text, number, checkbox, radio, select
 * Tested here: range, color, date, datetime-local, time, textarea,
 *              password, email, url, tel, search, hidden
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

describe('Input Type Coverage - data-model', () => {
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

    // Helper to set up a simple component with one state property and one input
    function setupComponent(name, stateObj, inputHtml) {
        wildflower.component(name, { state: stateObj })

        testContainer.innerHTML = `
            <div data-component="${name}">
                ${inputHtml}
                <span data-bind="${Object.keys(stateObj)[0]}" class="display"></span>
            </div>
        `

        wildflower.scan()
    }

    async function getInstance(componentName) {
        await waitForCompleteRender()
        const el = testContainer.querySelector(`[data-component="${componentName}"]`)
        return wildflower.componentInstances.get(el.dataset.componentId)
    }

    describe('input[type="range"]', () => {
        it('should reflect initial state in the range input', async () => {
            setupComponent('range-init', { volume: 75 },
                '<input type="range" data-model="volume" min="0" max="100" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('75')
        })

        it('should update state when range slider is moved', async () => {
            setupComponent('range-update', { volume: 50 },
                '<input type="range" data-model="volume" min="0" max="100" class="input">')
            const instance = await getInstance('range-update')
            const input = testContainer.querySelector('.input')

            input.value = '30'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.volume).toBe(30)
        })
    })

    describe('input[type="color"]', () => {
        it('should reflect initial state in the color input', async () => {
            setupComponent('color-init', { color: '#ff5500' },
                '<input type="color" data-model="color" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('#ff5500')
        })

        it('should update state when color is changed', async () => {
            setupComponent('color-update', { color: '#000000' },
                '<input type="color" data-model="color" class="input">')
            const instance = await getInstance('color-update')
            const input = testContainer.querySelector('.input')

            input.value = '#ff0000'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.color).toBe('#ff0000')
        })
    })

    describe('input[type="date"]', () => {
        it('should reflect initial state in the date input', async () => {
            setupComponent('date-init', { birthday: '2026-01-15' },
                '<input type="date" data-model="birthday" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('2026-01-15')
        })

        it('should update state when date is changed', async () => {
            setupComponent('date-update', { birthday: '2026-01-15' },
                '<input type="date" data-model="birthday" class="input">')
            const instance = await getInstance('date-update')
            const input = testContainer.querySelector('.input')

            input.value = '2026-06-20'
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.birthday).toBe('2026-06-20')
        })
    })

    describe('input[type="datetime-local"]', () => {
        it('should reflect initial state in the datetime-local input', async () => {
            setupComponent('datetime-init', { meeting: '2026-01-15T09:30' },
                '<input type="datetime-local" data-model="meeting" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('2026-01-15T09:30')
        })

        it('should update state when datetime is changed', async () => {
            setupComponent('datetime-update', { meeting: '2026-01-15T09:30' },
                '<input type="datetime-local" data-model="meeting" class="input">')
            const instance = await getInstance('datetime-update')
            const input = testContainer.querySelector('.input')

            input.value = '2026-03-20T14:00'
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.meeting).toBe('2026-03-20T14:00')
        })
    })

    describe('input[type="time"]', () => {
        it('should reflect initial state in the time input', async () => {
            setupComponent('time-init', { alarm: '07:30' },
                '<input type="time" data-model="alarm" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('07:30')
        })

        it('should update state when time is changed', async () => {
            setupComponent('time-update', { alarm: '07:30' },
                '<input type="time" data-model="alarm" class="input">')
            const instance = await getInstance('time-update')
            const input = testContainer.querySelector('.input')

            input.value = '15:45'
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.alarm).toBe('15:45')
        })
    })

    describe('textarea', () => {
        it('should reflect initial state in the textarea', async () => {
            setupComponent('textarea-init', { notes: 'Hello world' },
                '<textarea data-model="notes" class="input"></textarea>')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('Hello world')
        })

        it('should update state when textarea content is changed', async () => {
            setupComponent('textarea-update', { notes: '' },
                '<textarea data-model="notes" class="input"></textarea>')
            const instance = await getInstance('textarea-update')
            const input = testContainer.querySelector('.input')

            input.value = 'Line 1\nLine 2\nLine 3'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.notes).toBe('Line 1\nLine 2\nLine 3')
        })
    })

    describe('input[type="password"]', () => {
        it('should reflect initial state in the password input', async () => {
            setupComponent('password-init', { secret: 'abc123' },
                '<input type="password" data-model="secret" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('abc123')
        })

        it('should update state when password is typed', async () => {
            setupComponent('password-update', { secret: '' },
                '<input type="password" data-model="secret" class="input">')
            const instance = await getInstance('password-update')
            const input = testContainer.querySelector('.input')

            input.value = 'newPassword!'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.secret).toBe('newPassword!')
        })
    })

    describe('input[type="email"]', () => {
        it('should reflect initial state in the email input', async () => {
            setupComponent('email-init', { email: 'user@example.com' },
                '<input type="email" data-model="email" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('user@example.com')
        })

        it('should update state when email is typed', async () => {
            setupComponent('email-update', { email: '' },
                '<input type="email" data-model="email" class="input">')
            const instance = await getInstance('email-update')
            const input = testContainer.querySelector('.input')

            input.value = 'new@test.org'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.email).toBe('new@test.org')
        })
    })

    describe('input[type="url"]', () => {
        it('should reflect initial state in the url input', async () => {
            setupComponent('url-init', { website: 'https://example.com' },
                '<input type="url" data-model="website" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('https://example.com')
        })

        it('should update state when url is typed', async () => {
            setupComponent('url-update', { website: '' },
                '<input type="url" data-model="website" class="input">')
            const instance = await getInstance('url-update')
            const input = testContainer.querySelector('.input')

            input.value = 'https://wildflowerjs.org'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.website).toBe('https://wildflowerjs.org')
        })
    })

    describe('input[type="tel"]', () => {
        it('should reflect initial state in the tel input', async () => {
            setupComponent('tel-init', { phone: '555-1234' },
                '<input type="tel" data-model="phone" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('555-1234')
        })

        it('should update state when phone number is typed', async () => {
            setupComponent('tel-update', { phone: '' },
                '<input type="tel" data-model="phone" class="input">')
            const instance = await getInstance('tel-update')
            const input = testContainer.querySelector('.input')

            input.value = '(800) 555-0199'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.phone).toBe('(800) 555-0199')
        })
    })

    describe('input[type="search"]', () => {
        it('should reflect initial state in the search input', async () => {
            setupComponent('search-init', { query: 'wildflower' },
                '<input type="search" data-model="query" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('wildflower')
        })

        it('should update state when search text is typed', async () => {
            setupComponent('search-update', { query: '' },
                '<input type="search" data-model="query" class="input">')
            const instance = await getInstance('search-update')
            const input = testContainer.querySelector('.input')

            input.value = 'reactive framework'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.query).toBe('reactive framework')
        })

        it('should update state when search is cleared', async () => {
            setupComponent('search-clear', { query: 'something' },
                '<input type="search" data-model="query" class="input">')
            const instance = await getInstance('search-clear')
            const input = testContainer.querySelector('.input')

            input.value = ''
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.query).toBe('')
        })
    })

    describe('input[type="hidden"]', () => {
        it('should reflect initial state in the hidden input', async () => {
            setupComponent('hidden-init', { token: 'abc-123-xyz' },
                '<input type="hidden" data-model="token" class="input">')
            await waitForCompleteRender()

            const input = testContainer.querySelector('.input')
            expect(input.value).toBe('abc-123-xyz')
        })

        it('should update state when value is set programmatically', async () => {
            setupComponent('hidden-update', { token: '' },
                '<input type="hidden" data-model="token" class="input">')
            const instance = await getInstance('hidden-update')
            const input = testContainer.querySelector('.input')

            input.value = 'new-token-456'
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate()

            expect(instance.state.token).toBe('new-token-456')
        })
    })
})
